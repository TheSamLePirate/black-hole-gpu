import { afterEach, beforeEach, expect, test } from "bun:test";
import { defaultSettings, pickSettings } from "../src/settings";
import { autosave, slots, type GameSave } from "../src/game/save";

// Saved games in the browser's storage (audit 2026-11-10, AR-19 and AR-20; wave 3.3): one key per save, so a
// save unreadable — an interrupted write, a later version's — loses nothing but itself and is kept aside, never
// overwritten in silence; a name already taken is not replaced unless asked; the former single key (every
// save in one JSON) read and moved, nothing lost.

/** A browser's localStorage, in memory (an optional quota in characters, as a browser's ≈ 5 M). */
class FakeStorage {
  m = new Map<string, string>();
  constructor(readonly quota = Number.POSITIVE_INFINITY) {}
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    let used = 0;
    for (const [kk, vv] of this.m) if (kk !== k) used += kk.length + vv.length;
    if (used + k.length + v.length > this.quota) throw new DOMException("quota", "QuotaExceededError");
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

let ls: FakeStorage;
const G = globalThis as unknown as { localStorage?: unknown };
beforeEach(() => {
  ls = new FakeStorage();
  G.localStorage = ls;
});
afterEach(() => {
  delete G.localStorage;
});

const save = (name: string, summary = "Earth · IN ORBIT 400 km"): GameSave => ({
  v: 2,
  name,
  savedAt: 1,
  summary,
  scene: "game:artemis",
  settings: pickSettings(defaultSettings(), "carried", "scene"),
  time: 109.7,
  ship: {
    piloting: true,
    sas: true,
    hold: "prograde",
    auto: "none",
    throttle: 0.5,
    precision: false,
    speedMode: "orbit",
    landed: null,
    spent: 12,
    properTime: 3,
  },
  plan: null,
});

/** every stored value, wherever it is kept */
const values = () => [...ls.m.values()];

test("one key per save: two saves, two keys — neither rewritten by the other", () => {
  expect(slots.put(save("A"))).toBe("ok");
  const a = ls.getItem("kerr.save:A");
  expect(a).not.toBeNull();
  expect(slots.put(save("B"))).toBe("ok");
  expect(ls.getItem("kerr.save:B")).not.toBeNull();
  expect(ls.getItem("kerr.save:A")).toBe(a);
  expect(
    slots
      .list()
      .map((g) => g.name)
      .sort(),
  ).toEqual(["A", "B"]);
});

test("the former single key: its saves read and moved one per key, nothing lost", () => {
  ls.setItem("kerr.saves", JSON.stringify({ A: save("A"), B: save("B") }));
  expect(
    slots
      .list()
      .map((g) => g.name)
      .sort(),
  ).toEqual(["A", "B"]);
  expect(slots.get("A")?.name).toBe("A");
  expect(slots.put(save("C"))).toBe("ok");
  expect(
    slots
      .list()
      .map((g) => g.name)
      .sort(),
  ).toEqual(["A", "B", "C"]);
  expect(ls.getItem("kerr.save:A")).not.toBeNull();
  expect(ls.getItem("kerr.saves")).toBeNull();
});

test("the former single key unreadable (an interrupted write): kept aside, not erased by the next save", () => {
  const raw = `{"A":${JSON.stringify(save("A")).slice(0, 120)}`;
  ls.setItem("kerr.saves", raw);
  expect(slots.put(save("B"))).toBe("ok");
  // (before: allSlots() read {} and the put wrote back B alone — every other save gone, nothing said)
  expect(values()).toContain(raw);
  expect(slots.get("B")?.name).toBe("B");
});

test("an unreadable save loses nothing but itself; saved again under its name, the old text is kept aside", () => {
  ls.setItem("kerr.save:A", "{broken");
  expect(slots.put(save("B"))).toBe("ok");
  expect(slots.list().map((g) => g.name)).toEqual(["B"]);
  expect(slots.unreadable()).toEqual(["A"]);
  expect(slots.put(save("A"))).toBe("ok");
  expect(values()).toContain("{broken");
  expect(slots.get("A")?.name).toBe("A");
});

test("a name already taken is not replaced unless asked", () => {
  expect(slots.put(save("A", "first"))).toBe("ok");
  expect(slots.put(save("A", "second"))).toBe("exists");
  expect(slots.get("A")?.summary).toBe("first");
  expect(slots.put(save("A", "second"), { replace: true })).toBe("ok");
  expect(slots.get("A")?.summary).toBe("second");
  expect(slots.has("A")).toBe(true);
  expect(slots.free("A")).toBe("A (2)");
  expect(slots.free("B")).toBe("B");
});

test("an autosave this version cannot read (a later version's) is kept aside, not overwritten", () => {
  const later = JSON.stringify({ ...save("autosave"), v: 99 });
  ls.setItem("kerr.autosave", later);
  expect(autosave.get()).toBeNull();
  expect(autosave.set(save("autosave"))).toBe(true);
  expect(values()).toContain(later);
  expect(autosave.get()?.name).toBe("autosave");
});

test("storage full: the save refused says so, the others untouched", () => {
  ls = new FakeStorage(60_000);
  G.localStorage = ls;
  expect(slots.put(save("A"))).toBe("ok");
  const a = ls.getItem("kerr.save:A");
  const big = save("B", "x".repeat(80_000));
  expect(slots.put(big)).toBe("refused");
  expect(ls.getItem("kerr.save:A")).toBe(a);
  expect(slots.list().map((g) => g.name)).toEqual(["A"]);
});

test("removing a save removes its key only", () => {
  slots.put(save("A"));
  slots.put(save("B"));
  slots.remove("A");
  expect(ls.getItem("kerr.save:A")).toBeNull();
  expect(slots.list().map((g) => g.name)).toEqual(["B"]);
});
