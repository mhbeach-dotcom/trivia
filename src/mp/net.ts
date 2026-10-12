import { io, type Socket } from "socket.io-client";
import type { Session, Settings } from "./types";

// Where the multiplayer server lives. Empty means "same origin", which is how it works when the
// Node server (server/src/index.js) serves the built game itself. For a static host such as
// GitHub Pages, set VITE_MP_URL at build time to the server's address.
const BASE = ((import.meta.env.VITE_MP_URL as string | undefined) ?? "").replace(/\/$/, "");

/** False on a static host with no server configured, so we can say so instead of failing mysteriously. */
export const multiplayerConfigured = BASE !== "" || !location.hostname.endsWith("github.io");

export class ApiError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 15000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/api${path}`, { headers: { "Content-Type": "application/json" }, signal: ctl.signal, ...init });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new ApiError(data.error ?? "Request failed", res.status);
    return data as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("Can't reach the multiplayer server");
  } finally {
    clearTimeout(t);
  }
}

const post = <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

/**
 * Free hosting spins servers down when idle, so the first request can take a minute.
 * Poll the health endpoint until it answers.
 */
export async function waitForServer(onStatus: (msg: string) => void, maxMs = 75000): Promise<boolean> {
  const start = Date.now();
  let first = true;
  while (Date.now() - start < maxMs) {
    try {
      await request("/health", undefined, 8000);
      return true;
    } catch (err) {
      // A 404 means this host answers but has no game server behind it: no point waiting.
      if (err instanceof ApiError && err.status === 404) return false;
      if (first) onStatus("Waking the server up… this can take up to a minute.");
      first = false;
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
  return false;
}

export const api = {
  create: (name: string) => post<Session>("/mp/rooms", { name }),
  join: (code: string, name: string) => post<Session>(`/mp/rooms/${code}/join`, { name }),
  info: (code: string) => request<{ code: string; phase: string; players: number; full: boolean }>(`/mp/rooms/${code}`),
  leave: (s: Session) => post(`/mp/rooms/${s.code}/leave`, { playerId: s.playerId }),
  settings: (s: Session, patch: Partial<Settings>) => post(`/mp/rooms/${s.code}/settings`, { playerId: s.playerId, ...patch }),
  start: (s: Session) => post(`/mp/rooms/${s.code}/start`, { playerId: s.playerId }),
  next: (s: Session) => post(`/mp/rooms/${s.code}/next`, { playerId: s.playerId }),
  rematch: (s: Session) => post(`/mp/rooms/${s.code}/rematch`, { playerId: s.playerId }),
};

export function createSocket(): Socket {
  return io(BASE || undefined, { autoConnect: false });
}

/* ---------- remembered session (per tab, so two tabs can play as two people) ---------- */
const KEY = "arena-mp-session";
export function saveSession(s: Session): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
}
export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
export function clearSession(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
