import { BOOKS, type BookId, type Mode } from "../types";
import { Game, MODE_CONFIG, localDateKey, type EndReason, type Outcome } from "../game/engine";
import { ALL_QUESTIONS } from "../game/data";
import { basePoints } from "../game/scoring";
import { exportStats, importStats, loadStats, saveStats } from "../storage";
import { sfx, setMuted } from "./sound";
import { burst, buzz, confetti, countUp, floatText, flash, initFx, reducedMotion, replay } from "./fx";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const TIER_LABEL = { easy: "Easy", medium: "Medium", hard: "Hard" } as const;
const MODES = Object.keys(MODE_CONFIG) as Mode[];
const selectedBooks = new Set<BookId>(Object.keys(BOOKS) as BookId[]);

let game: Game | null = null;
let timerId: number | null = null;
let deadline = 0;
let secondsLeft = 0;
let lastShare = "";
let lastMode: Mode = "quick";
let muted = false;

/* ---------- screens ---------- */
function showScreen(id: string): void {
  document.querySelectorAll<HTMLElement>(".screen").forEach((s) => s.classList.remove("active"));
  const el = $(id);
  el.classList.add("active");
  replay(el, "enter");
  window.scrollTo(0, 0);
}

/* ---------- start screen ---------- */
function renderModes(): void {
  const stats = loadStats();
  const today = localDateKey();
  const box = $("modes");
  box.replaceChildren();
  MODES.forEach((mode, i) => {
    const cfg = MODE_CONFIG[mode];
    const dailyDone = mode === "daily" && stats.dailyDone === today;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "mode-card";
    card.style.setProperty("--i", String(i));
    card.disabled = dailyDone;
    const blurb = dailyDone ? `Done today ${stats.dailyResult ?? ""}` : cfg.blurb;
    const best = mode === "daily" ? "" : `<span class="mode-best">BEST<b>${(stats.best[mode] ?? 0).toLocaleString()}</b></span>`;
    card.innerHTML = `<span class="mode-icon">${cfg.icon}</span><span class="mode-text"><h3></h3><p></p></span>${best}`;
    card.querySelector("h3")!.textContent = cfg.name;
    card.querySelector("p")!.textContent = blurb;
    card.addEventListener("click", (e) => {
      ripple(card, e);
      sfx("click");
      setTimeout(() => startGame(mode), reducedMotion() ? 0 : 140);
    });
    box.append(card);
  });
  $("best-streak").textContent = String(stats.bestStreak);
  $("games-played").textContent = String(stats.gamesPlayed);
  $("qTotal").textContent = String(ALL_QUESTIONS.length);
}

function renderChips(): void {
  const box = $("chips");
  box.replaceChildren();
  (Object.keys(BOOKS) as BookId[]).forEach((id) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = BOOKS[id];
    chip.setAttribute("aria-pressed", String(selectedBooks.has(id)));
    chip.addEventListener("click", () => {
      if (selectedBooks.has(id)) {
        if (selectedBooks.size > 1) selectedBooks.delete(id);
      } else selectedBooks.add(id);
      sfx("click");
      chip.setAttribute("aria-pressed", String(selectedBooks.has(id)));
      replay(chip, "pop");
    });
    box.append(chip);
  });
}

function ripple(el: HTMLElement, e: MouseEvent): void {
  if (reducedMotion()) return;
  const r = el.getBoundingClientRect();
  const dot = document.createElement("span");
  dot.className = "ripple";
  dot.style.left = `${e.clientX - r.left}px`;
  dot.style.top = `${e.clientY - r.top}px`;
  el.append(dot);
  dot.addEventListener("animationend", () => dot.remove());
}

/* ---------- game ---------- */
function startGame(mode: Mode): void {
  lastMode = mode;
  game = new Game({ mode, pool: ALL_QUESTIONS, books: [...selectedBooks] });
  if (game.over) {
    game = null;
    return;
  }
  const cfg = game.cfg;
  $("hudMode").textContent = `${cfg.icon} ${cfg.name}`;
  $("hudScore").dataset.v = "0";
  $("hudScore").textContent = "0";
  $("timerRow").hidden = cfg.time === 0;
  showScreen("screen-game");
  renderQuestion();
}

function renderQuestion(): void {
  const g = game!;
  const v = g.current;
  if (!v) return endGame();
  const q = v.question;

  const badge = $("diffBadge");
  badge.textContent = `${TIER_LABEL[q.difficulty]} · ${basePoints(q.difficulty)}`;
  badge.className = `diff-badge diff-${q.difficulty}`;
  replay(badge, "pop");

  $("qCount").textContent =
    g.mode === "survival" ? `Question ${g.idx + 1} · ${BOOKS[q.book]}` : `Question ${g.idx + 1} of ${g.total} · ${BOOKS[q.book]}`;
  $("progress").hidden = g.mode === "survival";
  $("progressFill").style.width = `${(g.idx / g.deck.length) * 100}%`;

  $("qText").textContent = q.question;
  replay($("qcard"), "enter");

  const box = $("opts");
  box.replaceChildren();
  const letters = ["A", "B", "C", "D"];
  v.options.forEach((text, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "opt";
    b.dataset.i = String(i);
    b.style.setProperty("--i", String(i));
    b.innerHTML = '<span class="letter"></span><span class="otext"></span>';
    b.querySelector(".letter")!.textContent = letters[i];
    b.querySelector(".otext")!.textContent = text;
    b.addEventListener("click", () => submit(i));
    box.append(b);
  });

  $("screen-game").classList.remove("resolved");
  const intel = $("intel");
  intel.className = "intel";
  intel.replaceChildren();
  $("nextBtn").className = "";
  updateHud();
  startTimer();
}

function updateHud(bump = false): void {
  const g = game!;
  countUp($("hudScore"), g.score, bump ? 700 : 0);
  $("streakNum").textContent = String(g.streak);
  const streak = $("hudStreak");
  streak.classList.toggle("hot", g.streak >= 3);
  streak.classList.toggle("blaze", g.streak >= 6);

  const hearts = $("hudHearts");
  hearts.hidden = g.cfg.hearts === 0;
  if (g.cfg.hearts) {
    hearts.setAttribute("aria-label", `${g.hearts} hearts left`);
    const have = hearts.children.length;
    if (have !== g.cfg.hearts) {
      hearts.replaceChildren();
      for (let i = 0; i < g.cfg.hearts; i++) {
        const h = document.createElement("span");
        h.className = "heart";
        h.textContent = "❤️";
        hearts.append(h);
      }
    }
    Array.from(hearts.children).forEach((h, i) => {
      const alive = i < g.hearts;
      const el = h as HTMLElement;
      if (!alive && el.textContent !== "🖤") {
        el.textContent = "🖤";
        replay(el, "break");
      }
    });
  }

  $("nFifty").textContent = `${g.lives.fifty} left`;
  $("nSkip").textContent = `${g.lives.skip} left`;
  $("nSecond").textContent = `${g.lives.second} left`;
  const open = !g.isResolved;
  $<HTMLButtonElement>("lifeFifty").disabled = g.lives.fifty <= 0 || !open;
  $<HTMLButtonElement>("lifeSkip").disabled = g.lives.skip <= 0 || !open;
  $<HTMLButtonElement>("lifeSecond").disabled = g.lives.second <= 0 || !open || g.secondArmed;
  $("lifeSecond").classList.toggle("armed", g.secondArmed);
}

/* ---------- timer ---------- */
function stopTimer(): void {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
}

function startTimer(): void {
  stopTimer();
  const g = game!;
  const limit = g.cfg.time;
  if (!limit) return;
  const fill = $("timerFill");
  const label = $("timeText");
  deadline = performance.now() + limit * 1000;
  secondsLeft = limit;
  fill.className = "";
  fill.style.width = "100%";
  label.textContent = String(limit);
  label.className = "time";
  let lastWhole = limit;
  timerId = window.setInterval(() => {
    secondsLeft = Math.max(0, (deadline - performance.now()) / 1000);
    const pct = (secondsLeft / limit) * 100;
    fill.style.width = `${pct}%`;
    fill.className = pct < 25 ? "danger" : pct < 55 ? "warn" : "";
    const whole = Math.ceil(secondsLeft);
    if (whole !== lastWhole) {
      lastWhole = whole;
      label.textContent = String(whole);
      if (whole <= 5 && whole > 0) {
        sfx("tick");
        label.className = "time urgent";
        replay(label, "tickpulse");
      }
    }
    if (secondsLeft <= 0) {
      stopTimer();
      submit(null);
    }
  }, 100);
}

/* ---------- answering ---------- */
function submit(choice: number | null): void {
  const g = game;
  if (!g || g.isResolved) return;
  const buttons = Array.from($("opts").children) as HTMLButtonElement[];
  if (choice !== null && buttons[choice].disabled) return;
  const out: Outcome = g.answer(choice, secondsLeft);

  if (out.kind === "retry") {
    const b = buttons[out.eliminated];
    b.disabled = true;
    b.classList.add("eliminated", "shake");
    sfx("life");
    buzz(20);
    updateHud();
    return;
  }

  stopTimer();
  $("screen-game").classList.add("resolved");
  buttons.forEach((b, i) => {
    b.disabled = true;
    if (i === out.answerIndex) b.classList.add("correct");
  });
  const picked = choice === null ? null : buttons[choice];
  const rect = (picked ?? buttons[out.answerIndex]).getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  const intel = $("intel");
  intel.replaceChildren();
  const verdict = document.createElement("div");
  verdict.className = "verdict";
  const detail = document.createElement("div");
  detail.className = "detail";
  const why = document.createElement("div");
  why.className = "why";
  why.textContent = g.current!.question.explanation;

  if (out.correct) {
    sfx("correct");
    buzz(30);
    flash("good");
    burst(cx, cy, "#e8b33d");
    burst(cx, cy, "#3ddc84", 8);
    floatText(`+${out.points}`, cx, cy, "good");
    replay($("qcard"), "glow");
    replay($("hudStreak"), "pop");
    verdict.innerHTML = `✓ Correct! <span class="pts"></span>`;
    verdict.querySelector(".pts")!.textContent = `+${out.points}`;
    const bits: string[] = [];
    if (out.speed) bits.push(`speed +${out.speed}`);
    if (out.streakBonus) bits.push(`streak +${out.streakBonus}`);
    detail.textContent = bits.join(" · ");
    intel.className = "intel show good";
    updateHud(true);
  } else {
    sfx("wrong");
    buzz([60, 40, 60]);
    flash("bad");
    if (picked) picked.classList.add("wrong", "shake");
    replay($("qcard"), "shake");
    if (out.heartLost) sfx("heart");
    verdict.textContent = out.timedOut ? "⏱ Time ran out!" : "✗ Not quite.";
    detail.textContent = `Answer: ${g.current!.options[out.answerIndex]}`;
    detail.classList.add("answer");
    intel.className = "intel show bad";
    updateHud();
  }
  intel.append(verdict);
  if (detail.textContent) intel.append(detail);
  intel.append(why);

  const next = $("nextBtn");
  const finalQ = g.isLast || g.hearts === 0 && g.cfg.hearts > 0;
  next.textContent = finalQ ? "SEE RESULTS →" : "NEXT →";
  next.className = "show";
  // Portrait stacks everything vertically, so bring Next into view; landscape keeps it beside the answers.
  if (!reducedMotion() && matchMedia("(orientation: portrait)").matches) next.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function goNext(): void {
  const g = game;
  if (!g || !g.isResolved) return;
  sfx("click");
  g.next();
  if (g.over) endGame();
  else renderQuestion();
}

/* ---------- results ---------- */
function rankFor(acc: number): [string, string, string] {
  if (acc >= 90) return ["🏆", "VICTOR!", "Mockingjay"];
  if (acc >= 70) return ["🥇", "WELL FOUGHT", "Victor"];
  if (acc >= 50) return ["🏹", "TRIBUTE", "Survivor"];
  return ["🔥", "KEEP TRAINING", "Tribute-in-training"];
}

function endGame(): void {
  const g = game!;
  stopTimer();
  const reason: EndReason = g.reason ?? "done";
  const acc = g.answered ? Math.round((g.correctCount / g.answered) * 100) : 0;

  const stats = loadStats();
  const prev = stats.best[g.mode] ?? 0;
  const newBest = g.mode !== "daily" && g.score > prev && g.answered > 0;
  if (newBest) stats.best[g.mode] = g.score;
  stats.bestStreak = Math.max(stats.bestStreak, g.bestStreak);
  stats.gamesPlayed += 1;
  const emoji = g.history.map((ok) => (ok ? "🟧" : "⬛")).join("");
  if (g.mode === "daily") {
    stats.dailyDone = localDateKey();
    stats.dailyResult = emoji;
  }
  saveStats(stats);

  let [trophy, title, rank] = rankFor(acc);
  if (reason === "dead") [trophy, title, rank] = ["💔", "GAME OVER", "The odds were not in your favor"];
  if (reason === "cleared") [trophy, title, rank] = ["👑", "UNDEFEATED", "You outlasted the arena"];

  $("resTrophy").textContent = trophy;
  replay($("resTrophy"), "bounce");
  $("resTitle").textContent = title;
  $("resRank").textContent = rank;
  $("resNewBest").innerHTML = newBest ? '<span class="newbest">★ NEW BEST ★</span>' : "";
  $("resEmoji").textContent = emoji;
  showScreen("screen-results");

  ["resScore", "resAcc", "resCorrect", "resStreak"].forEach((id) => ($(id).dataset.v = "0"));
  countUp($("resScore"), g.score, 1100);
  countUp($("resAcc"), acc, 900, (n) => `${n}%`);
  $("resCorrect").textContent = `${g.correctCount}/${g.answered}`;
  countUp($("resStreak"), g.bestStreak, 700);

  if (reason === "cleared" || newBest || acc >= 80) {
    confetti();
    sfx("fanfare");
  } else sfx(reason === "dead" ? "gameover" : "correct");

  lastShare = `Arena Trivia${g.mode === "daily" ? ` ${localDateKey()}` : ""} · ${g.cfg.name}\n${emoji}\n${g.score.toLocaleString()} pts · ${g.correctCount}/${g.answered} correct\n${location.origin}${location.pathname}`;
}

/* ---------- transfer ---------- */
function showTransfer(): void {
  $<HTMLTextAreaElement>("transferText").value = exportStats();
  $("transferMsg").textContent = "Copy this text to move your progress to another device, or paste saved text and tap Import.";
  showScreen("screen-transfer");
}

/* ---------- init ---------- */
export function initApp(): void {
  initFx();
  muted = loadStats().muted;
  setMuted(muted);
  const muteBtn = $("muteBtn");
  const paintMute = () => (muteBtn.textContent = muted ? "🔇" : "🔊");
  paintMute();
  muteBtn.addEventListener("click", () => {
    muted = !muted;
    setMuted(muted);
    const s = loadStats();
    s.muted = muted;
    saveStats(s);
    paintMute();
    replay(muteBtn, "pop");
    sfx("click");
  });

  renderModes();
  renderChips();

  $("lifeFifty").addEventListener("click", () => {
    if (!game) return;
    const gone = game.useFifty();
    if (!gone.length) return;
    const buttons = Array.from($("opts").children) as HTMLButtonElement[];
    gone.forEach((i) => {
      buttons[i].disabled = true;
      buttons[i].classList.add("eliminated");
    });
    sfx("life");
    replay($("lifeFifty"), "pop");
    updateHud();
  });
  $("lifeSkip").addEventListener("click", () => {
    if (!game || !game.useSkip()) return;
    stopTimer();
    sfx("click");
    if (game.over) endGame();
    else renderQuestion();
  });
  $("lifeSecond").addEventListener("click", () => {
    if (!game || !game.useSecondChance()) return;
    sfx("life");
    replay($("lifeSecond"), "pop");
    updateHud();
  });
  $("nextBtn").addEventListener("click", goNext);

  document.addEventListener("keydown", (e) => {
    if (!$("screen-game").classList.contains("active") || !game) return;
    if (game.isResolved) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        goNext();
      }
      return;
    }
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 4) submit(n - 1);
  });

  $("againBtn").addEventListener("click", () => startGame(lastMode));
  $("menuBtn").addEventListener("click", () => {
    sfx("click");
    renderModes();
    showScreen("screen-start");
  });
  $("shareBtn").addEventListener("click", async () => {
    sfx("click");
    try {
      if (navigator.share) await navigator.share({ text: lastShare });
      else {
        await navigator.clipboard.writeText(lastShare);
        $("shareBtn").textContent = "COPIED!";
        setTimeout(() => ($("shareBtn").textContent = "SHARE SCORE"), 1600);
      }
    } catch {
      // cancelled or blocked
    }
  });

  $("transferBtn").addEventListener("click", showTransfer);
  $("transferBack").addEventListener("click", () => {
    renderModes();
    showScreen("screen-start");
  });
  $("importBtn").addEventListener("click", () => {
    if (importStats($<HTMLTextAreaElement>("transferText").value)) {
      muted = loadStats().muted;
      setMuted(muted);
      paintMute();
      renderModes();
      showScreen("screen-start");
    } else $("transferMsg").textContent = "That text isn't valid progress data.";
  });
}
