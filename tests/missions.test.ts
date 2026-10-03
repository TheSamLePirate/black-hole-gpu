import { expect, test } from "bun:test";
import { MISSIONS } from "../src/game/missions";
import { presets } from "../src/settings";

// Each mission starts a scene that exists, and says everything in both languages.
test("every mission: its scene, its briefing in French and English", () => {
  expect(MISSIONS.length).toBeGreaterThanOrEqual(4);
  for (const m of MISSIONS) {
    expect(presets[m.scene], m.scene).toBeDefined();
    for (const t of [m.title, m.tagline, m.briefing, ...m.objectives, ...m.keys.map(([, t]) => t)]) {
      expect(t.fr.length, `${m.scene}: ${t.en}`).toBeGreaterThan(0);
      expect(t.en.length, `${m.scene}: ${t.fr}`).toBeGreaterThan(0);
    }
    expect(m.objectives.length).toBeGreaterThan(0);
  }
  expect(new Set(MISSIONS.map((m) => m.scene)).size).toBe(MISSIONS.length);
});
