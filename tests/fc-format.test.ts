import { expect, test } from "bun:test";
import { setLang } from "../src/i18n";
import { dur, km, ms, part, rM, transferAt } from "../src/ui/fc/format";

// The flight computer's figures and its porkchop's transfer, out of src/ui/fc/computer.ts (audit 2026-11-10, QA-10): the same code,
// now tested — the figures at their thresholds; a transfer between two circular orbits about the Earth costing what Hohmann says.

test("the figures: distances, durations, speeds, a burn's part, a radius about the hole", () => {
  expect(km(950)).toBe("950 m");
  expect(km(12_345)).toBe("12.3 km");
  expect(km(4_200_000)).toBe("4200 km");
  expect(km(1.495978707e11)).toBe("1.000 AU");
  expect(km(Infinity)).toBe("∞");
  expect(dur(42)).toBe("42 s");
  expect(dur(-125)).toBe("−2 min 05 s");
  expect(dur(3 * 3600 + 7 * 60)).toBe("3 h 07 min");
  expect(dur(2.5 * 86400)).toBe("2.5 d");
  expect(dur(Number.NaN)).toBe("—");
  expect(ms(7.25)).toBe("7.25 m/s");
  expect(ms(1500)).toBe("1.50 km/s");
  expect(ms(0.5 * 299_792_458)).toBe("0.5000 c");
  expect(part(1234.5, false)).toBe("1234.5");
  expect(part(1234.5, true)).toBe("1");
  expect(rM(6, 1000)).toBe("6.00 M · 6000 m");
});

test("a transfer from 7 000 to 8 000 km about the Earth: one burn intercepting, two meeting — near Hohmann's", () => {
  setLang("en");
  const mu = 3.986004418e14,
    r1 = 7e6,
    r2 = 8e6;
  const v1 = Math.sqrt(mu / r1),
    v2 = Math.sqrt(mu / r2);
  // (Hohmann's: its two burns and its half ellipse's time; flown 2 % shorter — the exact half turn leaves the plane undefined)
  const a = (r1 + r2) / 2;
  const dv1 = v1 * (Math.sqrt((2 * r2) / (r1 + r2)) - 1),
    dv2 = v2 * (1 - Math.sqrt((2 * r1) / (r1 + r2)));
  const tof = 0.98 * Math.PI * Math.sqrt(a ** 3 / mu);
  // (the target placed so as to be where the transfer arrives: a half turn on, less its own motion meanwhile)
  const th = 0.98 * Math.PI - (v2 / r2) * tof;
  const c = {
    mu,
    R: 6.371e6,
    r: [r1, 0, 0] as [number, number, number],
    v: [0, v1, 0] as [number, number, number],
    target: {
      name: "Target",
      r: [r2 * Math.cos(th), r2 * Math.sin(th), 0] as [number, number, number],
      v: [-v2 * Math.sin(th), v2 * Math.cos(th), 0] as [number, number, number],
    },
  };
  const hit = transferAt(c, 0, tof, false)!;
  expect(hit.ok).toBe(true);
  expect(hit.burns.length).toBe(1);
  expect(hit.note).toContain("Intercept with Target");
  expect(hit.dvTotal).toBeGreaterThan(0.9 * dv1);
  expect(hit.dvTotal).toBeLessThan(1.5 * dv1);
  const meet = transferAt(c, 0, tof, true)!;
  expect(meet.burns.length).toBe(2);
  expect(meet.dvTotal).toBeGreaterThan(0.9 * (dv1 + dv2));
  expect(meet.dvTotal).toBeLessThan(1.5 * (dv1 + dv2));
  expect(transferAt({ ...c, target: undefined }, 0, tof, false)).toBeNull();
});
