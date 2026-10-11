export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) el.setAttribute(k, v);
  for (const c of children) el.append(c);
  return el;
}

export function buzz(ms: number): void {
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) navigator.vibrate?.(ms);
}
