import { expect, test } from "bun:test";
import { setLang } from "../src/i18n";
import { QUALITY, defaultSettings } from "../src/settings";
import { describeDiff, diffFromDefaults, matchesControl, matchingQuality, mergedSettings } from "../src/ui/panel-pure";
import { SCHEMA_BY_KEY } from "../src/ui/schema";

// The Labo panel's decisions out of src/ui/panel.ts (audit 2026-11-10, QA-10): a preset's content, an import's filtering, the quality
// still held, the search, an undo's name — the same code, now tested.

test("a preset's content: the settings off their defaults, the pixel ratio never", () => {
  const d = defaultSettings();
  const s = { ...d, pixelRatio: d.pixelRatio + 1, fov: d.fov + 10 };
  expect(diffFromDefaults(s, d)).toEqual({ fov: d.fov + 10 });
  expect(diffFromDefaults(d, d)).toEqual({});
});

test("an import put on the defaults: unknown keys and wrong types left out, the subsampling 'auto' or a number", () => {
  const d = defaultSettings();
  const s = { ...d, fov: d.fov + 5, pixelRatio: 3 };
  const onDefaults = mergedSettings({ fov: 50, nonsense: 1, showFps: "yes", realtimeSubsampling: "auto" } as never, d, s, true);
  expect(onDefaults.fov).toBe(50);
  expect("nonsense" in onDefaults).toBe(false);
  expect(onDefaults.showFps).toBe(d.showFps);
  expect(onDefaults.realtimeSubsampling).toBe("auto");
  expect(onDefaults.pixelRatio).toBe(3);
  // (on the current settings: what is not imported stays as it is)
  const onCurrent = mergedSettings({ realtimeSubsampling: 4 } as never, d, s, false);
  expect(onCurrent.fov).toBe(d.fov + 5);
  expect(onCurrent.realtimeSubsampling).toBe(4);
});

test("the quality still held: every value of it; one moved off, none", () => {
  const d = defaultSettings();
  const q = d.quality;
  const held = { ...d, ...QUALITY[q], quality: q };
  expect(matchingQuality(held)).toBe(q);
  const k = Object.keys(QUALITY[q])[0] as keyof typeof held;
  const off = { ...held, [k]: typeof held[k] === "number" ? (held[k] as number) + 1 : !held[k] };
  expect(matchingQuality(off as typeof held)).toBeNull();
});

test("the search finds a setting by its words, in English and French; an undo named by its setting or its count", () => {
  setLang("fr");
  const fov = SCHEMA_BY_KEY.get("fov")!;
  expect(matchesControl(fov, "fov")).toBe(true);
  expect(matchesControl(fov, String(fov.label).toLowerCase().split(" ")[0]!)).toBe(true);
  expect(matchesControl(fov, "zzzz nothing")).toBe(false);
  setLang("en");
  expect(describeDiff([{ key: "fov", before: 60, after: 70 }])).toBe(String(fov.label));
  expect(
    describeDiff([
      { key: "fov", before: 60, after: 70 },
      { key: "showFps", before: false, after: true },
    ]),
  ).toBe("2 settings");
});
