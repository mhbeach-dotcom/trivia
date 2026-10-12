import type { BookId, Difficulty } from "../types";

export interface Player { id: string; name: string; connected: boolean; isHost: boolean }
export interface Settings { count: number; time: number; books: BookId[] }

export interface QuestionPayload {
  index: number;
  total: number;
  text: string;
  options: string[];
  difficulty: Difficulty;
  book: BookId;
  category: string;
  limit: number;
  /** Server epoch ms when the question closes. */
  deadline: number;
  /** Server epoch ms when this was sent, used to correct for clock skew. */
  serverNow: number;
}

export interface ResultRow { id: string; name: string; choice: number | null; correct: boolean; points: number; streak: number }
export interface ScoreRow {
  id: string;
  name: string;
  score: number;
  rank: number;
  prevRank: number;
  streak: number;
  correct: number;
  connected: boolean;
  delta: number;
}
export interface RevealPayload {
  index: number;
  total: number;
  answerIndex: number;
  explanation: string;
  results: ResultRow[];
  scoreboard: ScoreRow[];
  isLast: boolean;
  revealMs: number;
}
export interface FinalPayload { total: number; scoreboard: ScoreRow[] }

export type Phase = "lobby" | "question" | "reveal" | "finished";

export interface Snapshot {
  code: string;
  phase: Phase;
  youId: string;
  hostId: string | null;
  players: Player[];
  settings: Settings;
  question: QuestionPayload | null;
  answered: { count: number; total: number; yours: number | null } | null;
  reveal: RevealPayload | null;
  final: FinalPayload | null;
  score: number;
  streak: number;
}

export interface LobbyUpdate { players: Player[]; hostId: string | null; settings: Settings; phase: Phase }
export interface Session { code: string; playerId: string; name: string }
