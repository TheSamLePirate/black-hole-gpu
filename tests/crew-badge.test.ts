import { expect, test } from "bun:test";
import { profileBadge, stationWhere } from "../src/crew/badge";
import { setLang } from "../src/crew/lang";

// The crew console's badge, out of src/crew/main.ts (audit 2026-11-10, QA-10): where the station is and the profile's line — the same
// code, now tested.

const near = { delay: 0, cut: false };

test("where the station is: aboard agreed or waiting, the ground with its light's time or its link cut", () => {
  setLang("en");
  expect(stationWhere("aboard", true, "yes", near)).toBe("aboard");
  expect(stationWhere("aboard", false, "asked", near)).toBe("aboard · waiting for the pilot");
  // (refused aboard: on the ground)
  expect(stationWhere("aboard", false, "no", near)).toBe("ground");
  expect(stationWhere("ground", true, undefined, { delay: 1.3, cut: false })).toMatch(/^ground \+1/);
  expect(stationWhere("ground", true, undefined, { delay: 0.2, cut: false })).toBe("ground");
  expect(stationWhere("ground", true, undefined, { delay: 0, cut: true })).toBe("ground · link cut");
  setLang("fr");
  expect(stationWhere("aboard", true, "yes", near)).toBe("à bord");
  setLang("en");
});

test("the badge: a jet's tactical console, a spacecraft's station, nothing for the others", () => {
  setLang("en");
  expect(profileBadge("jet", undefined, "", "")).toBe("F-35 · TACTICAL");
  expect(profileBadge("space", "Ranger", "CAPCOM", "ground")).toBe("SPACECRAFT · RANGER — CAPCOM · GROUND");
  expect(profileBadge(null, "Ranger", "CAPCOM", "ground")).toBe("");
});
