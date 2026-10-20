import { expect, test } from "bun:test";
import { ROLE_VOICE, roleOfLine, SHARED_ROLES } from "../src/game/radio";
import { threatRole } from "../src/game/threats";
import { AURA_VOICES } from "../src/audio/aura-voices";
import { SPEAKER_STYLE } from "../src/audio/voice";

// PLAN-AVIATION-AAA I4: the flight's radio roles — a line written before them found its role by its words (English
// and French), the role's name left out, an addressee kept; the picture Darkstar's, the missiles at us TARS's; each
// role a voice of its own, a style of its own; the roles about our own craft shared with the room.

test("a radio line's role by its words; the role's name left out, an addressee kept", () => {
  expect(roleOfLine("Paddles: roger ball.")).toEqual({ role: "lso", text: "Roger ball." });
  expect(roleOfLine("Paddles : de la puissance !")).toEqual({ role: "lso", text: "De la puissance !" });
  expect(roleOfLine("Mother: airborne. Good launch.")).toEqual({ role: "mother", text: "Airborne. Good launch." });
  expect(roleOfLine("F-35C, Mother: Charlie. Case I — the initial, the break.")).toEqual({
    role: "mother",
    text: "F-35C, Charlie. Case I — the initial, the break.",
  });
  expect(roleOfLine("F-35B, ici Mother : autorisé au décollage vertical. Conversion.").role).toBe("mother");
  expect(roleOfLine("Shooter: launch!")).toEqual({ role: "mother", text: "Launch!" });
  expect(roleOfLine("Darkstar : situation claire")).toEqual({ role: "awacs", text: "Situation claire" });
  // (the tanker — the refuelling: controller/aar.ts —, by its callsign)
  expect(roleOfLine("TEXACO 11: cleared contact, right hose")).toEqual({ role: "tanker", text: "Cleared contact, right hose" });
  expect(roleOfLine("Edwards approach: cleared ILS 22")).toEqual({ role: "tower", text: "Edwards approach: cleared ILS 22" });
  expect(roleOfLine("Two, in position")).toEqual({ role: "tower", text: "Two, in position" });
});

test("the picture Darkstar's, the missiles at us TARS's; each role its voice and style; ours shared", () => {
  expect(["bandit", "group", "sam", "kill"].map((k) => threatRole(k as never))).toEqual(["awacs", "awacs", "awacs", "awacs"]);
  expect(["launch", "close", "defeated", "hit"].map((k) => threatRole(k as never))).toEqual(["tars", "tars", "tars", "tars"]);
  const ids = new Set(AURA_VOICES.map((v) => v.id));
  for (const v of Object.values(ROLE_VOICE)) expect(ids.has(v.fr) && ids.has(v.en)).toBe(true);
  // (the English voices all different)
  expect(new Set(Object.values(ROLE_VOICE).map((v) => v.en)).size).toBe(Object.keys(ROLE_VOICE).length);
  for (const r of ["wingman", "awacs", "mother", "lso"] as const) expect(SPEAKER_STYLE[r].rate).toBeGreaterThan(0.9);
  expect([...SHARED_ROLES]).toEqual(["wingman", "mother", "lso", "tanker"]);
});
