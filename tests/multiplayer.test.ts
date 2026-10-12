import { describe, expect, it } from "vitest";
import { Room, RoomError, cleanName, generateCode, CODE_CHARS, MAX_PLAYERS, REVEAL_MS } from "../server/src/room.js";
import { scoreAnswer as serverScore } from "../server/src/scoring.js";
import { scoreAnswer as clientScore } from "../src/game/scoring";
import { loadQuestions } from "../server/src/questions.js";
import { mulberry32 } from "../src/game/rng";

const questions = loadQuestions();

function setup(names = ["Ann", "Bo"]) {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const room = new Room("ABCD", questions, { rand: mulberry32(7), now: clock.now });
  const players = names.map((n) => room.addPlayer(n));
  players.forEach((p) => room.setConnected(p.id, true));
  return { room, players, clock };
}

const wrongIndex = (room: Room) => [0, 1, 2, 3].find((i) => i !== room.view!.answerIndex)!;

describe("server data and scoring parity", () => {
  it("loads every question", () => {
    expect(questions.length).toBeGreaterThan(150);
  });
  it("matches the client's scoring", () => {
    for (const d of ["easy", "medium", "hard"] as const) {
      for (const [left, limit, streak] of [[20, 20, 0], [7, 20, 3], [0, 10, 12]] as const) {
        expect(serverScore(d, left, limit, streak)).toEqual(clientScore(d, left, limit, streak));
      }
    }
  });
});

describe("room codes and names", () => {
  it("makes 4-character codes without ambiguous characters", () => {
    for (let i = 0; i < 200; i++) {
      const c = generateCode();
      expect(c).toMatch(/^[A-Z2-9]{4}$/);
      expect([...c].every((ch) => CODE_CHARS.includes(ch))).toBe(true);
      expect(c).not.toMatch(/[01OI]/);
    }
  });
  it("cleans and validates names", () => {
    expect(cleanName("  Katniss   E  ")).toBe("Katniss E");
    expect(() => cleanName("   ")).toThrow(RoomError);
    expect(() => cleanName("x".repeat(40))).toThrow(RoomError);
    expect(cleanName("a\u0000b")).toBe("ab");
  });
});

describe("lobby", () => {
  it("first player is the host and names are unique case-insensitively", () => {
    const { room, players } = setup();
    expect(room.hostId).toBe(players[0].id);
    expect(() => room.addPlayer("ann")).toThrow(/taken/);
  });
  it("caps the room size", () => {
    const { room } = setup([]);
    for (let i = 0; i < MAX_PLAYERS; i++) room.addPlayer(`P${i}`);
    expect(() => room.addPlayer("one too many")).toThrow(/full/);
  });
  it("only the host can start, and it needs two players", () => {
    const { room, players } = setup(["Ann"]);
    expect(() => room.start(players[0].id)).toThrow(/at least 2/);
    const two = setup();
    expect(() => two.room.start(two.players[1].id)).toThrow(/host/);
    two.room.start(two.players[0].id);
    expect(two.room.phase).toBe("question");
  });
  it("hands host to the next connected player when the host drops", () => {
    const { room, players } = setup(["Ann", "Bo", "Cy"]);
    room.setConnected(players[0].id, false);
    expect(room.hostId).toBe(players[1].id);
  });
  it("validates settings and only lets the host change them", () => {
    const { room, players } = setup();
    room.updateSettings(players[0].id, { count: 5, time: 10, books: ["sunrise", "ballad"] });
    expect(room.settings).toMatchObject({ count: 5, time: 10 });
    expect(() => room.updateSettings(players[0].id, { count: 7 })).toThrow(RoomError);
    expect(() => room.updateSettings(players[0].id, { books: [] })).toThrow(RoomError);
    expect(() => room.updateSettings(players[1].id, { count: 10 })).toThrow(/host/);
  });
  it("refuses new players once the game has started", () => {
    const { room, players } = setup();
    room.start(players[0].id);
    expect(() => room.addPlayer("Late")).toThrow(/already started/);
  });
});

describe("a round", () => {
  it("never sends the answer in the question payload", () => {
    const { room, players } = setup();
    room.start(players[0].id);
    const payload = JSON.stringify(room.questionPayload());
    expect(payload).not.toMatch(/answerIndex|explanation/);
    const snap = JSON.stringify(room.snapshot(players[1].id));
    expect(snap).not.toMatch(/answerIndex/);
  });

  it("scores faster correct answers higher and keeps streaks per player", () => {
    const { room, players, clock } = setup();
    room.start(players[0].id);
    const [a, b] = players;
    clock.advance(2000);
    expect(room.submitAnswer(a.id, room.view!.answerIndex).accepted).toBe(true);
    clock.advance(8000);
    const last = room.submitAnswer(b.id, room.view!.answerIndex);
    expect(last.everyoneAnswered).toBe(true);
    const reveal = room.endQuestion()!;
    const ra = reveal.results.find((r: any) => r.id === a.id)!;
    const rb = reveal.results.find((r: any) => r.id === b.id)!;
    expect(ra.correct && rb.correct).toBe(true);
    expect(ra.points).toBeGreaterThan(rb.points);
    expect(reveal.scoreboard[0].id).toBe(a.id);
    expect(room.getPlayer(a.id)!.streak).toBe(1);
  });

  it("ignores duplicate, invalid and late answers", () => {
    const { room, players, clock } = setup();
    room.start(players[0].id);
    const id = players[0].id;
    expect(room.submitAnswer(id, 99).accepted).toBe(false);
    expect(room.submitAnswer(id, -1).accepted).toBe(false);
    expect(room.submitAnswer(id, 1.5 as any).accepted).toBe(false);
    expect(room.submitAnswer(id, 0).accepted).toBe(true);
    expect(room.submitAnswer(id, 1).accepted).toBe(false);
    clock.advance(60_000);
    expect(room.submitAnswer(players[1].id, 0).accepted).toBe(false);
  });

  it("an unanswered or wrong round scores zero and resets the streak", () => {
    const { room, players } = setup();
    room.start(players[0].id);
    room.submitAnswer(players[0].id, room.view!.answerIndex);
    room.endQuestion();
    room.nextQuestion();
    room.submitAnswer(players[0].id, wrongIndex(room));
    const reveal = room.endQuestion()!;
    expect(reveal.results.every((r: any) => r.points === 0)).toBe(true);
    expect(room.getPlayer(players[0].id)!.streak).toBe(0);
  });

  it("doesn't wait for disconnected players", () => {
    const { room, players } = setup(["Ann", "Bo", "Cy"]);
    room.start(players[0].id);
    room.setConnected(players[2].id, false);
    room.submitAnswer(players[0].id, 0);
    expect(room.everyoneAnswered()).toBe(false);
    expect(room.submitAnswer(players[1].id, 0).everyoneAnswered).toBe(true);
  });

  it("ranks ties together and tracks rank changes", () => {
    const { room, players } = setup();
    room.start(players[0].id);
    room.endQuestion(); // nobody answered
    const sb = room.lastReveal!.scoreboard;
    expect(sb.map((s: any) => s.rank)).toEqual([1, 1]);
  });

  it("reports no rank movement on the first round, then does once scores differ", () => {
    const { room, players } = setup();
    room.start(players[0].id);
    room.submitAnswer(players[1].id, room.view!.answerIndex);
    room.submitAnswer(players[0].id, wrongIndex(room));
    const first = room.endQuestion()!;
    expect(first.scoreboard.every((r: any) => r.prevRank === r.rank)).toBe(true);
    room.nextQuestion();
    room.submitAnswer(players[0].id, room.view!.answerIndex);
    room.submitAnswer(players[1].id, wrongIndex(room));
    const second = room.endQuestion()!;
    const ann = second.scoreboard.find((r: any) => r.id === players[0].id)!;
    expect(ann.prevRank).toBeGreaterThan(ann.rank);
  });

  it("runs a full game to the podium, then rematch resets", () => {
    const { room, players } = setup();
    room.updateSettings(players[0].id, { count: 5 });
    room.start(players[0].id);
    for (let i = 0; i < 5; i++) {
      expect(room.phase).toBe("question");
      room.submitAnswer(players[0].id, room.view!.answerIndex);
      room.submitAnswer(players[1].id, wrongIndex(room));
      const reveal = room.endQuestion()!;
      expect(reveal.isLast).toBe(i === 4);
      room.nextQuestion();
    }
    expect(room.phase).toBe("finished");
    const final = room.finalPayload();
    expect(final.scoreboard[0].id).toBe(players[0].id);
    expect(final.scoreboard[0].correct).toBe(5);
    expect(() => room.rematch(players[1].id)).toThrow(/host/);
    room.rematch(players[0].id);
    expect(room.phase).toBe("lobby");
    expect(room.getPlayer(players[0].id)!.score).toBe(0);
  });

  it("reveal pause is a sane length", () => {
    expect(REVEAL_MS).toBeGreaterThanOrEqual(3000);
  });

  it("a reconnecting player gets a snapshot of the open question with their pick", () => {
    const { room, players } = setup();
    room.start(players[0].id);
    room.submitAnswer(players[1].id, 2);
    const snap = room.snapshot(players[1].id);
    expect(snap.phase).toBe("question");
    expect(snap.answered?.yours).toBe(2);
    expect(room.snapshot(players[0].id).answered?.yours).toBeNull();
  });
});
