import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The multiplayer server reads the same question files the client bundles.
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'data');
const FILES = ['hunger-games', 'catching-fire', 'mockingjay', 'ballad', 'sunrise'];

export const BOOK_IDS = FILES;

export function loadQuestions() {
  return FILES.flatMap((f) => JSON.parse(readFileSync(path.join(dir, `${f}.json`), 'utf8')));
}
