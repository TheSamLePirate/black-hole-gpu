import { beforeEach, expect, test } from "bun:test";
import { adapterId, demoted, promoted, rememberedLevel, rememberLevel, tierAt } from "../src/tier";

// The hardware's tier: the measure moving it both ways (plan §3.4), and its memory between sessions.

// (Bun's test runner has no localStorage: a small in-memory stand-in — the store util only needs
// getItem/setItem/removeItem/clear)
const mem = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
} as unknown as Storage;

beforeEach(() => localStorage.clear());

test("demoted: one step down to the floor, null at the bottom", () => {
  const t2 = tierAt(2, "test");
  expect(demoted(t2)).toEqual({ level: 1, capMpx: 0.9, label: "test · measured ↓" });
  expect(demoted(tierAt(0, "test"))).toBeNull();
  expect(promoted(tierAt(4, "test"))).toBeNull();
  expect(promoted(tierAt(1, "test"))!.level).toBe(2);
});

test("tierAt: the pixel budget's table", () => {
  expect(tierAt(0, "x").capMpx).toBe(0.5);
  expect(tierAt(4, "x").capMpx).toBe(6);
});

test("the measured tier is remembered for the same adapter only", () => {
  const id = adapterId({ vendor: "apple", architecture: "metal-3", device: "" });
  expect(rememberedLevel(id)).toBeNull();
  rememberLevel(id, tierAt(3, "x"));
  expect(rememberedLevel(id)).toBe(3);
  // another adapter: no memory
  expect(rememberedLevel(adapterId({ vendor: "intel", architecture: "", device: "" }))).toBeNull();
  // a corrupt or out-of-range record: no memory
  rememberLevel(id, tierAt(3, "x"));
  localStorage.setItem("kerr.tier", JSON.stringify({ adapter: id, level: 99 }));
  expect(rememberedLevel(id)).toBe(4); // (clamped into the table)
  localStorage.setItem("kerr.tier", "not json");
  expect(rememberedLevel(id)).toBeNull();
});
