import { describe, expect, it } from "vitest";
import { Game, buildDeck } from "../src/game/engine";
import { scoreAnswer } from "../src/game/scoring";
import { mulberry32 } from "../src/game/rng";
import { ALL_QUESTIONS } from "../src/game/data";

const seeded = () => mulberry32(42);

describe("scoring", () => {
  it("uses tier base points plus speed", () => {
    expect(scoreAnswer("easy", 20, 20, 0)).toMatchObject({ base: 100, speed: 100, streak: 0, total: 200 });
    expect(scoreAnswer("medium", 0, 20, 0).total).toBe(200);
    expect(scoreAnswer("hard", 10, 20, 0).total).toBe(350);
  });
  it("adds a capped streak bonus", () => {
    expect(scoreAnswer("easy", 0, 20, 1).streak).toBe(25);
    expect(scoreAnswer("easy", 0, 20, 50).streak).toBe(200);
  });
  it("gives no speed bonus in untimed modes", () => {
    expect(scoreAnswer("easy", 0, 0, 0).speed).toBe(0);
  });
});

describe("question data", () => {
  it("is well formed with unique ids and texts", () => {
    expect(new Set(ALL_QUESTIONS.map((q) => q.id)).size).toBe(ALL_QUESTIONS.length);
    expect(new Set(ALL_QUESTIONS.map((q) => q.question.toLowerCase())).size).toBe(ALL_QUESTIONS.length);
    for (const q of ALL_QUESTIONS) {
      expect(q.options.length).toBe(4);
      expect(q.options[q.answerIndex]).toBeTruthy();
      expect(new Set(q.options).size).toBe(4);
    }
  });
});

describe("daily set", () => {
  it("is deterministic per date and differs across dates", () => {
    const ids = (pool: typeof ALL_QUESTIONS, date: string) => buildDeck({ mode: "daily", pool, date }).map((q) => q.id);
    const a = ids(ALL_QUESTIONS, "2026-10-11");
    expect(a).toEqual(ids(ALL_QUESTIONS.slice().reverse(), "2026-10-11"));
    expect(a).toHaveLength(5);
    expect(a).not.toEqual(ids(ALL_QUESTIONS, "2026-10-12"));
  });
});

describe("Game", () => {
  it("scores a quick game, builds a streak and ends after 10", () => {
    const g = new Game({ mode: "quick", pool: ALL_QUESTIONS, rand: seeded() });
    let last = 0;
    while (!g.over) {
      const out = g.answer(g.current!.answerIndex, 10);
      expect(out.kind).toBe("result");
      if (out.kind === "result") last = out.points;
      g.next();
    }
    expect(g.answered).toBe(10);
    expect(g.correctCount).toBe(10);
    expect(g.bestStreak).toBe(10);
    expect(g.reason).toBe("done");
    expect(last).toBeGreaterThan(0);
  });

  it("shuffles options and keeps the answer index consistent", () => {
    const g = new Game({ mode: "marathon", pool: ALL_QUESTIONS, rand: seeded() });
    const v = g.current!;
    expect(v.options[v.answerIndex]).toBe(v.question.options[v.question.answerIndex]);
  });

  it("marathon is untimed with no speed bonus", () => {
    const g = new Game({ mode: "marathon", pool: ALL_QUESTIONS, rand: seeded() });
    expect(g.deck).toHaveLength(25);
    const out = g.answer(g.current!.answerIndex, 0);
    expect(out.kind === "result" && out.speed).toBe(0);
  });

  it("survival costs a heart per miss and ends at zero", () => {
    const g = new Game({ mode: "survival", pool: ALL_QUESTIONS, rand: seeded() });
    for (let i = 0; i < 3; i++) {
      expect(g.over).toBe(false);
      const out = g.answer(null, 0);
      expect(out.kind === "result" && out.heartLost).toBe(true);
      g.next();
    }
    expect(g.hearts).toBe(0);
    expect(g.over).toBe(true);
    expect(g.reason).toBe("dead");
  });

  it("survival ramps difficulty", () => {
    const d = buildDeck({ mode: "survival", pool: ALL_QUESTIONS, rand: seeded() }).map((q) => q.difficulty);
    expect(d.slice(0, 5).every((x) => x === "easy")).toBe(true);
    expect(d.slice(5, 15).every((x) => x === "medium")).toBe(true);
  });

  it("clearing the whole survival deck reports cleared", () => {
    const g = new Game({ mode: "survival", pool: ALL_QUESTIONS.slice(0, 6), rand: seeded() });
    while (!g.over) {
      g.answer(g.current!.answerIndex, 5);
      g.next();
    }
    expect(g.reason).toBe("cleared");
  });

  it("50/50 removes exactly two wrong options, twice at most", () => {
    const g = new Game({ mode: "quick", pool: ALL_QUESTIONS, rand: seeded() });
    const gone = g.useFifty();
    expect(gone).toHaveLength(2);
    expect(gone).not.toContain(g.current!.answerIndex);
    expect(g.lives.fifty).toBe(1);
  });

  it("second chance forgives one wrong answer without a penalty", () => {
    const g = new Game({ mode: "survival", pool: ALL_QUESTIONS, rand: seeded() });
    expect(g.useSecondChance()).toBe(true);
    const wrong = g.current!.options.findIndex((_, i) => i !== g.current!.answerIndex);
    expect(g.answer(wrong, 5).kind).toBe("retry");
    expect(g.hearts).toBe(3);
    expect(g.isResolved).toBe(false);
    const second = g.answer(g.current!.answerIndex, 5);
    expect(second.kind === "result" && second.correct).toBe(true);
  });

  it("second chance does not save a timeout", () => {
    const g = new Game({ mode: "survival", pool: ALL_QUESTIONS, rand: seeded() });
    g.useSecondChance();
    expect(g.answer(null, 0).kind).toBe("result");
    expect(g.hearts).toBe(2);
  });

  it("skip advances without counting as answered", () => {
    const g = new Game({ mode: "quick", pool: ALL_QUESTIONS, rand: seeded() });
    expect(g.useSkip()).toBe(true);
    expect(g.idx).toBe(1);
    expect(g.answered).toBe(0);
    expect(g.lives.skip).toBe(1);
  });

  it("respects the book filter", () => {
    const deck = buildDeck({ mode: "quick", pool: ALL_QUESTIONS, books: ["sunrise"] });
    expect(deck.every((q) => q.book === "sunrise")).toBe(true);
  });

  it("ends immediately when the filter leaves no questions", () => {
    const g = new Game({ mode: "quick", pool: [] });
    expect(g.over).toBe(true);
  });
});
