import { expect, test } from "bun:test";
import { BINDINGS, KEYMAP, type KeyBind, matchKey } from "../src/input/keymap";
import { FLIGHT_KEYS } from "../src/controller/util";

const press = (code: string, key: string, shiftKey = false) => ({ code, key, shiftKey });

test("no two bindings of a layer answer the same key and Shift state", () => {
  const seen = new Map<string, KeyBind>();
  for (const b of BINDINGS)
    for (const k of b.code ?? b.key!)
      for (const shift of b.shift === undefined ? [false, true] : [b.shift]) {
        const id = `${b.layer} ${b.code ? "code" : "key"} ${k} ${shift}`;
        expect(seen.get(id), id).toBeUndefined();
        seen.set(id, b);
      }
});

test("every help row says something, every binding has a row", () => {
  for (const s of KEYMAP)
    for (const r of s.rows) {
      expect(r.keys.length).toBeGreaterThan(0);
      expect(r.text.length).toBeGreaterThan(0);
    }
  expect(BINDINGS.length).toBeGreaterThan(60);
});

test("the scene's letters never take a free-flight key", () => {
  // (a free-flight key flies; the dispatcher skips the scene layer for it)
  for (const b of BINDINGS.filter((b) => b.layer === "scene" && b.code)) for (const c of b.code!) expect(c in FLIGHT_KEYS).toBe(false);
});

test("the layers: flying, the craft's keys come first; on foot, the scene's", () => {
  expect(matchKey(press("KeyT", "t"), true, false)?.do).toBe("sas");
  expect(matchKey(press("KeyT", "t"), false, false)?.do).toBe("journey");
  expect(matchKey(press("KeyT", "T", true), false, false)?.do).toBe("standOn");
  expect(matchKey(press("KeyG", "G", true), true, false)).toMatchObject({ do: "auto", arg: "entry" });
  // (G: the landing gear, as the simulators have it — PLAN-COCKPIT K4b; the landing autopilot on F7)
  expect(matchKey(press("KeyG", "g"), true, false)).toMatchObject({ do: "gear" });
  expect(matchKey(press("F7", "F7"), true, false)).toMatchObject({ do: "auto", arg: "land" });
  expect(matchKey(press("Digit3", "3"), true, false)).toMatchObject({ do: "hold", arg: "radialOut" });
  expect(matchKey(press("Digit3", "3"), false, false)).toMatchObject({ do: "quality", arg: "high" });
  // (Y flying: the telescope still — ⇧Y the path)
  expect(matchKey(press("KeyY", "y"), true, false)?.do).toBe("telescope");
  expect(matchKey(press("KeyY", "Y", true), true, false)?.do).toBe("pathInView");
  // N on the ground only
  expect(matchKey(press("KeyN", "n"), false, false)?.do).toBe("constellations");
  expect(matchKey(press("KeyN", "n"), true, false)?.do).toBe("held");
});

test("time in every mode; / is real time but ? the help", () => {
  for (const flying of [false, true]) {
    expect(matchKey(press("Space", " "), flying, false)?.do).toBe("playPause");
    expect(matchKey(press("Slash", "/"), flying, false)?.do).toBe("realTime");
    expect(matchKey(press("Slash", "?", true), flying, false)?.do).toBe("help");
  }
  // AZERTY: ! is real time, ; slower
  expect(matchKey(press("Slash", "!"), false, false)?.do).toBe("realTime");
  expect(matchKey(press("Comma", ";"), false, false)).toMatchObject({ do: "warp", arg: "-1" });
});

test("AZERTY: the free-flight keys fly, M (by its character) is the map", () => {
  // A on AZERTY is code KeyQ: a flight key, nothing in the scene
  expect(matchKey(press("KeyQ", "a"), false, true)).toBeUndefined();
  expect(matchKey(press("Semicolon", "m"), true, false)?.do).toBe("map");
  expect(matchKey(press("Semicolon", "M", true), true, false)).toBeUndefined(); // (⇧M: the panel's)
  expect(matchKey(press("F2", "F2"), true, false)?.do).toBe("tools");
});
