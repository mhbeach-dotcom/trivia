import type { Socket } from "socket.io-client";
import { BOOKS, type BookId } from "../types";
import { showScreen } from "../ui/screens";
import { sfx } from "../ui/sound";
import { burst, buzz, confetti, countUp, flash, floatText, reducedMotion, replay } from "../ui/fx";
import { ApiError, api, clearSession, createSocket, loadSession, multiplayerConfigured, saveSession, waitForServer } from "./net";
import type { FinalPayload, LobbyUpdate, Phase, Player, QuestionPayload, RevealPayload, ScoreRow, Session, Settings, Snapshot } from "./types";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const COUNTS = [5, 10, 15, 20];
const TIMES = [10, 20, 30];
const ALL_BOOKS = Object.keys(BOOKS) as BookId[];
const TIER = { easy: "Easy", medium: "Medium", hard: "Hard" } as const;
const NAME_KEY = "arena-mp-name";

let goHome: () => void = () => {};
let session: Session | null = null;
let socket: Socket | null = null;
let players: Player[] = [];
let hostId: string | null = null;
let settings: Settings = { count: 10, time: 20, books: [...ALL_BOOKS] };
let phase: Phase = "lobby";
let question: QuestionPayload | null = null;
let clockOffset = 0;
let myChoice: number | null = null;
let timerId: number | null = null;
let knownIds = new Set<string>();
let leaving = false;

const isHost = () => !!session && session.playerId === hostId;

function say(el: HTMLElement, msg: string, kind: "" | "error" = ""): void {
  el.textContent = msg;
  el.classList.toggle("error", kind === "error");
}

function avatar(name: string): HTMLElement {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const a = document.createElement("span");
  a.className = "avatar";
  a.style.background = `hsl(${h} 55% 38%)`;
  a.textContent = [...name][0]?.toUpperCase() ?? "?";
  return a;
}

/* ============================================================ entry */
export function openMultiplayer(prefillCode = ""): void {
  showScreen("screen-mp-entry");
  const msg = $("mpMsg");
  say(msg, "");
  $<HTMLInputElement>("mpName").value = localStorage.getItem(NAME_KEY) ?? "";
  $<HTMLInputElement>("mpCode").value = prefillCode.toUpperCase();
  const ok = multiplayerConfigured;
  ["mpCreate", "mpJoin"].forEach((id) => (($(id) as HTMLButtonElement).disabled = !ok));
  if (!ok) say(msg, "Multiplayer isn't set up on this site yet. It needs a game server (see the README).", "error");
  else if (prefillCode) $<HTMLInputElement>("mpName").focus();
}

function busy(on: boolean, msg = ""): void {
  ["mpCreate", "mpJoin", "mpBack"].forEach((id) => (($(id) as HTMLButtonElement).disabled = on));
  say($("mpMsg"), msg);
}

async function begin(action: () => Promise<Session>): Promise<void> {
  const name = $<HTMLInputElement>("mpName").value.trim();
  if (!name) return say($("mpMsg"), "Enter your name first.", "error");
  try { localStorage.setItem(NAME_KEY, name); } catch { /* ignore */ }
  busy(true, "Connecting…");
  try {
    if (!(await waitForServer((m) => say($("mpMsg"), m)))) {
      busy(false);
      return say($("mpMsg"), "Can't reach the multiplayer server. Try again in a moment.", "error");
    }
    const s = await action();
    busy(false);
    enterRoom(s);
  } catch (err) {
    busy(false);
    say($("mpMsg"), err instanceof ApiError ? err.message : "Something went wrong.", "error");
  }
}

/* ============================================================ connection */
function enterRoom(s: Session): void {
  session = s;
  saveSession(s);
  leaving = false;
  knownIds = new Set();
  $("mpRoomCode").textContent = s.code;
  say($("mpLobbyMsg"), "");
  showScreen("screen-mp-lobby");
  connect();
}

function banner(show: boolean): void {
  $("mpBanner").hidden = !show;
}

function connect(): void {
  if (!session) return;
  socket?.removeAllListeners();
  socket?.disconnect();
  const s = (socket = createSocket());
  const { code, playerId } = session;

  s.on("connect", () => {
    banner(false);
    s.emit("join_room", { code, playerId }, (res: { ok: boolean }) => {
      if (!res?.ok) roomGone();
    });
  });
  s.on("disconnect", () => {
    if (!leaving) banner(true);
  });
  s.on("snapshot", applySnapshot);
  s.on("lobby_update", onLobbyUpdate);
  s.on("lobby_reset", () => {
    phase = "lobby";
    stopTimer();
    showScreen("screen-mp-lobby");
    renderLobby();
  });
  s.on("question", (q: QuestionPayload) => onQuestion(q, null));
  s.on("answer_progress", onProgress);
  s.on("reveal", onReveal);
  s.on("finished", onFinished);
  s.connect();
}

function teardown(): void {
  leaving = true;
  stopTimer();
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
  session = null;
  clearSession();
  banner(false);
}

function roomGone(): void {
  teardown();
  openMultiplayer();
  say($("mpMsg"), "That room no longer exists.", "error");
}

async function leaveRoom(): Promise<void> {
  const s = session;
  teardown();
  if (s) await api.leave(s).catch(() => {});
  sfx("click");
  goHome();
}

/* ============================================================ state in */
function applySnapshot(s: Snapshot): void {
  players = s.players;
  hostId = s.hostId;
  settings = s.settings;
  phase = s.phase;
  switch (s.phase) {
    case "lobby":
      showScreen("screen-mp-lobby");
      renderLobby();
      break;
    case "question":
      if (s.question) onQuestion(s.question, s.answered?.yours ?? null, s);
      break;
    case "reveal":
      if (s.question && s.reveal) {
        onQuestion(s.question, null, s, true);
        onReveal(s.reveal, true);
      }
      break;
    case "finished":
      if (s.final) onFinished(s.final);
      break;
  }
}

function onLobbyUpdate(u: LobbyUpdate): void {
  players = u.players;
  hostId = u.hostId;
  settings = u.settings;
  if ($("screen-mp-lobby").classList.contains("active")) renderLobby();
  // The host may have changed mid-game: show/hide host-only controls.
  if (phase === "reveal") $("mpNext").hidden = !isHost();
  if (phase === "finished") renderFinalButtons();
}

/* ============================================================ lobby */
function renderLobby(): void {
  const host = isHost();
  $("mpRoomCode").textContent = session?.code ?? "----";
  $("mpCount").textContent = `${players.length}/8`;

  const list = $("mpPlayers");
  list.replaceChildren();
  for (const p of players) {
    const li = document.createElement("li");
    li.className = "player" + (p.connected ? "" : " offline") + (knownIds.has(p.id) ? "" : " joined");
    const name = document.createElement("span");
    name.className = "pname";
    name.textContent = p.name;
    li.append(avatar(p.name), name);
    if (p.isHost) li.append(Object.assign(document.createElement("span"), { className: "tag host", textContent: "👑 Host" }));
    if (p.id === session?.playerId) li.append(Object.assign(document.createElement("span"), { className: "tag you", textContent: "You" }));
    if (!p.connected) li.append(Object.assign(document.createElement("span"), { className: "tag", textContent: "offline" }));
    list.append(li);
  }
  knownIds = new Set(players.map((p) => p.id));

  const box = $("mpSettings");
  box.replaceChildren();
  if (host) {
    const row = (label: string, chips: HTMLElement[]) => {
      const wrap = document.createElement("div");
      wrap.className = "setting";
      const h = document.createElement("h4");
      h.textContent = label;
      const c = document.createElement("div");
      c.className = "chips";
      c.append(...chips);
      wrap.append(h, c);
      box.append(wrap);
    };
    const chip = (text: string, on: boolean, patch: () => Promise<unknown>) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = text;
      b.setAttribute("aria-pressed", String(on));
      b.addEventListener("click", async () => {
        sfx("click");
        try { await patch(); } catch (e) { say($("mpLobbyMsg"), e instanceof ApiError ? e.message : "Couldn't change that.", "error"); }
      });
      return b;
    };
    row("Questions", COUNTS.map((n) => chip(String(n), settings.count === n, () => api.settings(session!, { count: n }))));
    row("Seconds each", TIMES.map((t) => chip(`${t}s`, settings.time === t, () => api.settings(session!, { time: t }))));
    row("Books", ALL_BOOKS.map((b) => chip(BOOKS[b], settings.books.includes(b), () => {
      const next = settings.books.includes(b) ? settings.books.filter((x) => x !== b) : [...settings.books, b];
      if (next.length === 0) return Promise.resolve();
      return api.settings(session!, { books: next });
    })));
  } else {
    const p = document.createElement("p");
    p.className = "muted";
    const books = settings.books.length === ALL_BOOKS.length ? "all five books" : settings.books.map((b) => BOOKS[b]).join(", ");
    p.textContent = `${settings.count} questions · ${settings.time} seconds each · ${books}. The host can change these.`;
    box.append(p);
  }

  const start = $<HTMLButtonElement>("mpStart");
  start.hidden = !host;
  start.disabled = players.length < 2;
  const msg = $("mpLobbyMsg");
  if (!msg.classList.contains("error")) {
    say(msg, host ? (players.length < 2 ? "Waiting for at least one more player to join…" : "Everyone in? Start when you're ready.") : "Waiting for the host to start the game…");
  }
}

/* ============================================================ question */
function stopTimer(): void {
  if (timerId !== null) clearInterval(timerId);
  timerId = null;
}

function onQuestion(q: QuestionPayload, yours: number | null, snap?: Snapshot, revealing = false): void {
  phase = "question";
  question = q;
  clockOffset = q.serverNow - Date.now();
  myChoice = yours;

  showScreen("screen-mp-game");
  $("screen-mp-game").classList.remove("revealing");
  $("mpHudLabel").textContent = `Room ${session?.code ?? ""}`;
  if (snap) {
    $("mpScore").dataset.v = String(snap.score);
    $("mpScore").textContent = snap.score.toLocaleString();
    $("mpStreakNum").textContent = String(snap.streak);
  }
  const badge = $("mpBadge");
  badge.textContent = `${TIER[q.difficulty]}`;
  badge.className = `diff-badge diff-${q.difficulty}`;
  replay(badge, "pop");
  $("mpQCount").textContent = `Question ${q.index + 1} of ${q.total} · ${BOOKS[q.book]}`;
  $("mpProgress").style.width = `${(q.index / q.total) * 100}%`;
  $("mpQText").textContent = q.text;
  replay($("mpCard"), "enter");

  const opts = $("mpOpts");
  opts.replaceChildren();
  q.options.forEach((text, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "opt";
    b.style.setProperty("--i", String(i));
    b.innerHTML = '<span class="letter"></span><span class="otext"></span>';
    b.querySelector(".letter")!.textContent = "ABCD"[i];
    b.querySelector(".otext")!.textContent = text;
    b.addEventListener("click", () => choose(i));
    opts.append(b);
  });

  const intel = $("mpIntel");
  intel.className = "intel";
  intel.replaceChildren();
  $("mpNext").hidden = true;
  $("mpRevealBar").hidden = true;
  if (yours !== null) lockOptions(yours);

  say($("mpStatus"), yours !== null ? "Locked in! Waiting for the others…" : "");
  if (snap?.answered) onProgress({ count: snap.answered.count, total: snap.answered.total });
  if (!revealing) startTimer();
}

function lockOptions(picked: number | null): void {
  Array.from($("mpOpts").children).forEach((el, i) => {
    const b = el as HTMLButtonElement;
    b.disabled = true;
    if (i === picked) b.classList.add("picked");
  });
}

function choose(i: number): void {
  if (myChoice !== null || !socket || phase !== "question") return;
  myChoice = i;
  lockOptions(i);
  sfx("click");
  buzz(15);
  say($("mpStatus"), "Locked in! Waiting for the others…");
  socket.emit("answer", { choice: i }, (res: { ok: boolean }) => {
    if (res?.ok) return;
    // Too late or rejected: let the server's reveal arrive, but tell the player.
    say($("mpStatus"), "Too late, that one didn't count.");
  });
}

function onProgress(p: { count: number; total: number }): void {
  if (phase !== "question") return;
  const prefix = myChoice !== null ? "Locked in! " : "";
  say($("mpStatus"), `${prefix}${p.count}/${p.total} answered`);
}

function startTimer(): void {
  stopTimer();
  const q = question;
  if (!q) return;
  const fill = $("mpTimerFill");
  const label = $("mpTime");
  fill.className = "";
  label.className = "time";
  let lastWhole = -1;
  const tick = () => {
    const left = Math.max(0, (q.deadline - (Date.now() + clockOffset)) / 1000);
    const pct = Math.min(100, (left / q.limit) * 100);
    fill.style.width = `${pct}%`;
    fill.className = pct < 25 ? "danger" : pct < 55 ? "warn" : "";
    const whole = Math.ceil(left);
    if (whole !== lastWhole) {
      lastWhole = whole;
      label.textContent = String(whole);
      if (whole <= 5 && whole > 0) {
        sfx("tick");
        label.className = "time urgent";
        replay(label, "tickpulse");
      }
    }
    if (left <= 0) {
      stopTimer();
      if (myChoice === null) {
        lockOptions(null);
        say($("mpStatus"), "Time's up! Waiting for results…");
      }
    }
  };
  tick();
  timerId = window.setInterval(tick, 100);
}

/* ============================================================ reveal */
function scoreRows(board: ScoreRow[]): ScoreRow[] {
  const me = session?.playerId;
  const top = board.slice(0, 4);
  const mine = board.find((r) => r.id === me);
  return mine && !top.includes(mine) ? [...top, mine] : top;
}

function onReveal(r: RevealPayload, restored = false): void {
  phase = "reveal";
  stopTimer();
  $("screen-mp-game").classList.add("revealing");
  const me = session?.playerId;
  const mine = r.results.find((x) => x.id === me);
  const board = r.scoreboard.find((x) => x.id === me);

  Array.from($("mpOpts").children).forEach((el, i) => {
    const b = el as HTMLButtonElement;
    b.disabled = true;
    b.classList.remove("picked");
    if (i === r.answerIndex) b.classList.add("correct");
    else if (mine && mine.choice === i) b.classList.add("wrong", "shake");
  });

  const intel = $("mpIntel");
  intel.replaceChildren();
  const verdict = document.createElement("div");
  verdict.className = "verdict";
  if (mine?.correct) {
    verdict.innerHTML = '✓ Correct! <span class="pts"></span>';
    verdict.querySelector(".pts")!.textContent = `+${mine.points}`;
    intel.className = "intel show good";
  } else {
    verdict.textContent = mine && mine.choice === null ? "⏱ Time ran out!" : "✗ Not quite.";
    intel.className = "intel show bad";
  }
  const why = document.createElement("div");
  why.className = "why";
  why.textContent = r.explanation;
  intel.append(verdict, why, scoreboardEl(r));

  if (board) {
    countUp($("mpScore"), board.score, restored ? 0 : 800);
    $("mpStreakNum").textContent = String(board.streak);
    $("mpStreak").classList.toggle("hot", board.streak >= 3);
    const pill = $("mpRank");
    pill.textContent = `#${board.rank}`;
    replay(pill, "pop");
  }

  if (!restored) {
    const rect = ($("mpOpts").children[r.answerIndex] as HTMLElement).getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    if (mine?.correct) {
      sfx("correct");
      buzz(30);
      flash("good");
      burst(cx, cy, "#e8b33d");
      floatText(`+${mine.points}`, cx, cy, "good");
      replay($("mpCard"), "glow");
    } else {
      sfx("wrong");
      buzz([60, 40, 60]);
      flash("bad");
      replay($("mpCard"), "shake");
    }
  }

  say($("mpStatus"), r.isLast ? "Final results coming up…" : "Next question coming up…");
  const bar = $("mpRevealBar");
  bar.hidden = false;
  bar.style.setProperty("--ms", `${r.revealMs}ms`);
  const fresh = bar.cloneNode(true) as HTMLElement;
  bar.replaceWith(fresh);
  const next = $("mpNext");
  next.hidden = !isHost();
  next.textContent = r.isLast ? "SEE RESULTS →" : "NEXT →";
  // Portrait stacks the scoreboard below the answers; bring it into view.
  if (!restored && !reducedMotion() && matchMedia("(orientation: portrait)").matches) {
    $("mpIntel").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function scoreboardEl(r: RevealPayload): HTMLElement {
  const ul = document.createElement("ul");
  ul.className = "scoreboard";
  scoreRows(r.scoreboard).forEach((row, i) => {
    const li = document.createElement("li");
    li.className = "srow" + (row.id === session?.playerId ? " me" : "");
    li.style.setProperty("--i", String(i));
    const rank = document.createElement("span");
    rank.className = "srank";
    const move = row.prevRank - row.rank;
    rank.textContent = `${row.rank}`;
    if (move > 0) rank.append(Object.assign(document.createElement("small"), { className: "up", textContent: "▲" }));
    else if (move < 0) rank.append(Object.assign(document.createElement("small"), { className: "down", textContent: "▼" }));
    const name = document.createElement("span");
    name.className = "sname";
    name.textContent = row.name;
    const gain = document.createElement("span");
    gain.className = "sgain";
    gain.textContent = row.delta > 0 ? `+${row.delta}` : "";
    const total = document.createElement("span");
    total.className = "stotal";
    total.textContent = row.score.toLocaleString();
    li.append(rank, avatar(row.name), name, gain, total);
    ul.append(li);
  });
  return ul;
}

/* ============================================================ final */
function renderFinalButtons(): void {
  const host = isHost();
  $("mpRematch").hidden = !host;
  say($("mpFinalMsg"), host ? "" : "Waiting for the host to start another round…");
}

function onFinished(f: FinalPayload): void {
  phase = "finished";
  stopTimer();
  showScreen("screen-mp-final");
  const me = f.scoreboard.find((r) => r.id === session?.playerId);
  const won = !!me && me.rank === 1;
  $("mpTrophy").textContent = won ? "🏆" : me?.rank === 2 ? "🥈" : me?.rank === 3 ? "🥉" : "🎖️";
  replay($("mpTrophy"), "bounce");
  $("mpFinalTitle").textContent = won ? (f.scoreboard.filter((r) => r.rank === 1).length > 1 ? "IT'S A TIE!" : "YOU WON!") : `${f.scoreboard[0]?.name ?? ""} WINS`;
  $("mpFinalSub").textContent = me ? `You finished #${me.rank} with ${me.score.toLocaleString()} points` : "";

  const podium = $("mpPodium");
  podium.replaceChildren();
  // Visual order: 2nd, 1st, 3rd, so the winner stands in the middle.
  const top = f.scoreboard.slice(0, 3);
  const order = top.length === 3 ? [top[1], top[0], top[2]] : top;
  order.forEach((row) => {
    const col = document.createElement("div");
    col.className = `pod pod-${Math.min(row.rank, 3)}`;
    const nm = document.createElement("div");
    nm.className = "pod-name";
    nm.textContent = row.name;
    const pts = document.createElement("div");
    pts.className = "pod-pts";
    pts.textContent = row.score.toLocaleString();
    const block = document.createElement("div");
    block.className = "pod-block";
    block.textContent = String(row.rank);
    col.append(avatar(row.name), nm, pts, block);
    podium.append(col);
  });

  const list = $("mpRanking");
  list.replaceChildren();
  f.scoreboard.forEach((row, i) => {
    const li = document.createElement("li");
    li.className = "srow" + (row.id === session?.playerId ? " me" : "");
    li.style.setProperty("--i", String(i));
    const rank = Object.assign(document.createElement("span"), { className: "srank", textContent: String(row.rank) });
    const name = Object.assign(document.createElement("span"), { className: "sname", textContent: row.name });
    const detail = Object.assign(document.createElement("span"), { className: "sgain", textContent: `${row.correct}/${f.total}` });
    const total = Object.assign(document.createElement("span"), { className: "stotal", textContent: row.score.toLocaleString() });
    li.append(rank, avatar(row.name), name, detail, total);
    list.append(li);
  });
  renderFinalButtons();
  if (won) {
    confetti();
    sfx("fanfare");
  } else sfx("gameover");
}

/* ============================================================ wiring */
export function initMultiplayer(opts: { goHome: () => void }): void {
  goHome = opts.goHome;

  $("mpCreate").addEventListener("click", () => begin(() => api.create($<HTMLInputElement>("mpName").value)));
  $("mpJoin").addEventListener("click", () => {
    const code = $<HTMLInputElement>("mpCode").value.trim().toUpperCase();
    if (!/^[A-Z2-9]{4}$/.test(code)) return say($("mpMsg"), "Room codes are 4 letters or numbers.", "error");
    return begin(() => api.join(code, $<HTMLInputElement>("mpName").value));
  });
  $("mpCode").addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });
  $("mpBack").addEventListener("click", () => {
    sfx("click");
    goHome();
  });

  const link = () => `${location.origin}${location.pathname}?join=${session?.code ?? ""}`;
  $("mpCopy").addEventListener("click", async () => {
    sfx("click");
    try {
      await navigator.clipboard.writeText(session?.code ?? "");
      $("mpCopy").textContent = "COPIED!";
      setTimeout(() => ($("mpCopy").textContent = "COPY CODE"), 1500);
    } catch { /* clipboard blocked */ }
  });
  $("mpShare").addEventListener("click", async () => {
    sfx("click");
    const text = `Join my Arena Trivia room with code ${session?.code}`;
    try {
      if (navigator.share) await navigator.share({ title: "Arena Trivia", text, url: link() });
      else {
        await navigator.clipboard.writeText(`${text}: ${link()}`);
        $("mpShare").textContent = "LINK COPIED!";
        setTimeout(() => ($("mpShare").textContent = "SHARE LINK"), 1500);
      }
    } catch { /* cancelled */ }
  });

  $("mpStart").addEventListener("click", async () => {
    if (!session) return;
    sfx("click");
    try {
      say($("mpLobbyMsg"), "");
      await api.start(session);
    } catch (e) {
      say($("mpLobbyMsg"), e instanceof ApiError ? e.message : "Couldn't start the game.", "error");
    }
  });
  $("mpLeave").addEventListener("click", leaveRoom);
  $("mpFinalLeave").addEventListener("click", leaveRoom);
  $("mpNext").addEventListener("click", () => {
    if (session) void api.next(session).catch(() => {});
  });
  $("mpRematch").addEventListener("click", async () => {
    if (!session) return;
    sfx("click");
    try { await api.rematch(session); } catch (e) { say($("mpFinalMsg"), e instanceof ApiError ? e.message : "Couldn't restart.", "error"); }
  });

  document.addEventListener("keydown", (e) => {
    if (!$("screen-mp-game").classList.contains("active")) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 4 && phase === "question") choose(n - 1);
    else if ((e.key === "Enter" || e.key === " ") && phase === "reveal" && isHost()) {
      e.preventDefault();
      $("mpNext").click();
    }
  });
}

/** Called once at startup: rejoin a room after a refresh, or open the join form from an invite link. */
export async function resumeMultiplayer(): Promise<boolean> {
  const saved = loadSession();
  if (saved) {
    try {
      await api.info(saved.code);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        clearSession();
        return false;
      }
      // Server unreachable (maybe waking up): still try, the socket keeps retrying.
    }
    enterRoom(saved);
    return true;
  }
  const code = new URLSearchParams(location.search).get("join");
  if (code && /^[A-Za-z0-9]{4}$/.test(code)) {
    openMultiplayer(code);
    return true;
  }
  return false;
}
