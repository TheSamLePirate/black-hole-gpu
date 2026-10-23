import { expect, test } from "bun:test";
import { l16Key, l16Shares, readL16 } from "../src/net/link16";

// The Link 16 between the room's F-35s (PLAN-RADAR-AAA RD12): one key a thing across the pages, the rules of sharing.

test("the keys: a player one key whatever the page calls him; ours left out; an aggressor only in a match", () => {
  // (Ben, slot 1, seen by Ana — slot 0 —: net:1 out of a fight, cmb:10001 in the free fight's world)
  expect(l16Key("net:1", 0)).toBe("p:1");
  expect(l16Key("cmb:10001", 0)).toBe("p:1");
  expect(l16Key("net:0", 0)).toBeNull();
  expect(l16Key("cmb:10000", 0)).toBeNull();
  // (our AI wingman k on the others' pages is rwg:<us>:k)
  expect(l16Key("wng:2", 0)).toBe("rwg:0:2");
  expect(l16Key("rwg:1:0", 0)).toBe("rwg:1:0");
  expect(l16Key("trf:4ca7b2", 0)).toBe("trf:4ca7b2");
  expect(l16Key("cmb:3", 0, true)).toBe("a:3");
  expect(l16Key("cmb:3", 0, false)).toBeNull();
  expect(l16Key("msl:7", 0)).toBeNull();
  expect(l16Key("cm:2", 0)).toBeNull();
});

test("the rules: the whole room out of a match; a team in a team fight; nobody in a free-for-all", () => {
  expect(l16Shares(null, false)).toBe(true);
  expect(l16Shares("race", false)).toBe(true);
  expect(l16Shares("coop", true)).toBe(true);
  expect(l16Shares("teams", true)).toBe(true);
  expect(l16Shares("teams", false)).toBe(false);
  expect(l16Shares("free", true)).toBe(false);
  expect(l16Shares("ffa", true)).toBe(false);
});

test("the event read back: bounded, malformed rows left out", () => {
  expect(
    readL16({
      tr: [
        ["p:1", 3],
        ["x".repeat(99), 1],
        [3, 1],
        ["trf:a", 9],
      ],
    }),
  ).toEqual([
    { key: "p:1", iff: "hostile" },
    { key: "trf:a", iff: "unknown" },
  ]);
  expect(readL16(null)).toEqual([]);
});
