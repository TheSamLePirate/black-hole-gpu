import { expect, test } from "bun:test";
import { FlightRecorder, type RecSample } from "../src/game/recorder";

// The flight's recorder (PLAN-HUB HB4): a sample per step of the scene's time, the whole flight kept as it
// grows (every other sample let go, the step doubled), a window of its last seconds, its CSV.

const at = (t: number, alt = t): RecSample => ({ t, alt, speed: 1, vz: 0, g: 1, q: 0, mach: 0, heat: 0, throttle: 0, dv: 0, fuel: null });

test("a sample per step; full, the step doubled and the whole span kept", () => {
  const R = new FlightRecorder(100, 1);
  for (let t = 0; t <= 50; t += 0.25) R.push(at(t));
  expect(R.samples.length).toBe(51);
  for (let t = 50.25; t <= 1000; t += 0.25) R.push(at(t));
  expect(R.samples.length).toBeLessThanOrEqual(100);
  expect(R.step).toBeGreaterThan(1);
  expect(R.samples[0]!.t).toBe(0);
  expect(R.samples[R.samples.length - 1]!.t).toBeGreaterThan(990);
});

test("the time going back starts afresh; a window holds the last seconds", () => {
  const R = new FlightRecorder(1000, 1);
  for (let t = 0; t <= 600; t += 1) R.push(at(t));
  const w = R.window(60);
  expect(w[0]!.t).toBeLessThanOrEqual(540);
  expect(w[0]!.t).toBeGreaterThanOrEqual(538);
  expect(w[w.length - 1]!.t).toBe(600);
  expect(R.window(Infinity).length).toBe(601);
  R.push(at(10));
  expect(R.samples.length).toBe(1);
});

test("the CSV: its header, a row a sample, a null as an empty cell", () => {
  const R = new FlightRecorder();
  R.push(at(0, 400e3));
  R.push({ ...at(1, 399.5e3), fuel: 0.75 });
  const lines = R.csv().trim().split("\n");
  expect(lines[0]).toBe("t_s,alt_m,speed_mps,vz_mps,load_g,q_pa,mach,heat_wpm2,throttle,dv_mps,fuel");
  expect(lines.length).toBe(3);
  expect(lines[1]!.endsWith(",")).toBe(true);
  expect(lines[2]!.split(",")[1]).toBe("399500");
  expect(lines[2]!.split(",")[10]).toBe("0.75");
});
