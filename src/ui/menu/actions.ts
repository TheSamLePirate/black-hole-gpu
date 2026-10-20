// What a key means in the menus (PLAN-TITRE-AAA): one language for the keyboard and the controller — the pad's
// buttons arrive as the keys they stand for (ui/padnav.ts): the D-pad as the arrows, A as Enter, B as Escape,
// LB / RB as Page ↑ / ↓, X as X, Y as R. The flight's keys are read by their place on the keyboard (event.code):
// Q / E (A / E on AZERTY) change the tab, like a console's shoulder buttons.

export type MenuAction = "up" | "down" | "left" | "right" | "confirm" | "back" | "tabPrev" | "tabNext" | "alt" | "reset";

export interface KeyLike {
  key: string;
  code?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

const BY_CODE: Record<string, MenuAction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Enter: "confirm",
  NumpadEnter: "confirm",
  Escape: "back",
  PageUp: "tabPrev",
  PageDown: "tabNext",
  KeyQ: "tabPrev",
  KeyE: "tabNext",
  KeyX: "alt",
  KeyR: "reset",
};

/** A key's meaning in a menu (null: none — left to the page). A chord (⌘, Ctrl, Alt) never is one. */
export function menuActionOf(e: KeyLike): MenuAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  return BY_CODE[e.code || e.key] ?? BY_CODE[e.key] ?? null;
}
