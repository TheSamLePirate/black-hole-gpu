import { describe, expect, test } from "bun:test";
import { marineAt, marineUrl, parseMarine, windSea } from "../src/sea/marine";
import { BANDS, CASCADES, SEA_N, seaCascades, seaSystems } from "../src/sea/spectrum";

// The sea's spectrum (docs/PLAN-AVIATION-AAA.md, M1; sea/spectrum.ts, sea/marine.ts): its cascades hold the
// significant height asked (4√m₀), each its own band of wavenumbers; the same seed the same sea; the slopes'
// variance under Cox–Munk's; the marine model's hours read, between them, its directions turned to where the waves
// go; the sea the wind raises where it has none.

const D = Math.PI / 180;

describe("the spectrum", () => {
  test("a force 5 sea (Hs 2 m, Tp 7 s) and a 1.5 m swell: their heights held, the bands apart, seeded", () => {
    const state = { wind: { hs: 2, tp: 7, to: 90 * D }, swell: { hs: 1.5, tp: 12, to: 60 * D } };
    const S = seaCascades(seaSystems(state, 90 * D), 1);
    const m0 = S.height.reduce((a, b) => a + b, 0);
    const hs = 4 * Math.sqrt(m0);
    console.log(
      `  Hs ${hs.toFixed(2)} m (asked ${Math.hypot(2, 1.5).toFixed(2)}): the cascades' share ${S.height.map((v) => ((100 * v) / m0).toFixed(1)).join(" / ")} %; slopes' variance ${S.slopeX.reduce((a, b) => a + b).toFixed(4)} along, ${S.slopeZ.reduce((a, b) => a + b).toFixed(4)} across`,
    );
    expect(Math.abs(hs - 2.5) / 2.5).toBeLessThan(0.06);
    expect(S.h0.length).toBe(CASCADES.length);
    expect(S.h0[0]!.length).toBe(SEA_N * SEA_N * 4);
    // (no mode outside its cascade's band)
    for (let c = 0; c < 3; c++) {
      const L = CASCADES[c]!;
      let outside = 0;
      for (let j = 0; j < SEA_N; j++)
        for (let i = 0; i < SEA_N; i++) {
          const kx = ((i < SEA_N / 2 ? i : i - SEA_N) * 2 * Math.PI) / L,
            kz = ((j < SEA_N / 2 ? j : j - SEA_N) * 2 * Math.PI) / L;
          const k = Math.hypot(kx, kz);
          const o = 4 * (j * SEA_N + i);
          if ((k < BANDS[c]![0] || k >= BANDS[c]![1]) && (S.h0[c]![o] !== 0 || S.h0[c]![o + 1] !== 0)) outside++;
        }
      expect(outside).toBe(0);
    }
    // (the amplitudes drawn: their mean squares summed half the variance — the conjugate pair the other half —:
    // the field's height what the spectrum says, not twice)
    let e = 0;
    for (const h of S.h0) for (let o = 0; o < h.length; o += 4) e += h[o]! ** 2 + h[o + 1]! ** 2;
    console.log(`  Σ|h̃₀|² ${e.toFixed(4)} m² against m₀/2 = ${(m0 / 2).toFixed(4)} m²`);
    expect(Math.abs(e / (m0 / 2) - 1)).toBeLessThan(0.1);
    // (the same seed, the same sea; another, another)
    expect(seaCascades(seaSystems(state, 90 * D), 1).h0[0]![4 * (3 * 256 + 5)]).toBe(S.h0[0]![4 * (3 * 256 + 5)]!);
    expect(seaCascades(seaSystems(state, 90 * D), 2).h0[0]![4 * (3 * 256 + 5)]).not.toBe(S.h0[0]![4 * (3 * 256 + 5)]!);
    // (the resolved slopes: under Cox–Munk's for a 10 m/s wind — 0.0316 along, 0.0222 across)
    expect(S.slopeX.reduce((a, b) => a + b)).toBeLessThan(0.0316);
  });

  test("a calm (Hs 0.2 m) and a storm (Hs 9 m, Tp 13 s)", () => {
    for (const [hs, tp] of [
      [0.2, 2.5],
      [9, 13],
    ] as const) {
      const S = seaCascades(seaSystems({ wind: { hs, tp, to: 0 }, swell: { hs: 0, tp: 10, to: 0 } }, 0), 3);
      const got = 4 * Math.sqrt(S.height.reduce((a, b) => a + b, 0));
      console.log(`  Hs ${hs} m, Tp ${tp} s → ${got.toFixed(2)} m`);
      expect(Math.abs(got - hs) / hs).toBeLessThan(0.08);
    }
  });
});

describe("the marine model", () => {
  test("its hours read; between two, its directions where the waves go; out of reach; the wind's sea", () => {
    const j = {
      hourly: {
        time: ["2026-10-15T10:00", "2026-10-15T11:00"],
        wind_wave_height: [1.2, 1.6],
        wind_wave_direction: [270, 290],
        wind_wave_peak_period: [5, 6],
        swell_wave_height: [0.8, 0.8],
        swell_wave_direction: [350, 10],
        swell_wave_peak_period: [11, 11],
        wave_height: [1.5, 1.8],
      },
    };
    const h = parseMarine(j)!;
    expect(h.length).toBe(2);
    const s = marineAt(h, Date.UTC(2026, 9, 15, 10, 30))!;
    expect(s.wind.hs).toBeCloseTo(1.4, 6);
    // (from 280°: going 100°; the swell from 0° — the short way round 350 → 10 —: going 180°)
    expect(s.wind.to / D).toBeCloseTo(100, 6);
    expect(s.swell.to / D).toBeCloseTo(180, 6);
    expect(marineUrl(48.5, -5, Date.UTC(2067, 0, 1), Date.UTC(2026, 9, 15))).toBeNull();
    expect(marineUrl(48.5, -5, Date.UTC(2026, 9, 15, 12), Date.UTC(2026, 9, 15))).toContain("marine-api.open-meteo.com");
    const w = windSea(10, 0);
    expect(w.wind.hs).toBeCloseTo(2.14, 1);
    expect(w.wind.tp).toBeCloseTo(7.3, 1);
  });
});
