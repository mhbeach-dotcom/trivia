import { replay } from "./fx";

/** Show one `.screen` section and hide the rest. */
export function showScreen(id: string): void {
  document.querySelectorAll<HTMLElement>(".screen").forEach((s) => s.classList.remove("active"));
  const el = document.getElementById(id) as HTMLElement;
  el.classList.add("active");
  replay(el, "enter");
  window.scrollTo(0, 0);
}
