import type { Mode } from "./types";

export interface Stats {
  best: Partial<Record<Mode, number>>;
  bestStreak: number;
  gamesPlayed: number;
  dailyDone: string | null;
  dailyResult: string | null;
}

const KEY = "hg-trivia:v1";

const empty = (): Stats => ({ best: {}, bestStreak: 0, gamesPlayed: 0, dailyDone: null, dailyResult: null });

export function loadStats(): Stats {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...empty(), ...JSON.parse(raw) };
  } catch {
    // storage unavailable or corrupt: start fresh
  }
  return empty();
}

export function saveStats(s: Stats): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ignore: the game still works without persistence
  }
}

export function exportStats(): string {
  return JSON.stringify(loadStats());
}

export function importStats(json: string): boolean {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return false;
    saveStats({ ...empty(), ...parsed });
    return true;
  } catch {
    return false;
  }
}
