import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// Walking together on another world: Ana and Ben landed some 180 m apart by Apollo 11's site on the Moon, each out
// on foot: each sees the other's astronaut and the other's craft parked — still, not carried off (a landed craft is
// sent fixed to the Moon's ground, not on an orbit); then Ben, "Beside" Ana while she walks: on foot by her, his
// craft parked by hers. (NET_SHOTS=<dir>: the views.)

describe.skipIf(!E2E)("walking together on the Moon", () => {
  let a: App;
  let b: App;
  let sa = 0;
  let sb = 0;
  const shots = process.env.NET_SHOTS;
  const shot = async (p: App, name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await p.shot(`${shots}/${name}.png`);
  };
  /** out on foot at a place of the Moon, the ground's tiles waited for (tried again) */
  const walkAt = async (p: App, lat: number, lon: number) => {
    for (let k = 0; k < 40 && !(await p.js<boolean>(`__bh.camera.character.active`)); k++) {
      await p.js(`(() => { try { __bh.game.walk("moon", ${lat}, ${lon}); } catch { __bh.step(1 / 30); } return 1; })()`);
      await Bun.sleep(500);
    }
    expect(await p.js<boolean>(`__bh.camera.character.active`)).toBe(true);
  };
  beforeAll(async () => {
    a = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await a.waitFor("__bh.camera.piloting", 120_000);
    await a.js(`(() => { __bh.net.setName("Ana"); __bh.settings.vessel = "lander"; return 1; })()`);
    await a.js(`__bh.net.create("Tranquility")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    const code = await a.js<string>(`__bh.net.net.room.code`);
    b = await App.boot({ width: 1280, height: 800, hash: `scene=game:artemis&join=${code}`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
    await b.js(`(() => { __bh.net.setName("Ben"); __bh.settings.vessel = "lander"; return 1; })()`);
    sa = await a.js<number>(`__bh.net.net.room.slot`);
    sb = await b.js<number>(`__bh.net.net.room.slot`);
    await b.waitFor(`__bh.net.net.clock.synced && !__bh.net.session.teleport(-1).includes("clock")`, 30_000);
  }, 300_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  test("both landed and on foot: each sees the other's astronaut and craft, the craft still", async () => {
    await walkAt(a, 0.674, 23.473);
    await walkAt(b, 0.68, 23.473);
    for (const p of [a, b])
      await p.waitFor(`__bh.renderer.netWalkersCam.length === 1 && __bh.net.session.tags.some((g) => g.kind.includes("Lander"))`, 30_000);
    const craftDist = (p: App) => p.js<number>(`__bh.net.session.tags.find((g) => g.kind.includes("Lander")).dist`);
    const d0 = await craftDist(a);
    await Bun.sleep(10_000);
    const d1 = await craftDist(a);
    const walker = await a.js<number>(`__bh.renderer.netWalkersCam[0].dist`);
    console.log(`  Ana sees Ben on foot ${walker.toFixed(0)} m off, his Lander ${d0.toFixed(1)} m → ${d1.toFixed(1)} m 10 s later`);
    expect(walker).toBeGreaterThan(100);
    expect(walker).toBeLessThan(300);
    expect(Math.abs(d1 - d0)).toBeLessThan(1);
    const sample = await a.js<string>(
      `(() => { const s = __bh.net.net.remotes.track(${sb}).latest; return s.frame + "/" + s.body + "/" + s.flags; })()`,
    );
    console.log(`  Ben's craft sent as frame/body/flags ${sample}`);
    expect(sample.startsWith("0/1/")).toBe(true);
    await shot(a, "moon-a");
  }, 180_000);

  test("Ben, Beside Ana while she walks: on foot by her, his Lander parked by hers", async () => {
    let said = "";
    for (let k = 0; k < 20; k++) {
      said = await b.js<string>(`__bh.net.session.teleport(${sa})`);
      if (said.includes("Ana") && !said.includes("loading")) break;
      await Bun.sleep(1000);
    }
    console.log(`  ${said}`);
    await Bun.sleep(3000);
    const walker = await a.js<number>(`Math.min(...__bh.renderer.netWalkersCam.map((w) => w.dist))`);
    const me = await b.js<string>(
      `(() => { const q = __bh.camera.character.q, s = __bh.net.net.remotes.track(${sa}, true).at(__bh.sim.time * 492.549).p; return Math.hypot(q[0] - s[0], q[1] - s[1], q[2] - s[2]).toFixed(1); })()`,
    );
    console.log(`  Ben ${me} m from Ana on his page; Ana sees him ${walker.toFixed(1)} m from her eye`);
    expect(Number(me)).toBeLessThan(5);
    expect(await b.js<boolean>(`__bh.camera.character.active && __bh.camera.character.body === "moon"`)).toBe(true);
    await shot(a, "moon-beside-a");
    await shot(b, "moon-beside-b");
  }, 90_000);
});
