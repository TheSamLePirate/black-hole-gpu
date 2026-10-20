// The menus' button prompts (PLAN-TITRE-AAA): they follow the last device used — the keyboard's keys (by their
// place: A / E on AZERTY where QWERTY has Q / E), the controller's buttons (Xbox's A B X Y LB RB, PlayStation's
// ✕ ○ □ △ L1 R1), nothing for a touch or a mouse (the items are tapped). <html data-input="…"> tells the CSS.

import { tr } from "../../i18n";
import type { MenuAction } from "./actions";

export type InputKind = "keyboard" | "mouse" | "touch" | "pad";
export type PadStyle = "xbox" | "playstation";

let kind: InputKind = "mouse";
let padStyle: PadStyle = "xbox";
const listeners = new Set<(k: InputKind) => void>();
/** the keyboard's layout (the key printed at each place), when the browser tells it */
let layout: Map<string, string> | null = null;

/** The device used last. */
export const inputKind = () => kind;
export const currentPadStyle = () => padStyle;

/** A device used: the prompts change if it is another. `padId`: the controller's name (its make). */
export function noteInput(k: InputKind, padId?: string) {
  if (padId) padStyle = padStyleOf(padId);
  if (k === kind) return;
  kind = k;
  if (typeof document !== "undefined") document.documentElement.dataset.input = k;
  for (const f of listeners) f(k);
}

/** Calls `f` when the device changes; returns its removal. */
export function onInputChange(f: (k: InputKind) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Sony's pads by their name or vendor id (054c), the others as Xbox's. */
export function padStyleOf(id: string): PadStyle {
  return /054c|dualsense|dualshock|playstation/i.test(id) ? "playstation" : "xbox";
}

/** Watches the page's real input (not the pad's synthetic keys: those are noted by ui/padnav.ts). Once. */
let watching = false;
export function watchInput() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  document.documentElement.dataset.input = kind;
  addEventListener("keydown", (e) => e.isTrusted && noteInput("keyboard"), true);
  addEventListener(
    "pointerdown",
    (e: PointerEvent) => noteInput(e.pointerType === "touch" || e.pointerType === "pen" ? "touch" : "mouse"),
    true,
  );
  const kb = (navigator as unknown as { keyboard?: { getLayoutMap?(): Promise<Map<string, string>> } }).keyboard;
  void kb
    ?.getLayoutMap?.()
    .then((m) => (layout = new Map(m)))
    .catch(() => {});
}

/** The key printed at a place on this keyboard (event.code), in capitals: KeyQ → "A" on AZERTY. */
export function keyLabel(code: string): string {
  const k = layout?.get(code);
  if (k) return k.toUpperCase();
  return code.startsWith("Key") ? code.slice(3) : code.startsWith("Digit") ? code.slice(5) : code;
}

const PAD: Record<PadStyle, Partial<Record<MenuAction, string>>> = {
  xbox: { confirm: "A", back: "B", alt: "X", reset: "Y", tabPrev: "LB", tabNext: "RB" },
  playstation: { confirm: "✕", back: "○", alt: "□", reset: "△", tabPrev: "L1", tabNext: "R1" },
};

/**
 * The prompt for an action on a device: the key or the button to show (null: none — a touch, a mouse, or an
 * action the device does by pointing).
 */
export function glyph(action: MenuAction, on: InputKind = kind, style: PadStyle = padStyle): string | null {
  if (on === "touch" || on === "mouse") return null;
  if (on === "pad") {
    if (action === "up" || action === "down" || action === "left" || action === "right") return "✥";
    return PAD[style][action] ?? null;
  }
  switch (action) {
    case "confirm":
      return tr({ fr: "Entrée", en: "Enter" });
    case "back":
      return tr({ fr: "Échap", en: "Esc" });
    case "tabPrev":
      return keyLabel("KeyQ");
    case "tabNext":
      return keyLabel("KeyE");
    case "alt":
      return keyLabel("KeyX");
    case "reset":
      return keyLabel("KeyR");
    default:
      return { up: "↑", down: "↓", left: "←", right: "→" }[action];
  }
}
