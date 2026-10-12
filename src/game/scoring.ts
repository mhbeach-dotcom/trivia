import type { Difficulty } from "../types";

const BASE: Record<Difficulty, number> = { easy: 100, medium: 200, hard: 300 };

export const MAX_SPEED_BONUS = 100;
export const MAX_STREAK_BONUS = 200;

export interface ScoreBreakdown {
  base: number;
  speed: number;
  streak: number;
  total: number;
}

export function basePoints(difficulty: Difficulty): number {
  return BASE[difficulty];
}

/**
 * Points for a correct answer. `streakBefore` is the number of correct answers in a row
 * before this one. `timeLimit` of 0 means an untimed mode, which earns no speed bonus.
 */
export function scoreAnswer(
  difficulty: Difficulty,
  secondsLeft: number,
  timeLimit: number,
  streakBefore: number,
): ScoreBreakdown {
  const base = BASE[difficulty];
  const speed = timeLimit > 0 ? Math.round(MAX_SPEED_BONUS * Math.min(1, Math.max(0, secondsLeft / timeLimit))) : 0;
  const streak = Math.min(Math.max(0, streakBefore) * 25, MAX_STREAK_BONUS);
  return { base, speed, streak, total: base + speed + streak };
}
