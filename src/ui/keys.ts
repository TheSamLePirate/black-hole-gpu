// The Escape key's stack: a surface that closes on Escape registers while it is open; one listener —
// in the capture phase, before every other key handler — closes the topmost and swallows the key. So
// closing a panel never also stops the autopilot, the mission or a cinematic: Escape reaches the game
// only when nothing is open. (A text field keeps its own Escape — clearing a search — first.)
import { isTyping } from "../controls";

const stack: (() => void)[] = [];

/** Registers a surface's close on the Escape stack; returns its unregistering (call it on close). */
export function onEscape(close: () => void): () => void {
  stack.push(close);
  return () => {
    const i = stack.lastIndexOf(close);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Is a surface open that Escape would close? */
export const escapeOpen = () => stack.length > 0;

addEventListener(
  "keydown",
  (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !stack.length || isTyping(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    stack.pop()!();
  },
  true,
);

// A slider, a checkbox or a colour clicked keeps the keyboard's focus: the arrows would then move it
// and the flight keys hesitate — handed back to the page once the pointer is released.
addEventListener("pointerup", (e: PointerEvent) => {
  const t = e.target as HTMLInputElement | null;
  if (t?.tagName === "INPUT" && /^(range|checkbox|radio|color)$/.test(t.type)) requestAnimationFrame(() => t.blur());
});

/** Closes the topmost surface on the Escape stack, as Escape would (TARS's interface tool): whether one was. */
export function closeTop(): boolean {
  const close = stack.pop();
  close?.();
  return !!close;
}
