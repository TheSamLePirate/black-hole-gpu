import { expect, test } from "bun:test";
import { exchangeLabel, rememberAsked, stepAsked } from "../src/ui/tars-panel-pure";

// TARS's console's decisions out of src/ui/tars-panel.ts (audit 2026-11-10, QA-10): what was asked kept and stepped through with ↑ ↓,
// a waking of his own named — the same code, now tested.

test("what was asked: not twice in a row, the last 60 kept", () => {
  const a: string[] = [];
  expect(rememberAsked(a, "où suis-je ?")).toBe(true);
  expect(rememberAsked(a, "où suis-je ?")).toBe(false);
  expect(rememberAsked(a, "quelle heure ?")).toBe(true);
  expect(rememberAsked(a, "où suis-je ?")).toBe(true);
  expect(a).toEqual(["où suis-je ?", "quelle heure ?", "où suis-je ?"]);
  for (let i = 0; i < 100; i++) rememberAsked(a, `q${i}`);
  expect(a.length).toBe(60);
  expect(a[0]).toBe("q40");
  expect(a.at(-1)).toBe("q99");
});

test("↑ ↓ through what was asked, as a shell's history: the draft back below it", () => {
  const a = ["one", "two", "three"];
  expect(stepAsked(a, -1, false, "dra")).toBeNull();
  const s1 = stepAsked(a, -1, true, "dra")!;
  expect(s1).toEqual({ at: 0, text: "three" });
  const s2 = stepAsked(a, s1.at, true, "dra")!;
  expect(s2).toEqual({ at: 1, text: "two" });
  // (the oldest: stays there)
  expect(stepAsked(a, 2, true, "dra")).toEqual({ at: 2, text: "one" });
  expect(stepAsked(a, s2.at, false, "dra")).toEqual({ at: 0, text: "three" });
  expect(stepAsked(a, 0, false, "dra")).toEqual({ at: -1, text: "dra" });
});

test("a waking of his own named by what woke him; the pilot's words as they were", () => {
  expect(exchangeLabel("[Woken by your schedule — the Moon rises over the horizon. No pilot asked: act alone]")).toBe(
    "⚡ the Moon rises over the horizon",
  );
  expect(exchangeLabel("Où est la Lune ?")).toBe("Où est la Lune ?");
});
