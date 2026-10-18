import { afterAll, beforeAll, expect, test } from "bun:test";
import type { PadState } from "../src/gamepad";
import { menuActionOf } from "../src/ui/menu/actions";
import { type Box, pickNext } from "../src/ui/menu/focus";
import { glyph, keyLabel, noteInput, padStyleOf } from "../src/ui/menu/glyphs";
import { ScreenStack } from "../src/ui/menu/router";
import { MenuPad } from "../src/ui/padnav";

// The menus' socle (PLAN-TITRE-AAA E0, src/ui/menu/): the focus in two dimensions, the keys' and the pad's
// meanings, the prompts, the stack of screens.

// the title's layout: the Continue banner, a row of four cards, two links under them
const banner: Box = { x: 100, y: 100, w: 500, h: 80 };
const cards: Box[] = [0, 1, 2, 3].map((i) => ({ x: 100 + i * 170, y: 220, w: 150, h: 260 }));
const links: Box[] = [
  { x: 100, y: 520, w: 80, h: 30 },
  { x: 290, y: 520, w: 100, h: 30 },
];
const all = [banner, ...cards, ...links];

test("along the row of cards, left and right; none beyond its ends", () => {
  expect(pickNext(cards[1]!, all, "right")).toBe(3);
  expect(pickNext(cards[1]!, all, "left")).toBe(1);
  expect(pickNext(cards[3]!, all, "right")).toBe(-1);
});

test("down from the banner: the card under its centre; up from any card: the banner", () => {
  expect(pickNext(banner, all, "down")).toBe(2);
  for (let i = 0; i < 4; i++) expect(pickNext(cards[i]!, all, "up")).toBe(0);
});

test("down from a card: the link nearest under it, not the first of the line", () => {
  expect(pickNext(cards[0]!, all, "down")).toBe(5);
  expect(pickNext(cards[1]!, all, "down")).toBe(6);
  expect(pickNext(links[1]!, all, "up")).toBe(2);
});

test("a list: down and up its items, nothing across", () => {
  const list = [0, 1, 2].map((i) => ({ x: 0, y: i * 50, w: 300, h: 44 }));
  expect(pickNext(list[0]!, list, "down")).toBe(1);
  expect(pickNext(list[2]!, list, "up")).toBe(1);
  expect(pickNext(list[1]!, list, "left")).toBe(-1);
});

test("the keys' meanings: arrows, Enter, Escape, the tabs by their place (A / E on AZERTY), no chord", () => {
  expect(menuActionOf({ key: "ArrowLeft", code: "ArrowLeft" })).toBe("left");
  expect(menuActionOf({ key: "Enter", code: "NumpadEnter" })).toBe("confirm");
  expect(menuActionOf({ key: "Escape", code: "Escape" })).toBe("back");
  // (AZERTY: the key printed A sits where QWERTY's Q is)
  expect(menuActionOf({ key: "a", code: "KeyQ" })).toBe("tabPrev");
  expect(menuActionOf({ key: "e", code: "KeyE" })).toBe("tabNext");
  expect(menuActionOf({ key: "PageDown", code: "PageDown" })).toBe("tabNext");
  expect(menuActionOf({ key: "r", code: "KeyR", metaKey: true })).toBeNull();
  expect(menuActionOf({ key: "z", code: "KeyW" })).toBeNull();
});

test("the prompts follow the device: keys, Xbox or PlayStation buttons, none for a touch", () => {
  expect(glyph("confirm", "pad", "xbox")).toBe("A");
  expect(glyph("back", "pad", "playstation")).toBe("○");
  expect(glyph("tabNext", "pad", "playstation")).toBe("R1");
  expect(glyph("confirm", "touch")).toBeNull();
  expect(glyph("tabPrev", "keyboard")).toBe("Q");
  expect(keyLabel("KeyE")).toBe("E");
  expect(padStyleOf("DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)")).toBe("playstation");
  expect(padStyleOf("Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)")).toBe("xbox");
});

test("the stack: on top, back down to a screen, the focus each one left with", () => {
  const s = new ScreenStack<{ id: string }>();
  s.push({ id: "title" });
  s.push({ id: "mode:ship" });
  s.push({ id: "launch:lander" });
  expect(s.top?.id).toBe("launch:lander");
  expect(s.popTo("nowhere")).toBe(false);
  expect(s.depth).toBe(3);
  expect(s.popTo("title")).toBe(true);
  expect(s.ids()).toEqual(["title"]);
  s.remember("title", "card-ship");
  expect(s.recall("title")).toBe("card-ship");
  s.pop();
  expect(s.top).toBeUndefined();
});

// --- the pad in the menus: the keys it sends to the focused item

const sent: { key: string; code: string; to: string }[] = [];
const saved: Record<string, unknown> = {};
beforeAll(() => {
  for (const k of ["document", "window", "KeyboardEvent"]) saved[k] = (globalThis as Record<string, unknown>)[k];
  const target = (to: string) => ({ dispatchEvent: (e: { key: string; code: string }) => sent.push({ key: e.key, code: e.code, to }) });
  Object.assign(globalThis, {
    document: { activeElement: target("item"), body: target("body"), documentElement: { dataset: {} } },
    window: target("window"),
    KeyboardEvent: class {
      key: string;
      code: string;
      constructor(_: string, o: { key: string; code: string }) {
        this.key = o.key;
        this.code = o.code;
      }
    },
  });
});
afterAll(() => Object.assign(globalThis, saved));

const pad = (o: Partial<PadState> = {}): PadState => ({
  move: [0, 0, 0, 0],
  look: [0, 0],
  zoom: 0,
  fast: false,
  actions: [],
  active: true,
  id: "Xbox Wireless Controller",
  held: [],
  ...o,
});

test("the pad: the older menus get up, down, A and B only; a menu screen every direction, LB / RB, X, Y", () => {
  const m = new MenuPad();
  sent.length = 0;
  m.tick(pad({ actions: ["dpadDown", "focus", "nextTarget", "auto"] }), 0);
  expect(sent.map((s) => s.code)).toEqual(["ArrowDown", "Enter"]);
  sent.length = 0;
  m.tick(pad({ actions: ["nextTarget", "auto", "rotation", "gravity"] }), 100, true);
  expect(sent.map((s) => `${s.code}>${s.to}`)).toEqual(["ArrowRight>item", "KeyX>item", "KeyR>item", "Escape>window"]);
});

test("the pad: LB / RB once per press; the stick moves once, then repeats while held, by its stronger axis", () => {
  const m = new MenuPad();
  sent.length = 0;
  const held = (lb: boolean, rb: boolean) => [false, false, false, false, lb, rb];
  m.tick(pad({ held: held(true, false) }), 0, true);
  m.tick(pad({ held: held(true, false) }), 16, true);
  m.tick(pad({ held: held(false, true) }), 32, true);
  expect(sent.map((s) => s.code)).toEqual(["PageUp", "PageDown"]);
  sent.length = 0;
  // (right, a little up: right wins)
  for (let t = 1000; t <= 1700; t += 16) m.tick(pad({ move: [0.3, 0.9, 0, 0] }), t, true);
  const rights = sent.filter((s) => s.code === "ArrowRight").length;
  expect(sent.every((s) => s.code === "ArrowRight")).toBe(true);
  expect(rights).toBeGreaterThanOrEqual(2);
  expect(rights).toBeLessThanOrEqual(3);
  noteInput("keyboard");
});
