import { randomUUID } from 'node:crypto';
import { scoreAnswer } from './scoring.js';
import { BOOK_IDS } from './questions.js';

export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;
export const NAME_MAX = 16;
export const COUNT_OPTIONS = [5, 10, 15, 20];
export const TIME_OPTIONS = [10, 20, 30];
export const REVEAL_MS = 6000;

export class RoomError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function generateCode(rand = Math.random) {
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
  return code;
}

export function cleanName(raw) {
  const name = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) throw new RoomError('Enter a name');
  if (name.length > NAME_MAX) throw new RoomError(`Names can be at most ${NAME_MAX} characters`);
  return name;
}

function shuffle(items, rand) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Competition ranking: ties share a rank (1, 2, 2, 4). */
function ranked(players) {
  const sorted = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  let rank = 0;
  return sorted.map((p, i) => {
    if (i === 0 || p.score !== sorted[i - 1].score) rank = i + 1;
    return { p, rank };
  });
}

/**
 * Pure game state for one multiplayer room. It never touches sockets or timers:
 * the controller feeds it events and a clock, and broadcasts whatever it returns.
 */
export class Room {
  constructor(code, questions, { rand = Math.random, now = Date.now } = {}) {
    this.code = code;
    this.questions = questions;
    this.rand = rand;
    this.now = now;
    this.players = new Map();
    this.hostId = null;
    this.phase = 'lobby'; // lobby | question | reveal | finished
    this.settings = { count: 10, time: 20, books: [...BOOK_IDS] };
    this.deck = [];
    this.index = -1;
    this.view = null; // current question as shown: shuffled options + answerIndex
    this.deadline = 0;
    this.answers = new Map();
    this.lastReveal = null;
    this.touched = now();
  }

  touch() {
    this.touched = this.now();
  }

  /* ---------- players ---------- */
  addPlayer(rawName) {
    const name = cleanName(rawName);
    if (this.phase !== 'lobby') throw new RoomError('That game has already started', 409);
    if (this.players.size >= MAX_PLAYERS) throw new RoomError(`This room is full (max ${MAX_PLAYERS} players)`, 403);
    for (const p of this.players.values()) {
      if (p.name.toLowerCase() === name.toLowerCase()) throw new RoomError('That name is already taken in this room', 409);
    }
    const player = { id: randomUUID(), name, score: 0, streak: 0, correct: 0, connected: false, joinedAt: this.now() };
    this.players.set(player.id, player);
    if (!this.hostId) this.hostId = player.id;
    this.touch();
    return player;
  }

  getPlayer(id) {
    return this.players.get(id);
  }

  setConnected(id, connected) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = connected;
    if (!connected && id === this.hostId) this.migrateHost();
    this.touch();
  }

  /** If the host drops, the longest-standing connected player takes over. */
  migrateHost() {
    const next = [...this.players.values()].filter((p) => p.connected).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (next) this.hostId = next.id;
  }

  removePlayer(id) {
    if (this.phase !== 'lobby') {
      this.setConnected(id, false);
      return;
    }
    this.players.delete(id);
    if (id === this.hostId) {
      this.hostId = null;
      const next = [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (next) this.hostId = next.id;
    }
    this.touch();
  }

  get connectedCount() {
    return [...this.players.values()].filter((p) => p.connected).length;
  }

  publicPlayers() {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name, connected: p.connected, isHost: p.id === this.hostId }));
  }

  /* ---------- settings ---------- */
  updateSettings(playerId, patch) {
    this.requireHost(playerId);
    if (this.phase !== 'lobby') throw new RoomError('Settings are locked once the game starts', 409);
    const next = { ...this.settings };
    if (patch.count !== undefined) {
      if (!COUNT_OPTIONS.includes(patch.count)) throw new RoomError('Invalid question count');
      next.count = patch.count;
    }
    if (patch.time !== undefined) {
      if (!TIME_OPTIONS.includes(patch.time)) throw new RoomError('Invalid time limit');
      next.time = patch.time;
    }
    if (patch.books !== undefined) {
      if (!Array.isArray(patch.books) || patch.books.length === 0 || !patch.books.every((b) => BOOK_IDS.includes(b))) {
        throw new RoomError('Pick at least one book');
      }
      next.books = BOOK_IDS.filter((b) => patch.books.includes(b));
    }
    this.settings = next;
    this.touch();
  }

  requireHost(playerId) {
    if (playerId !== this.hostId) throw new RoomError('Only the host can do that', 403);
  }

  /* ---------- game flow ---------- */
  start(playerId) {
    this.requireHost(playerId);
    if (this.phase !== 'lobby') throw new RoomError('The game has already started', 409);
    if (this.players.size < MIN_PLAYERS) throw new RoomError(`Need at least ${MIN_PLAYERS} players to start`);
    const pool = this.questions.filter((q) => this.settings.books.includes(q.book));
    if (pool.length === 0) throw new RoomError('No questions match those books');
    this.deck = shuffle(pool, this.rand).slice(0, this.settings.count);
    for (const p of this.players.values()) Object.assign(p, { score: 0, streak: 0, correct: 0 });
    this.index = -1;
    this.nextQuestion();
  }

  nextQuestion() {
    this.index += 1;
    if (this.index >= this.deck.length) {
      this.phase = 'finished';
      this.view = null;
      this.touch();
      return;
    }
    const q = this.deck[this.index];
    const order = shuffle(q.options.map((_, i) => i), this.rand);
    this.view = {
      question: q,
      options: order.map((i) => q.options[i]),
      answerIndex: order.indexOf(q.answerIndex),
    };
    this.answers = new Map();
    this.lastReveal = null;
    this.phase = 'question';
    this.deadline = this.now() + this.settings.time * 1000;
    this.touch();
  }

  /** What every client sees for the open question. The answer is never included. */
  questionPayload() {
    if (!this.view) return null;
    const q = this.view.question;
    return {
      index: this.index,
      total: this.deck.length,
      text: q.question,
      options: this.view.options,
      difficulty: q.difficulty,
      book: q.book,
      category: q.category,
      limit: this.settings.time,
      deadline: this.deadline,
      serverNow: this.now(),
    };
  }

  /** Returns { accepted, everyoneAnswered }. Late, duplicate or invalid answers are ignored. */
  submitAnswer(playerId, choice) {
    const p = this.players.get(playerId);
    const now = this.now();
    if (!p || this.phase !== 'question' || !this.view) return { accepted: false, everyoneAnswered: false };
    if (!Number.isInteger(choice) || choice < 0 || choice >= this.view.options.length) return { accepted: false, everyoneAnswered: false };
    if (this.answers.has(playerId) || now > this.deadline + 250) return { accepted: false, everyoneAnswered: false };
    this.answers.set(playerId, { choice, at: now });
    this.touch();
    return { accepted: true, everyoneAnswered: this.everyoneAnswered() };
  }

  everyoneAnswered() {
    const live = [...this.players.values()].filter((p) => p.connected);
    return live.length > 0 && live.every((p) => this.answers.has(p.id));
  }

  get answeredCount() {
    return this.answers.size;
  }

  /** Score the round and move to the reveal phase. */
  endQuestion() {
    if (this.phase !== 'question' || !this.view) return this.lastReveal;
    const { question, answerIndex } = this.view;
    // No rank movement to report until someone has points (everyone starts tied).
    const anyPoints = [...this.players.values()].some((p) => p.score > 0);
    const before = anyPoints ? new Map(ranked([...this.players.values()]).map(({ p, rank }) => [p.id, rank])) : null;
    const results = [];
    for (const p of this.players.values()) {
      const a = this.answers.get(p.id);
      const correct = !!a && a.choice === answerIndex;
      let points = 0;
      if (correct) {
        const secondsLeft = Math.max(0, (this.deadline - a.at) / 1000);
        points = scoreAnswer(question.difficulty, secondsLeft, this.settings.time, p.streak).total;
        p.score += points;
        p.streak += 1;
        p.correct += 1;
      } else {
        p.streak = 0;
      }
      results.push({ id: p.id, name: p.name, choice: a ? a.choice : null, correct, points, streak: p.streak });
    }
    this.lastRoundPoints = results;
    const scoreboard = this.scoreboard(before);
    this.phase = 'reveal';
    this.lastReveal = {
      index: this.index,
      total: this.deck.length,
      answerIndex,
      explanation: question.explanation,
      results,
      scoreboard,
      isLast: this.index + 1 >= this.deck.length,
      revealMs: REVEAL_MS,
    };
    this.touch();
    return this.lastReveal;
  }

  scoreboard(prevRanks) {
    const delta = new Map((this.lastRoundPoints ?? []).map((r) => [r.id, r.points]));
    return ranked([...this.players.values()]).map(({ p, rank }) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      rank,
      prevRank: prevRanks ? prevRanks.get(p.id) ?? rank : rank,
      streak: p.streak,
      correct: p.correct,
      connected: p.connected,
      delta: delta.get(p.id) ?? 0,
    }));
  }

  finalPayload() {
    return { total: this.deck.length, scoreboard: this.scoreboard() };
  }

  rematch(playerId) {
    this.requireHost(playerId);
    if (this.phase !== 'finished') throw new RoomError('The game is not finished', 409);
    this.phase = 'lobby';
    this.deck = [];
    this.index = -1;
    this.view = null;
    this.lastReveal = null;
    for (const [id, p] of this.players) {
      if (!p.connected) this.players.delete(id);
      else Object.assign(p, { score: 0, streak: 0, correct: 0 });
    }
    if (!this.players.has(this.hostId)) this.migrateHost();
    this.touch();
  }

  /** Everything a (re)connecting client needs to draw the right screen. */
  snapshot(playerId) {
    const you = this.players.get(playerId);
    return {
      code: this.code,
      phase: this.phase,
      youId: playerId,
      hostId: this.hostId,
      players: this.publicPlayers(),
      settings: this.settings,
      question: this.phase === 'question' || this.phase === 'reveal' ? this.questionPayload() : null,
      answered: this.phase === 'question' ? { count: this.answers.size, total: this.connectedCount, yours: this.answers.has(playerId) ? this.answers.get(playerId).choice : null } : null,
      reveal: this.phase === 'reveal' ? this.lastReveal : null,
      final: this.phase === 'finished' ? this.finalPayload() : null,
      score: you ? you.score : 0,
      streak: you ? you.streak : 0,
    };
  }
}
