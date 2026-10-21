import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { CrewFrame } from "./lib/crew";

// The crew's stations (docs/CREW.md, AUDIT-CREW priority 6), on the real simulator: Ana's Ranger about the Moon (the
// light 1.3 s from the Earth), her room. A copilot console asks to be aboard — her card, accepted: live —; a FIDO
// console on the ground: its order held the light's time by Ana's game itself (the console sent it at once); a second
// copilot refused: on the ground. The room's light delay set by its creator (a tenth). The CAPCOM's Quindar tones in the
// voice it sends. Every station may order everything (the user's choice). Real clicks.
describe.skipIf(!E2E)("crew — the stations", () => {
  let app: App;
  let code = "";
  let sa = -1;
  const shots = process.env.E2E_SHOTS ?? "remote-results";
  const consoles: Record<string, CrewFrame> = {};
  /** a console in its frame, at a station, joined */
  const open = async (id: string, station: string, name: string, x: number) => {
    const f = new CrewFrame(app, id);
    await app.js(`(() => { const f = document.createElement('iframe'); f.id = '${id}'; f.src = '/crew/';
      f.style.cssText = 'position:fixed;top:520px;left:${x}px;width:520px;height:480px;border:0;z-index:99999'; document.body.append(f); return true; })()`);
    await app.waitFor(`!!${f.w("__crew")}`, 20_000);
    await app.js(f.d(`getElementById('station').value = '${station}'`));
    await f.js(`__crew.join('${code}', '${name}')`);
    await app.waitFor(f.w(`__crew.model.crafts().length >= 1`), 20_000);
    await f.js(`(__crew.model.selected = ${sa}, 1)`);
    consoles[id] = f;
    return f;
  };

  beforeAll(async () => {
    app = await App.boot({
      width: 1600,
      height: 1000,
      hash: "scene=game:artemis",
      tiles: false,
      // (a microphone without its prompt: the CAPCOM's)
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    });
    await app.waitFor("__bh.camera.piloting", 120_000);
    await app.js(`(() => { __bh.settings.vessel = "ranger"; __bh.settings.netLightDelay = "real"; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "ranger"`, 30_000);
    await app.js(`(() => { __bh.game.orbit("moon", { altKm: 100, inc: 10, raan: 0, nu: 0 }); return 1; })()`);
    await app.js("(__bh.net.setName('Ana'), true)");
    await app.js("__bh.net.create('Stations')");
    code = await app.js<string>("__bh.net.net.room.code");
    sa = await app.js<number>("__bh.net.net.room.slot");
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the copilot asks to be aboard: Ana's card, accepted — live, no light's time", async () => {
    const cp = await open("crew-cp", "copilot", "Doyle", 0);
    await app.waitFor(`!!document.querySelector('[data-testid="net-crew-aboard"]')`, 15_000);
    const ask = await app.js<string>(`document.querySelector('[data-testid="net-crew-aboard"] p').textContent`);
    console.log(`  Ana's card: ${ask}`);
    expect(ask).toMatch(/Doyle/);
    await app.click('[data-testid="net-crew-aboard-yes"]');
    await app.waitFor(cp.w(`__crew.model.aboardWith(${sa})`), 10_000);
    expect(await cp.js<{ delay: number }>(`__crew.model.linkOf(${sa})`)).toMatchObject({ delay: 0 });
    // (live: its order done at once)
    const t = await cp.js<number>(
      `(async () => { const t0 = performance.now(); const r = await __crew.actions.send('sp.hold', { direction: 'retrograde' }); return r.ok ? performance.now() - t0 : -1; })()`,
    );
    console.log(`  aboard: the order answered in ${t.toFixed(0)} ms`);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(800);
  }, 90_000);

  test("FIDO on the ground: its order held the light's time by Ana's game (sent at once by the console)", async () => {
    const fido = await open("crew-fido", "fido", "Brand", 540);
    await app.waitFor(fido.w(`__crew.model.linkOf(${sa}).delay > 1`), 20_000);
    // (the ground sees Ana's snapshot the light's time late: her caps once they have come)
    await app.waitFor(fido.w("__crew.actions.can('space').ok"), 20_000);
    const light = await fido.js<number>(`__crew.model.linkOf(${sa}).delay`);
    // (sent at once: the pilot holds it — its hold changed on Ana's craft the light's time after)
    await app.js(`(() => { window.__heldAt = null; const c = __bh.camera; const t0 = performance.now(); window.__sentAt = t0;
      const tick = () => { if (c.pilot.hold === "prograde") window.__heldAt = performance.now() - t0; else requestAnimationFrame(tick); }; tick(); return 1; })()`);
    const r = await fido.js<{ ok: boolean }>(`__crew.actions.send('sp.hold', { direction: 'prograde' })`);
    const held = await app.js<number>("window.__heldAt");
    console.log(`  the light ${light.toFixed(2)} s: done on Ana's craft after ${(held / 1000).toFixed(2)} s, answered ${r.ok}`);
    expect(r.ok).toBe(true);
    expect(held / 1000).toBeGreaterThan(light - 0.15);
    await app.shot(`${shots}/crew-posts-ground.png`);
  }, 90_000);

  test("a second copilot refused: on the ground — the light's time", async () => {
    const cp2 = await open("crew-cp2", "copilot", "Romilly", 1060);
    await app.waitFor(`!!document.querySelector('[data-testid="net-crew-aboard"]')`, 15_000);
    await app.click('[data-testid="net-crew-aboard-no"]');
    await app.waitFor(cp2.w(`__crew.model.linkOf(${sa}).delay > 1`), 20_000);
    expect(await cp2.js<boolean>(`__crew.model.aboardWith(${sa})`)).toBe(false);
    await app.waitFor(cp2.d("getElementById('profile-badge').textContent.startsWith('VAISSEAU')"), 20_000);
    const badge = await app.js<string>(cp2.d("getElementById('profile-badge').textContent"));
    console.log(`  Romilly's badge: ${badge}`);
    expect(badge).toMatch(/SOL|GROUND/);
  }, 60_000);

  test("the room's light delay, its creator's: a tenth — every ground station's", async () => {
    await app.js(`(() => { __bh.settings.netLightDelay = "tenth"; return 1; })()`);
    const fido = consoles["crew-fido"]!;
    await app.waitFor(fido.w(`__crew.model.linkOf(${sa}).delay < 0.3 && __crew.model.linkOf(${sa}).delay > 0.05`), 15_000);
    console.log(`  a tenth: ${(await fido.js<number>(`__crew.model.linkOf(${sa}).delay`)).toFixed(3)} s`);
    expect(await app.js<string | null>("__bh.net.session.roomDelay")).toBe("tenth");
  }, 30_000);

  test("CAPCOM's Quindar tones in the voice it sends: opened, closed", async () => {
    const cap = await open("crew-capcom", "capcom", "Doyle CAPCOM", 0);
    await cap.js("__crew.radio.enableMic()");
    await app.waitFor(cap.w("__crew.radio.gate.ready"), 10_000);
    await cap.click("#toggle-talk");
    await cap.click("#talk");
    await app.waitFor(cap.w("__crew.radio.tones >= 1"), 5000);
    await cap.click("#talk");
    await app.waitFor(cap.w("__crew.radio.tones >= 2"), 5000);
    // (the track sent: the mix's, not the microphone's own)
    expect(
      await cap.js<boolean>("__crew.net.micTrack !== null && __crew.net.micTrack.label !== __crew.radio.mic?.getAudioTracks()[0]?.label"),
    ).toBe(true);
    expect(app.cdp.errors).toEqual([]);
  }, 60_000);
});
