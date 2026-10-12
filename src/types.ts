export type BookId = "hunger-games" | "catching-fire" | "mockingjay" | "ballad" | "sunrise";
export type Difficulty = "easy" | "medium" | "hard";
export type Mode = "quick" | "survival" | "marathon" | "daily";

export interface Question {
  id: string;
  book: BookId;
  category: string;
  difficulty: Difficulty;
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

export const BOOKS: Record<BookId, string> = {
  "hunger-games": "The Hunger Games",
  "catching-fire": "Catching Fire",
  mockingjay: "Mockingjay",
  ballad: "Ballad of Songbirds & Snakes",
  sunrise: "Sunrise on the Reaping",
};
