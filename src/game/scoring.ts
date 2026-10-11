import type { Difficulty } from "../types";

export const QUESTION_SECONDS = 20;

const BASE: Record<Difficulty, number> = { easy: 100, medium: 150, hard: 200 };

/** Streak multiplier: x1 for the first answer, +0.25 per consecutive correct, capped at x2. */
export function streakMultiplier(streak: number): number {
  return Math.min(2, 1 + 0.25 * Math.max(0, streak));
}

/**
 * Points for a correct answer. `streak` is the number of correct answers in a row
 * before this one. Up to 50% bonus for answering quickly.
 */
export function scoreAnswer(difficulty: Difficulty, secondsLeft: number, streak: number): number {
  const clamped = Math.min(QUESTION_SECONDS, Math.max(0, secondsLeft));
  const speed = 1 + 0.5 * (clamped / QUESTION_SECONDS);
  return Math.round(BASE[difficulty] * speed * streakMultiplier(streak));
}
