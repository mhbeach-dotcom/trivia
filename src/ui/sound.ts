// Tiny WebAudio synth: no audio files to load or cache.
type Name = "click" | "correct" | "wrong" | "tick" | "heart" | "life" | "fanfare" | "gameover";

let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(m: boolean): void {
  muted = m;
}

function ac(): AudioContext | null {
  if (!ctx) {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, delay: number, dur: number, type: OscillatorType, vol: number): void {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = c.currentTime + delay;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export function sfx(name: Name): void {
  if (muted) return;
  switch (name) {
    case "click": return tone(440, 0, 0.08, "triangle", 0.08);
    case "correct": return [523, 659, 784].forEach((f, i) => tone(f, i * 0.09, i === 2 ? 0.2 : 0.12, "sine", 0.14));
    case "wrong": return [220, 155].forEach((f, i) => tone(f, i * 0.12, 0.2, "sawtooth", 0.1));
    case "tick": return tone(880, 0, 0.05, "square", 0.05);
    case "heart": return tone(330, 0, 0.15, "sine", 0.12);
    case "life": return tone(392, 0, 0.1, "triangle", 0.1);
    case "fanfare": return [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.13, 0.22, "triangle", 0.14));
    case "gameover": return [392, 330, 262, 196].forEach((f, i) => tone(f, i * 0.16, 0.25, "sine", 0.12));
  }
}
