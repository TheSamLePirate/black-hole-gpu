import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-A320 A12: the A320 heard by FlightGear's recordings (src/a320/sound — its sound files on the systems' bag,
// src/audio/samples.ts playing them): measured at the output — the CFM56s at idle and at take-off power (louder, their
// spool and buzz layers in), from the seat and from outside, nothing clipped —; the voices playing, the cockpit's and the outside's; an engine
// fire's CRC (the ECAM's master warning, FlightGear's recording); a pushbutton's click.

describe.skipIf(!E2E)("the A320's sound", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.press("KeyT");
    await app.press("KeyT");
    await app.waitFor(`__sound.ctx?.state === "running"`, 10_000);
    await app.js(`(() => {
      __bh.settings.vessel = "a320";
      __bh.settings.a320Start = "ready";
      __bh.refresh();
      __bh.game.lineUp("Paris – Le Bourget");
      __bh.settings.shipMount = "cockpit";
      __bh.refresh();
      __bh.camera.a320Park = true;
      return true;
    })()`);
    await app.waitFor("!!__bh.camera.a320Sys", 60_000);
    // (the recordings fetched and decoded: the engines' loops playing)
    await app.waitFor(`(__sound.spaceState()?.craft?.playing.length ?? 0) > 4`, 60_000);
  }, 400_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  /** The engines' bus level [dBFS] a while after setting the levers and the view (the parking brake on). */
  const at = (mount: string, lever: number) =>
    app.js<{ lvl: number; peak: number; playing: string[] }>(`(async () => {
      __bh.settings.shipMount = ${JSON.stringify(mount)}; __bh.refresh();
      __bh.camera.pilot.throttle = ${lever};
      // (TOGA with the parking brake on: the ECAM's CONFIG PARK BRK ON and its CRC — rightly —, silenced by its button)
      await new Promise((ok) => setTimeout(ok, 1500));
      __bh.camera.a320Ecam?.button("masterWarn");
      // (the engines settled: N1 at idle, or at take-off power — then a second more)
      const n1 = () => __bh.camera.a320.engines[0].n1;
      for (let k = 0; k < 300 && (${lever > 0.5} ? n1() < 82 : n1() > 23); k++) await new Promise((ok) => setTimeout(ok, 100));
      await new Promise((ok) => setTimeout(ok, 1500));
      // (the engines' bus — the craft's recordings but its alarms and clicks —, its power averaged over a second; the
      // output's peak)
      let e = 0, peak = -200;
      for (let k = 0; k < 20; k++) {
        const B = __sound.busLevels();
        e += 10 ** (B.rcs / 10) / 20;
        peak = Math.max(peak, B.peak);
        await new Promise((ok) => setTimeout(ok, 50));
      }
      const C = __sound.spaceState()?.craft;
      return { lvl: 10 * Math.log10(e), peak, playing: C?.playing ?? [] };
    })()`);

  test("idle < take-off power, from the seat and from outside; the seat the quieter; never clipped", async () => {
    const r: Record<string, { lvl: number; peak: number; playing: string[] }> = {};
    for (const mount of ["cockpit", "chase"]) {
      r[`${mount} idle`] = await at(mount, 0);
      r[`${mount} TOGA`] = await at(mount, 1);
      await at(mount, 0);
    }
    console.log(
      Object.entries(r)
        .map(([k, v]) => `  ${k}: ${v.lvl.toFixed(1)} dB (peak ${v.peak.toFixed(1)}), ${v.playing.length} voices`)
        .join("\n"),
    );
    console.log(`  in the cockpit at TOGA: ${r["cockpit TOGA"]!.playing.slice(0, 14).join(", ")}`);
    console.log(`  outside at TOGA: ${r["chase TOGA"]!.playing.slice(0, 14).join(", ")}`);
    // (FlightGear's CFM56: its layers cross-faded by N1 — idle's out, spool's, comb's and buzz's in, higher —: the take-off
    // louder, and its own voices)
    for (const m of ["cockpit", "chase"]) {
      expect(r[`${m} TOGA`]!.lvl).toBeGreaterThan(r[`${m} idle`]!.lvl + 0.5);
      expect(r[`${m} TOGA`]!.playing.some((p) => /spool|buzz|rumble/i.test(p))).toBeTrue();
      expect(r[`${m} idle`]!.playing.some((p) => /buzz/i.test(p))).toBeFalse();
    }
    expect(r["cockpit TOGA"]!.lvl).toBeLessThan(r["chase TOGA"]!.lvl);
    for (const v of Object.values(r)) expect(v.peak).toBeLessThan(-0.5);
    // (the CFM56's loops in both)
    expect(r["cockpit idle"]!.playing.some((p) => /cfm|idle|engine/i.test(p))).toBeTrue();
    expect(r["chase idle"]!.playing.some((p) => /cfm|idle|engine/i.test(p))).toBeTrue();
  }, 180_000);

  test("an engine fire: the CRC; a pushbutton: its click", async () => {
    await app.js(`(__bh.settings.shipMount = "cockpit", __bh.refresh(), __bh.camera.a320Fail.arm("eng1-fire"), true)`);
    await app.waitFor(`__bh.camera.a320Ecam.masterWarning`, 30_000);
    await Bun.sleep(1500);
    const crc = await app.js<string[]>(`__sound.spaceState()?.craft?.playing ?? []`);
    console.log(`  master warning: ${crc.filter((p) => /crc|warn/i.test(p)).join(", ")}`);
    expect(crc.some((p) => /crc/i.test(p))).toBeTrue();
    await app.js(
      `(__bh.camera.a320Fail.clearAll(__bh.camera.a320Props), __bh.camera.a320Props["ECAM/warnings/master-warning-light"] = 0, true)`,
    );
    // (a pushbutton's binding: FlightGear's core.pushbutton() — its click's trigger)
    const shots0 = await app.js<number>(`(__sound.spaceState()?.craft?.shots ?? []).length`);
    await app.js(`(__bh.camera.a320Props["sim/sound/pushbutton"] = 1, true)`);
    await Bun.sleep(800);
    const shots = await app.js<string[]>(`__sound.spaceState()?.craft?.shots ?? []`);
    console.log(`  shots: ${shots.slice(-4).join(", ")}`);
    expect(shots.length).toBeGreaterThan(shots0);
    expect(shots.some((s) => /push|button|click/i.test(s))).toBeTrue();
  }, 90_000);
});
