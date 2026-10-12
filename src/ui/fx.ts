// Visual effects: confetti, particle bursts, floating score text, embers, count-up numbers.
// Everything here is skipped when the user prefers reduced motion.

export const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function buzz(pattern: number | number[]): void {
  if (!reducedMotion()) navigator.vibrate?.(pattern);
}

/* ---------- confetti ---------- */
interface Piece { x: number; y: number; w: number; h: number; c: string; vy: number; vx: number; r: number; vr: number }

let canvas: HTMLCanvasElement;
let cx: CanvasRenderingContext2D | null;
let pieces: Piece[] = [];
let running = false;

function resize(): void {
  canvas.width = innerWidth;
  canvas.height = innerHeight;
}

export function initFx(): void {
  canvas = document.getElementById("confetti") as HTMLCanvasElement;
  cx = canvas.getContext("2d");
  resize();
  addEventListener("resize", resize);
  spawnEmbers();
}

export function confetti(): void {
  if (reducedMotion() || !cx) return;
  const colors = ["#e8b33d", "#ff5a2a", "#f5ead6", "#3ddc84", "#ff5d5d"];
  for (let i = 0; i < 140; i++) {
    pieces.push({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height * 0.3,
      w: 5 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      c: colors[i % colors.length],
      vy: 2 + Math.random() * 3.5,
      vx: -1.5 + Math.random() * 3,
      r: Math.random() * Math.PI,
      vr: -0.1 + Math.random() * 0.2,
    });
  }
  if (!running) {
    running = true;
    requestAnimationFrame(tick);
  }
}

function tick(): void {
  if (!cx) return;
  cx.clearRect(0, 0, canvas.width, canvas.height);
  for (const p of pieces) {
    p.x += p.vx;
    p.y += p.vy;
    p.r += p.vr;
    cx.save();
    cx.translate(p.x, p.y);
    cx.rotate(p.r);
    cx.fillStyle = p.c;
    cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    cx.restore();
  }
  pieces = pieces.filter((p) => p.y < canvas.height + 30);
  if (pieces.length) requestAnimationFrame(tick);
  else {
    running = false;
    cx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

/* ---------- bursts and floating text (Web Animations API) ---------- */
export function burst(x: number, y: number, color: string, count = 14): void {
  if (reducedMotion()) return;
  for (let i = 0; i < count; i++) {
    const d = document.createElement("i");
    d.className = "spark";
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
    d.style.background = color;
    document.body.append(d);
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const dist = 40 + Math.random() * 60;
    d.animate(
      [
        { transform: "translate(-50%,-50%) scale(1)", opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist}px)) scale(0)`, opacity: 0 },
      ],
      { duration: 550 + Math.random() * 250, easing: "cubic-bezier(.2,.8,.3,1)" },
    ).onfinish = () => d.remove();
  }
}

export function floatText(text: string, x: number, y: number, cls: string): void {
  if (reducedMotion()) return;
  const el = document.createElement("div");
  el.className = `float-text ${cls}`;
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  document.body.append(el);
  el.animate(
    [
      { transform: "translate(-50%,0) scale(.6)", opacity: 0 },
      { transform: "translate(-50%,-18px) scale(1.15)", opacity: 1, offset: 0.25 },
      { transform: "translate(-50%,-70px) scale(1)", opacity: 0 },
    ],
    { duration: 1100, easing: "ease-out" },
  ).onfinish = () => el.remove();
}

/** Full-screen vignette flash: "good" (gold) or "bad" (red). */
export function flash(kind: "good" | "bad"): void {
  if (reducedMotion()) return;
  const el = document.getElementById("flash");
  if (!el) return;
  el.className = "";
  void el.offsetWidth;
  el.className = `on ${kind}`;
}

/** Re-trigger a CSS animation class on an element. */
export function replay(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

export function countUp(el: HTMLElement, to: number, ms = 800, format: (n: number) => string = (n) => n.toLocaleString()): void {
  if (reducedMotion() || ms <= 0) {
    el.textContent = format(to);
    return;
  }
  const from = Number(el.dataset.v ?? 0);
  el.dataset.v = String(to);
  const t0 = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / ms);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = format(Math.round(from + (to - from) * eased));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- drifting embers in the background ---------- */
function spawnEmbers(): void {
  const box = document.getElementById("embers");
  if (!box || reducedMotion()) return;
  for (let i = 0; i < 16; i++) {
    const e = document.createElement("i");
    e.style.left = `${Math.random() * 100}%`;
    e.style.setProperty("--s", String(0.4 + Math.random() * 0.9));
    e.style.setProperty("--dx", `${-40 + Math.random() * 80}px`);
    e.style.animationDuration = `${9 + Math.random() * 10}s`;
    e.style.animationDelay = `${-Math.random() * 14}s`;
    box.append(e);
  }
}
