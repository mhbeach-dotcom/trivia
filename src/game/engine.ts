import type { BookId, Difficulty, Mode, Question } from "../types";
import { hashString, mulberry32, shuffle } from "./rng";
import { scoreAnswer } from "./scoring";

export interface ModeConfig {
  name: string;
  icon: string;
  blurb: string;
  /** Number of questions; Infinity for survival. */
  count: number;
  /** Seconds per question; 0 means untimed. */
  time: number;
  hearts: number;
}

export const MODE_CONFIG: Record<Mode, ModeConfig> = {
  quick: { name: "Quick Play", icon: "⚡", blurb: "10 questions · 20 seconds each · answer fast for bonus points", count: 10, time: 20, hearts: 0 },
  survival: { name: "Survival", icon: "🔥", blurb: "3 hearts · questions get harder · how long can you last?", count: Infinity, time: 20, hearts: 3 },
  marathon: { name: "Marathon", icon: "🏹", blurb: "25 questions · no timer · pure tribute knowledge", count: 25, time: 0, hearts: 0 },
  daily: { name: "Daily Reaping", icon: "📅", blurb: "5 questions · the same for everyone today", count: 5, time: 20, hearts: 0 },
};

export const DAILY_COUNT = MODE_CONFIG.daily.count;

export interface GameOptions {
  mode: Mode;
  pool: readonly Question[];
  books?: readonly BookId[];
  /** YYYY-MM-DD, used to seed the daily set. */
  date?: string;
  rand?: () => number;
}

export type EndReason = "done" | "dead" | "cleared";

/** A question as shown on screen: options shuffled, answer index remapped. */
export interface Presented {
  question: Question;
  options: string[];
  answerIndex: number;
}

export type Outcome =
  | { kind: "retry"; eliminated: number }
  | {
      kind: "result";
      correct: boolean;
      timedOut: boolean;
      answerIndex: number;
      base: number;
      speed: number;
      streakBonus: number;
      points: number;
      heartLost: boolean;
    };

export function localDateKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Survival ramps up: 5 easy, then 10 medium, then hard, with any leftovers at the end. */
function survivalDeck(pool: readonly Question[], rand: () => number): Question[] {
  const tier = (d: Difficulty) => shuffle(pool.filter((q) => q.difficulty === d), rand);
  const easy = tier("easy");
  const medium = tier("medium");
  const hard = tier("hard");
  return [...easy.slice(0, 5), ...medium.slice(0, 10), ...hard, ...medium.slice(10), ...easy.slice(5)];
}

export function buildDeck(opts: GameOptions): Question[] {
  const rand = opts.rand ?? Math.random;
  const books = opts.books?.length ? new Set(opts.books) : null;
  const pool = opts.pool.filter((q) => !books || books.has(q.book));
  switch (opts.mode) {
    case "daily": {
      // Always the full pool, in a stable order, so everyone gets the same set on a given date.
      const seeded = mulberry32(hashString(opts.date ?? localDateKey()));
      const sorted = opts.pool.slice().sort((a, b) => a.id.localeCompare(b.id));
      return shuffle(sorted, seeded).slice(0, DAILY_COUNT);
    }
    case "survival":
      return survivalDeck(pool, rand);
    default:
      return shuffle(pool, rand).slice(0, MODE_CONFIG[opts.mode].count);
  }
}

export class Game {
  readonly mode: Mode;
  readonly cfg: ModeConfig;
  readonly deck: Question[];
  idx = 0;
  score = 0;
  streak = 0;
  bestStreak = 0;
  hearts: number;
  correctCount = 0;
  answered = 0;
  lives = { fifty: 2, skip: 2, second: 1 };
  secondArmed = false;
  over = false;
  reason: EndReason | null = null;
  /** Per-question outcome, for the share string. */
  readonly history: boolean[] = [];
  readonly eliminated = new Set<number>();
  private view: Presented | undefined;
  private resolved = false;
  private dying = false;
  private readonly rand: () => number;

  constructor(opts: GameOptions) {
    this.rand = opts.rand ?? Math.random;
    this.mode = opts.mode;
    this.cfg = MODE_CONFIG[opts.mode];
    this.deck = buildDeck(opts);
    this.hearts = this.cfg.hearts;
    if (this.deck.length === 0) this.finish("done");
    else this.present();
  }

  get current(): Presented | undefined {
    return this.over ? undefined : this.view;
  }

  /** Total questions, or Infinity for survival. */
  get total(): number {
    return this.mode === "survival" ? Infinity : this.deck.length;
  }

  get isLast(): boolean {
    return this.idx + 1 >= this.deck.length;
  }

  get isResolved(): boolean {
    return this.resolved;
  }

  /** Submit an answer. `choice` is null when the timer ran out. */
  answer(choice: number | null, secondsLeft: number): Outcome {
    const view = this.current;
    if (!view || this.resolved) throw new Error("No open question");
    const timedOut = choice === null;
    const correct = choice === view.answerIndex;

    if (!correct && !timedOut && this.secondArmed) {
      this.secondArmed = false;
      this.eliminated.add(choice);
      return { kind: "retry", eliminated: choice };
    }

    this.resolved = true;
    this.answered += 1;
    this.history.push(correct);
    let base = 0;
    let speed = 0;
    let streakBonus = 0;
    let points = 0;
    let heartLost = false;
    if (correct) {
      const s = scoreAnswer(view.question.difficulty, secondsLeft, this.cfg.time, this.streak);
      ({ base, speed, total: points } = s);
      streakBonus = s.streak;
      this.score += points;
      this.streak += 1;
      this.correctCount += 1;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
    } else {
      this.streak = 0;
      if (this.cfg.hearts > 0) {
        this.hearts -= 1;
        heartLost = true;
        if (this.hearts <= 0) this.dying = true;
      }
    }
    return { kind: "result", correct, timedOut, answerIndex: view.answerIndex, base, speed, streakBonus, points, heartLost };
  }

  /** 50/50: returns the display indexes of two wrong options to remove. */
  useFifty(): number[] {
    const view = this.current;
    if (!view || this.resolved || this.lives.fifty <= 0) return [];
    this.lives.fifty -= 1;
    const wrongs = view.options.map((_, i) => i).filter((i) => i !== view.answerIndex && !this.eliminated.has(i));
    const picked = shuffle(wrongs, this.rand).slice(0, 2);
    picked.forEach((i) => this.eliminated.add(i));
    return picked;
  }

  /** Skip the question without answering it. */
  useSkip(): boolean {
    if (!this.current || this.resolved || this.lives.skip <= 0) return false;
    this.lives.skip -= 1;
    this.advance();
    return true;
  }

  /** Arm Second Chance: the next wrong answer is forgiven once. */
  useSecondChance(): boolean {
    if (!this.current || this.resolved || this.lives.second <= 0 || this.secondArmed) return false;
    this.lives.second -= 1;
    this.secondArmed = true;
    return true;
  }

  /** Move on after an answered question. */
  next(): void {
    if (this.over) return;
    if (this.dying) this.finish("dead");
    else this.advance();
  }

  private advance(): void {
    this.idx += 1;
    if (this.idx >= this.deck.length) this.finish(this.mode === "survival" ? "cleared" : "done");
    else this.present();
  }

  private finish(reason: EndReason): void {
    this.over = true;
    this.reason = reason;
  }

  private present(): void {
    const q = this.deck[this.idx];
    const order = shuffle(q.options.map((_, i) => i), this.rand);
    this.view = { question: q, options: order.map((i) => q.options[i]), answerIndex: order.indexOf(q.answerIndex) };
    this.eliminated.clear();
    this.secondArmed = false;
    this.resolved = false;
  }
}
