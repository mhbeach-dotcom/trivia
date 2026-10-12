// Same numbers as src/game/scoring.ts (a test keeps them in sync).
const BASE = { easy: 100, medium: 200, hard: 300 };

export function scoreAnswer(difficulty, secondsLeft, timeLimit, streakBefore) {
  const base = BASE[difficulty];
  const speed = timeLimit > 0 ? Math.round(100 * Math.min(1, Math.max(0, secondsLeft / timeLimit))) : 0;
  const streak = Math.min(Math.max(0, streakBefore) * 25, 200);
  return { base, speed, streak, total: base + speed + streak };
}
