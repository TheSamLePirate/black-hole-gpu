import { describe, expect, test } from "bun:test";
import { baseMode, type ModeState, modeOf, planMode } from "../src/game/modes";

const S = (o: Partial<ModeState> = {}): ModeState => ({
  ship: true,
  piloting: true,
  spectating: false,
  onFoot: false,
  photo: false,
  photoOver: null,
  landedStill: false,
  groundBelow: null,
  rendering: false,
  ...o,
});

describe("the mode read from the state", () => {
  test("ship, foot, free (the spectator, or no ship), photo over any", () => {
    expect(modeOf(S())).toBe("ship");
    expect(modeOf(S({ onFoot: true }))).toBe("foot");
    expect(modeOf(S({ spectating: true }))).toBe("free");
    expect(modeOf(S({ ship: false, piloting: false }))).toBe("free");
    expect(modeOf(S({ photo: true, photoOver: "foot", onFoot: true }))).toBe("photo");
    expect(baseMode(S({ photo: true, photoOver: "foot", onFoot: true }))).toBe("foot");
  });
});

describe("the steps from a mode to another", () => {
  const steps = (s: ModeState, to: Parameters<typeof planMode>[1], hatch = false) => {
    const p = planMode(s, to, { hatch });
    return "steps" in p ? p.steps : p.refused;
  };
  test("the same mode: nothing; a render running: refused", () => {
    expect(steps(S(), "ship")).toEqual([]);
    expect(typeof steps(S({ rendering: true }), "free")).toBe("string");
  });
  test("ship → free: the spectator (the ship flies on); without a ship already free", () => {
    expect(steps(S(), "free")).toEqual(["startSpectator"]);
  });
  test("free → ship: back from the spectator, or the ship put in the scene", () => {
    expect(steps(S({ spectating: true }), "ship")).toEqual(["stopSpectator"]);
    expect(steps(S({ ship: false, piloting: false }), "ship")).toEqual(["shipOn"]);
  });
  test("ship → foot: out of the landed craft; flying: refused with the way", () => {
    expect(steps(S({ landedStill: true }), "foot")).toEqual(["disembark"]);
    expect(steps(S(), "foot")).toMatch(/land the craft/);
  });
  test("free → foot: the explorer set down on the world below; none below: refused", () => {
    expect(steps(S({ ship: false, piloting: false, groundBelow: "moon" }), "foot")).toEqual(["walkHere"]);
    expect(steps(S({ ship: false, piloting: false }), "foot")).toMatch(/no ground/);
    // (the spectator over a landed craft: back to it, out of it — over a ground of its own: down there)
    expect(steps(S({ spectating: true, landedStill: true }), "foot")).toEqual(["stopSpectator", "disembark"]);
    expect(steps(S({ spectating: true, landedStill: true, groundBelow: "mars" }), "foot")).toEqual(["walkHere"]);
  });
  test("foot → ship: on board near the hatch, else back to the craft", () => {
    expect(steps(S({ onFoot: true }), "ship", true)).toEqual(["board"]);
    expect(steps(S({ onFoot: true }), "ship", false)).toEqual(["stopWalking"]);
    // (walking without a ship: the walk ended, the ship put in — never "board" with no craft)
    expect(steps(S({ onFoot: true, ship: false, piloting: false }), "ship", true)).toEqual(["stopWalking", "shipOn"]);
  });
  test("foot → free: the walk stopped, the spectator out", () => {
    expect(steps(S({ onFoot: true }), "free")).toEqual(["stopWalking", "startSpectator"]);
  });
  test("photo: opened over any mode; closed back to its mode, or on to another", () => {
    expect(steps(S({ onFoot: true }), "photo")).toEqual(["openPhoto"]);
    expect(steps(S({ photo: true, photoOver: "ship" }), "ship")).toEqual(["closePhoto"]);
    expect(steps(S({ photo: true, photoOver: "ship" }), "free")).toEqual(["closePhoto", "startSpectator"]);
  });
});
