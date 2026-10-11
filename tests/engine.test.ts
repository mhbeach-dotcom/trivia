import { describe, expect, it } from "vitest";
import { Game, pickQuestions } from "../src/game/engine";
import { scoreAnswer, streakMultiplier } from "../src/game/scoring";
import { ALL_QUESTIONS } from "../src/game/data";

describe("scoring", () => {
  it("rewards speed and difficulty", () => {
    expect(scoreAnswer("easy", 20, 0)).toBe(150);
    expect(scoreAnswer("easy", 0, 0)).toBe(100);
    expect(scoreAnswer("hard", 0, 0)).toBe(200);
  });
  it("caps the streak multiplier at 2", () => {
    expect(streakMultiplier(0)).toBe(1);
    expect(streakMultiplier(2)).toBe(1.5);
    expect(streakMultiplier(50)).toBe(2);
  });
});

describe("question data", () => {
  it("is well formed with unique ids", () => {
    const ids = new Set(ALL_QUESTIONS.map((q) => q.id));
    expect(ids.size).toBe(ALL_QUESTIONS.length);
    for (const q of ALL_QUESTIONS) {
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      expect(q.options[q.answerIndex]).toBeTruthy();
      expect(new Set(q.options).size).toBe(q.options.length);
    }
  });
});

describe("daily set", () => {
  it("is deterministic per date and differs across dates", () => {
    const a = pickQuestions({ mode: "daily", pool: ALL_QUESTIONS, date: "2026-10-11" }).map((q) => q.id);
    const b = pickQuestions({ mode: "daily", pool: ALL_QUESTIONS.slice().reverse(), date: "2026-10-11" }).map((q) => q.id);
    const c = pickQuestions({ mode: "daily", pool: ALL_QUESTIONS, date: "2026-10-12" }).map((q) => q.id);
    expect(a).toEqual(b);
    expect(a).toHaveLength(5);
    expect(a).not.toEqual(c);
  });
});

describe("Game", () => {
  it("builds a streak and ends a quick game after count questions", () => {
    const g = new Game({ mode: "quick", pool: ALL_QUESTIONS, count: 3 });
    for (let i = 0; i < 3; i++) {
      g.answer(g.current!.answerIndex, 10);
      g.next();
    }
    expect(g.over).toBe(true);
    expect(g.correctCount).toBe(3);
    expect(g.bestStreak).toBe(3);
  });
  it("ends survival on the first miss", () => {
    const g = new Game({ mode: "survival", pool: ALL_QUESTIONS });
    g.answer(g.current!.answerIndex, 10);
    g.next();
    g.answer(null, 0);
    expect(g.over).toBe(true);
    expect(g.streak).toBe(0);
  });
  it("respects the book filter", () => {
    const qs = pickQuestions({ mode: "quick", pool: ALL_QUESTIONS, books: ["sunrise"] });
    expect(qs.every((q) => q.book === "sunrise")).toBe(true);
  });
});
