import type { BookId, Mode, Question } from "../types";
import { hashString, mulberry32, shuffle } from "./rng";
import { scoreAnswer } from "./scoring";

export interface GameOptions {
  mode: Mode;
  pool: readonly Question[];
  books?: readonly BookId[];
  count?: number;
  /** YYYY-MM-DD, used to seed the daily set. */
  date?: string;
}

export interface AnswerResult {
  correct: boolean;
  points: number;
  correctIndex: number;
}

export const QUICK_COUNT = 10;
export const DAILY_COUNT = 5;

export function localDateKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function pickQuestions(opts: GameOptions): Question[] {
  const books = opts.books?.length ? new Set(opts.books) : null;
  const pool = opts.pool.filter((q) => !books || books.has(q.book));
  if (opts.mode === "daily") {
    // Daily always draws from the full pool so everyone gets the same set.
    const rand = mulberry32(hashString(opts.date ?? localDateKey()));
    const sorted = opts.pool.slice().sort((a, b) => a.id.localeCompare(b.id));
    return shuffle(sorted, rand).slice(0, DAILY_COUNT);
  }
  const shuffled = shuffle(pool);
  if (opts.mode === "survival") return shuffled;
  return shuffled.slice(0, opts.count ?? QUICK_COUNT);
}

export class Game {
  readonly mode: Mode;
  readonly questions: Question[];
  index = 0;
  score = 0;
  streak = 0;
  bestStreak = 0;
  correctCount = 0;
  over = false;
  /** Per-question outcome, for the share string. */
  readonly history: boolean[] = [];

  constructor(opts: GameOptions) {
    this.mode = opts.mode;
    this.questions = pickQuestions(opts);
    if (this.questions.length === 0) this.over = true;
  }

  get current(): Question | undefined {
    return this.over ? undefined : this.questions[this.index];
  }

  /** Submit an answer. `choice` is null when the timer ran out. */
  answer(choice: number | null, secondsLeft: number): AnswerResult {
    const q = this.current;
    if (!q) throw new Error("Game is over");
    const correct = choice === q.answerIndex;
    let points = 0;
    if (correct) {
      points = scoreAnswer(q.difficulty, secondsLeft, this.streak);
      this.score += points;
      this.streak += 1;
      this.correctCount += 1;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
    } else {
      this.streak = 0;
    }
    this.history.push(correct);
    if (!correct && this.mode === "survival") this.over = true;
    return { correct, points, correctIndex: q.answerIndex };
  }

  /** Move to the next question; ends the game when none remain. */
  next(): void {
    if (this.over) return;
    this.index += 1;
    if (this.index >= this.questions.length) this.over = true;
  }
}
