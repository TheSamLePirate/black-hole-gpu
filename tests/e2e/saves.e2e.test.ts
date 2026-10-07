import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// A saved flight reloads as it was — whatever was flown before it in the page: the fleet's craft flown
// (not "switched to" where the fleet had it), its docks, the entry's site, the entry's fall. The states
// are the HUD gallery's (tests/hud/states/, saved by the flight lab beside its pictures). Before: a Lander
// saved descending over Kennedy reloaded in its 500 km orbit, or by the wormhole after another flight; a
// docking to the ISS reloaded by the wormhole; a deorbit to Le Bourget aimed at Baikonur; a fall saved
// after its deorbit burn planned another deorbit, found none and let go; so did a deorbit waited for.

const state = (name: string) => Bun.file(`${import.meta.dir}/../hud/states/${name}.json`).text();

interface Seen {
  label: string;
  soi: string;
  altKm: number;
  vessel: string;
  auto: string;
  entry: string | null;
  site: string | null;
}

describe.skipIf(!E2E)("a saved flight reloads as it was", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot();
  });
  afterAll(() => {
    app?.close();
    stopServer();
  });
  const load = async (name: string): Promise<Seen> => {
    const json = await state(name);
    return app.js<Seen>(`(() => {
      __bh.freeze(true);
      __bh.game.importSave(${JSON.stringify(json)}, false);
      for (let i = 0; i < 30; i++) __bh.step(1 / 30);
      const s = __bh.game.status(), c = __bh.camera;
      return { label: s.label, soi: s.soiName, altKm: s.altKm, vessel: __bh.settings.vessel, auto: c.pilot.auto,
        entry: c.entryRun ? c.entryRun.phase : null, site: c.entrySite ? c.entrySite.name : null };
    })()`);
  };

  test("chained: the Moon's descent, then the Lander over Kennedy, the Ranger's rollout, the docking to the ISS", async () => {
    const moon = await load("08-moon-descent");
    expect(moon.soi).toBe("Moon");
    const lander = await load("09-lander-descent");
    expect(lander.vessel).toBe("lander");
    expect(lander.soi).toBe("Earth");
    expect(lander.altKm).toBeLessThan(5);
    const roll = await load("07-rollout");
    expect(roll.vessel).toBe("ranger");
    expect(roll.soi).toBe("Earth");
    expect(roll.altKm).toBeLessThan(1);
    const dock = await load("10-dock");
    expect(dock.soi).toBe("Earth");
    expect(dock.auto).toBe("dock");
    expect(Math.abs(dock.altKm - 425)).toBeLessThan(15);
  }, 120_000);

  test("the entry: its site kept, and a fall saved after the burn guided on, not a deorbit planned again", async () => {
    // (the deorbit waited for: taken up as planned — planned anew from its burn's moment, its pass was gone:
    // "no deorbit within a day of orbits", and the autopilot let go)
    const wait = await load("03-deorbit");
    expect(wait.site).toBe("Paris – Le Bourget");
    expect(wait.auto).toBe("entry");
    expect(wait.entry).toBe("wait");
    const fall = await load("04-entry");
    expect(fall.auto).toBe("entry");
    expect(fall.site).toBe("Paris – Le Bourget");
    expect(fall.entry).toBe("entry");
  }, 120_000);
});
