import { BOOKS, type BookId, type Mode } from "../types";
import { DAILY_COUNT, Game, localDateKey } from "../game/engine";
import { ALL_QUESTIONS } from "../game/data";
import { QUESTION_SECONDS } from "../game/scoring";
import { loadStats, saveStats, exportStats, importStats } from "../storage";
import { buzz, h } from "./dom";

const root = () => document.getElementById("app")!;
const selectedBooks = new Set<BookId>(Object.keys(BOOKS) as BookId[]);

function mount(...nodes: Node[]): void {
  root().replaceChildren(...nodes);
  window.scrollTo(0, 0);
}

export function showHome(): void {
  const stats = loadStats();
  const today = localDateKey();
  const dailyDone = stats.dailyDone === today;

  const modeBtn = (mode: Mode, title: string, sub: string, disabled = false) => {
    const b = h("button", { class: "mode", type: "button" }, h("strong", {}, title), h("span", {}, sub));
    b.disabled = disabled;
    b.addEventListener("click", () => startGame(mode));
    return b;
  };

  const bookChips = (Object.keys(BOOKS) as BookId[]).map((id) => {
    const chip = h("button", { class: "chip", type: "button", "aria-pressed": String(selectedBooks.has(id)) }, BOOKS[id]);
    chip.addEventListener("click", () => {
      if (selectedBooks.has(id)) {
        if (selectedBooks.size > 1) selectedBooks.delete(id);
      } else selectedBooks.add(id);
      showHome();
    });
    return chip;
  });

  const save = h("button", { class: "link", type: "button" }, "Export / import progress");
  save.addEventListener("click", showTransfer);

  mount(
    h("header", { class: "hero" }, h("h1", {}, "Hunger Games Trivia"), h("p", {}, "All five books. Spoilers included.")),
    h("section", { class: "modes" },
      modeBtn("quick", "Quick Play", "10 questions"),
      modeBtn("survival", "Survival", "One wrong answer ends the run"),
      modeBtn("daily", "Daily Reaping", dailyDone ? `Done today ${stats.dailyResult ?? ""}` : `${DAILY_COUNT} questions, same for everyone`, dailyDone),
    ),
    h("section", {}, h("h2", {}, "Books (Quick Play and Survival)"), h("div", { class: "chips" }, ...bookChips)),
    h("section", { class: "stats" },
      h("span", {}, `Best Quick: ${stats.best.quick ?? 0}`),
      h("span", {}, `Best Survival: ${stats.best.survival ?? 0}`),
      h("span", {}, `Best streak: ${stats.bestStreak}`),
    ),
    save,
  );
}

function startGame(mode: Mode): void {
  const game = new Game({ mode, pool: ALL_QUESTIONS, books: [...selectedBooks] });
  if (game.over) return showHome();
  showQuestion(game);
}

function showQuestion(game: Game): void {
  const q = game.current;
  if (!q) return showResults(game);

  let secondsLeft = QUESTION_SECONDS;
  let answered = false;

  const timerText = h("span", { class: "time" }, String(secondsLeft));
  const bar = h("div", { class: "bar" }, h("i", {}));
  const fill = bar.firstElementChild as HTMLElement;
  const feedback = h("div", { class: "feedback", "aria-live": "polite" });
  const nextBtn = h("button", { class: "primary", type: "button", hidden: "" }, "Next");
  const buttons: HTMLButtonElement[] = [];

  const finish = (choice: number | null) => {
    if (answered) return;
    answered = true;
    clearInterval(tick);
    const res = game.answer(choice, secondsLeft);
    buzz(res.correct ? 30 : [60, 40, 60] as unknown as number);
    buttons.forEach((b, i) => {
      b.disabled = true;
      if (i === res.correctIndex) b.classList.add("right");
      else if (i === choice) b.classList.add("wrong");
    });
    const verdict = choice === null ? "Time's up." : res.correct ? `Correct! +${res.points}` : "Not quite.";
    feedback.replaceChildren(h("strong", {}, verdict), h("p", {}, q.explanation));
    nextBtn.hidden = false;
    nextBtn.textContent = game.over || game.index + 1 >= game.questions.length ? "See results" : "Next";
    nextBtn.focus();
  };

  q.options.forEach((opt, i) => {
    const b = h("button", { class: "option", type: "button" }, opt);
    b.addEventListener("click", () => finish(i));
    buttons.push(b);
  });

  nextBtn.addEventListener("click", () => {
    game.next();
    game.over ? showResults(game) : showQuestion(game);
  });

  const tick = setInterval(() => {
    secondsLeft -= 1;
    timerText.textContent = String(Math.max(0, secondsLeft));
    fill.style.width = `${(Math.max(0, secondsLeft) / QUESTION_SECONDS) * 100}%`;
    if (secondsLeft <= 0) finish(null);
  }, 1000);

  const progress = game.mode === "survival" ? `Question ${game.index + 1}` : `${game.index + 1} / ${game.questions.length}`;
  mount(
    h("div", { class: "topbar" }, h("span", {}, progress), h("span", {}, `Score ${game.score}`), h("span", {}, `Streak ${game.streak}`), timerText),
    bar,
    h("p", { class: "meta" }, `${BOOKS[q.book]} · ${q.category} · ${q.difficulty}`),
    h("h2", { class: "question" }, q.question),
    h("div", { class: "options" }, ...buttons),
    feedback,
    nextBtn,
  );
  fill.style.width = "100%";
}

function showResults(game: Game): void {
  const stats = loadStats();
  const prevBest = stats.best[game.mode] ?? 0;
  const record = game.score > prevBest;
  if (record) stats.best[game.mode] = game.score;
  stats.bestStreak = Math.max(stats.bestStreak, game.bestStreak);
  stats.gamesPlayed += 1;
  const emoji = game.history.map((ok) => (ok ? "🟧" : "⬛")).join("");
  if (game.mode === "daily") {
    stats.dailyDone = localDateKey();
    stats.dailyResult = emoji;
  }
  saveStats(stats);

  const shareText = `Hunger Games Trivia${game.mode === "daily" ? ` ${localDateKey()}` : ""}\n${emoji}\n${game.correctCount}/${game.history.length} · ${game.score} pts`;
  const share = h("button", { class: "primary", type: "button" }, "Share result");
  share.addEventListener("click", async () => {
    try {
      if (navigator.share) await navigator.share({ text: shareText });
      else {
        await navigator.clipboard.writeText(shareText);
        share.textContent = "Copied!";
      }
    } catch {
      // user cancelled
    }
  });
  const again = h("button", { class: "mode", type: "button" }, "Home");
  again.addEventListener("click", showHome);

  mount(
    h("header", { class: "hero" }, h("h1", {}, game.mode === "survival" ? "You fell" : "Game over"), h("p", {}, record ? "New best score!" : " ")),
    h("p", { class: "big" }, String(game.score)),
    h("p", { class: "meta" }, `${game.correctCount} of ${game.history.length} correct · best streak ${game.bestStreak}`),
    h("p", { class: "emoji" }, emoji),
    share,
    again,
  );
}

function showTransfer(): void {
  const area = h("textarea", { rows: "6", "aria-label": "Progress data" });
  area.value = exportStats();
  const msg = h("p", { class: "meta" }, "Copy this text to move your progress, or paste saved text and tap Import.");
  const imp = h("button", { class: "primary", type: "button" }, "Import");
  imp.addEventListener("click", () => {
    if (importStats(area.value)) showHome();
    else msg.textContent = "That text isn't valid progress data.";
  });
  const back = h("button", { class: "mode", type: "button" }, "Back");
  back.addEventListener("click", showHome);
  mount(h("h2", {}, "Progress"), msg, area, imp, back);
}
