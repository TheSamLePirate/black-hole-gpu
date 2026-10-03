import { afterEach, expect, test } from "bun:test";
import { currentKey, effectiveBindings, freeCameraKeys, heldCode, rebind, remappables, resetBindings } from "../src/input/bindings";
import { matchKey } from "../src/input/keymap";

afterEach(() => resetBindings());
const press = (code: string, key: string, shiftKey = false) => ({ code, key, shiftKey });

test("a binding moved: its new key does it; the key it took swaps back to the other", () => {
  const sas = remappables().find((r) => r.id === "flight:sas::KeyT")!;
  expect(sas).toBeDefined();
  // (V was the ship's next view: it swaps, T now gives the next view)
  const swapped = rebind(sas.id, { code: "KeyV" });
  expect(swapped?.en).toBe("Next view (ship)");
  expect(matchKey(press("KeyV", "v"), true, false, effectiveBindings())?.do).toBe("sas");
  expect(matchKey(press("KeyT", "t"), true, false, effectiveBindings())?.do).toBe("mount");
  // (back to its own key: no override left)
  rebind(sas.id, { code: "KeyT" });
  expect(remappables().find((r) => r.id === sas.id)!.now.code).toBe("KeyT");
});

test("the held keys: pitch on another key, the free camera's own map, the hints' key", () => {
  rebind("held:pitchDown", { code: "KeyU" });
  expect(heldCode("pitchDown")).toBe("KeyU");
  expect(currentKey("KeyW")).toEqual({ code: "KeyU" });
  // (the free camera keeps W: another context)
  expect(freeCameraKeys().KeyW).toEqual([1, 0, 0, 0]);
  rebind("held:camForward", { code: "ArrowUp" });
  expect(freeCameraKeys().ArrowUp).toEqual([1, 0, 0, 0]);
  expect("KeyW" in freeCameraKeys()).toBe(false);
});

test("no key serves twice in one context after any rebind", () => {
  for (const [id, code] of [
    ["flight:map::m", "KeyB"],
    ["held:rollLeft", "KeyB"],
    ["flight:auto:dock:KeyB", "KeyG"],
  ] as const) {
    const r = remappables().find((x) => x.id === id);
    if (r) rebind(id, r.def.code ? { code } : { key: code.slice(3).toLowerCase() });
  }
  const fly = remappables().filter((r) => r.ctx.includes("fly"));
  const seen = new Map<string, string>();
  for (const r of fly) {
    const k = `${r.now.code ?? r.now.key}|${r.shift ?? "any"}`;
    if (r.shift === undefined) {
      for (const s of ["true", "false"]) expect(seen.get(`${r.now.code ?? r.now.key}|${s}`), r.id).toBeUndefined();
    }
    expect(seen.get(k), `${r.id} vs ${seen.get(k)}`).toBeUndefined();
    seen.set(k, r.id);
  }
});
