import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { NetClient } from "../../src/net/client";
import { emptyVisual } from "../../src/net/proto";
import { geodeticToCart, WGS84_A, WGS84_F } from "../../src/system/ellipsoid";

// The independent crew shell: no WebGPU, shader or simulator download; a real room, mobile views,
// multi-touch while holding PTT, interrupted gestures and permission races. Finally a real simulator's feed.
describe.skipIf(!E2E)("crew console", () => {
  let app: App;
  let pilot: NetClient;
  let feed: ReturnType<typeof setInterval>;
  let roomCode = "";
  let t = 0;
  beforeAll(async () => {
    app = await App.boot({
      entry: "crew",
      width: 390,
      height: 844,
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
      initScript: `if (location.pathname.includes('/crew/')) Object.defineProperty(navigator, "gpu", {get() { throw new Error("Crew accessed WebGPU"); }});`,
    });
    pilot = new NetClient({
      url: new URL("net", app.url).href.replace("http", "ws"),
      build: "test",
      id: { device: "crew-test-pilot", name: "Ana", colour: "#89dce5" },
      p2p: false,
    });
    roomCode = (await pilot.create("Crew flight", 0)).code;
    feed = setInterval(() => {
      t += 0.25;
      pilot.sendCraft({
        frame: 0,
        body: 0,
        kind: 3,
        flags: 0,
        p: geodeticToCart(WGS84_A, WGS84_F, (48.85 * Math.PI) / 180, ((2.35 + t * 0.0001) * Math.PI) / 180, 1500),
        v: [0, 200, 0],
        q: [0, 0, 0, 1],
        w: [0, 0, 0],
        a: [0, 0, 0],
        vis: { ...emptyVisual(), mach: 0.6 },
      });
      pilot.event({
        kind: "instruments",
        data: {
          v: 1,
          t,
          body: "earth",
          metrics: { alt: 1500 + t, speed: 200, fuel: 0.75, mach: 0.6, g: 1, tau: 1 },
          geo: { lat: 48.85, lon: 2.35, heading: 1 },
          radar: { mode: "TWS", contacts: [{ id: "test", name: "CONTACT", e: 4000, n: 10000, dz: 200, iff: "friend", locked: true }] },
          route: [
            { lat: 48.85, lon: 2.35, name: "PARIS" },
            { lat: 49.1, lon: 2.5, name: "WP02" },
          ],
          ahead: [],
        },
      });
    }, 250);
  }, 90_000);
  afterAll(() => {
    clearInterval(feed);
    pilot?.close();
    app?.close();
    stopServer();
  });

  test("joins a real room as instruments without initializing or downloading the simulator", async () => {
    await app.click("#name");
    await app.type("Ben");
    await app.click("#code");
    await app.type(roomCode);
    await app.click("#join");
    await app.waitFor("__crew.net.room?.role === 'instruments' && !!__crew.model.own()?.snapshot", 15_000);
    expect(await app.js<string>("typeof window.__bh")).toBe("undefined");
    expect(await app.js<number>("__crew.model.own().metrics.fuel")).toBe(0.75);
    expect(
      await app.js<string[]>(
        "performance.getEntriesByType('resource').map(r => r.name).filter(n => /\\.(wgsl|wasm|ktx2|webp|jpg|bin)(\\?|$)|net\\.js|audio-worklet|plan-worker|scenery-worker/.test(n))",
      ),
    ).toEqual([]);
    expect(await app.js<boolean>("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
    await app.shot("remote-results/crew-mobile-map.png");
  }, 30_000);

  test("every view and its buttons work on a phone, the received data on its tiles; no TARS on the console", async () => {
    for (const view of ["dash", "nd", "globe", "radar", "schematic", "plan", "telemetry", "map"]) {
      // (the tabs' bar scrolls on a phone: the tab brought into view as a finger would)
      await app.js(`(document.querySelector('[data-view=${view}]').scrollIntoView({ inline: 'center', block: 'nearest' }), true)`);
      await app.click(`[data-view=${view}]`);
      expect(await app.js<string>("__crew.views.view")).toBe(view);
      const b = await app.hit("#zoom-in");
      expect(b.x).toBeGreaterThan(0);
      await app.click("#zoom-in");
      expect(await app.js<boolean>("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
    }
    expect(await app.js<string>("document.querySelector('[data-key=fuel] strong').textContent")).toContain("75");
    expect(await app.js<boolean>("!document.querySelector('#tars, #tars-button') && !('askTars' in __crew)")).toBe(true);
    await app.js("(__crew.setView('globe'), true)");
    expect(await app.js<string>("__crew.views.view")).toBe("globe");
    await app.shot("remote-results/crew-mobile-globe.png");
  });

  test("WebRTC voice works in both directions with an independent second screen", async () => {
    await app.js(
      `(() => { const f=document.createElement('iframe'); f.id='radio-peer'; f.src='/crew/'; f.style.cssText='position:fixed;width:1px;height:1px;left:0;bottom:0;border:0;opacity:0'; document.body.append(f); return true; })()`,
    );
    await app.waitFor("!!document.querySelector('#radio-peer').contentWindow.__crew", 10_000);
    await app.js(`document.querySelector('#radio-peer').contentWindow.__crew.join('${roomCode}', 'Radio peer')`);
    await app.js(`(async () => {
      const w=document.querySelector('#radio-peer').contentWindow;
      await w.__crew.radio.listen();
      const ctx=new w.AudioContext(); await ctx.resume(); const out=ctx.createMediaStreamDestination(); const tone=ctx.createOscillator(); tone.frequency.value=440; tone.connect(out); tone.start();
      w.__tone={ctx,tone}; w.__crew.net.setMic(out.stream.getAudioTracks()[0]); return true;
    })()`);
    await app.click("#listen");
    await app.waitFor("__crew.radio.speaking(document.querySelector('#radio-peer').contentWindow.__crew.net.room.slot)", 15_000);
    await app.click("#microphone");
    await app.waitFor("__crew.radio.gate.ready", 10_000);
    await app.click("#toggle-talk");
    await app.click("#talk");
    await app.waitFor("document.querySelector('#radio-peer').contentWindow.__crew.radio.speaking(__crew.net.room.slot)", 15_000);
    await app.click("#talk");
    await app.click("#toggle-talk");
    await app.click("#microphone");
    await app.js(
      "(document.querySelector('#radio-peer').contentWindow.__tone.ctx.close(), document.querySelector('#radio-peer').remove(), true)",
    );
  }, 45_000);

  test("PTT transmits only while held, even while another finger moves the map", async () => {
    await app.click("#microphone");
    await app.waitFor("__crew.radio.gate.ready", 10_000);
    await app.js("__crew.setView('map')");
    await app.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    const b = await app.hit("#talk");
    const cv = await app.hit("#instruments");
    const p = { x: b.x, y: b.y, id: 1, radiusX: 4, radiusY: 4, force: 1 };
    await app.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
    await app.waitFor("__crew.net.micTrack?.enabled === true", 3000);
    await app.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p, { ...p, id: 2, x: cv.x, y: cv.y }] });
    await app.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [p, { ...p, id: 2, x: cv.x + 40, y: cv.y + 15 }] });
    expect(await app.js<boolean>("__crew.net.micTrack.enabled")).toBe(true);
    await app.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await app.waitFor("__crew.net.micTrack?.enabled === false", 3000);
    expect(await app.js<boolean>("__crew.views.follow")).toBe(false);
    await app.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
    await app.waitFor("__crew.radio.gate.active", 3000);
    await app.cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    expect(await app.js<boolean>("__crew.net.micTrack.enabled")).toBe(false);
  }, 20_000);

  test("toggle, window interruption, disabling and delayed permission cannot leave the microphone open", async () => {
    await app.click("#toggle-talk");
    await app.click("#talk");
    expect(await app.js<boolean>("__crew.net.micTrack.enabled")).toBe(true);
    await app.js("(window.dispatchEvent(new Event('blur')), true)");
    expect(await app.js<boolean>("__crew.net.micTrack.enabled")).toBe(false);
    await app.click("#microphone");
    await app.js(`(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.__realMic = original;
      navigator.mediaDevices.getUserMedia = async () => { const s = await original({audio:true}); await new Promise(r => window.__releaseMic = r); window.__lateStream = s; return s; };
      return true;
    })()`);
    await app.click("#microphone");
    await app.waitFor("typeof window.__releaseMic === 'function'", 5000);
    await app.js("(__crew.radio.disableMic(), window.__releaseMic(), true)");
    await app.waitFor("window.__lateStream?.getTracks().every(t => t.readyState === 'ended')", 5000);
    expect(await app.js<boolean>("__crew.radio.gate.active")).toBe(false);
    await app.js("(navigator.mediaDevices.getUserMedia = window.__realMic, true)");
  }, 20_000);

  test("tablet and landscape controls stay reachable; the console reports stale data", async () => {
    for (const [width, height] of [
      [1024, 768],
      [844, 390],
      [1440, 900],
    ]) {
      await app.cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
      await Bun.sleep(200);
      expect(await app.js<boolean>("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
      const p = await app.hit("#talk");
      expect(p.y).toBeLessThan(height!);
      await app.shot(`remote-results/crew-${width}x${height}.png`);
    }
    clearInterval(feed);
    await app.waitFor("document.querySelector('#freshness').textContent.includes('ancienne')", 6000);
    expect(app.cdp.errors).toEqual([]);
  }, 15_000);

  test("the actual simulator publishes its measurements and the independent screen link", async () => {
    pilot.close();
    app.entry = undefined;
    await app.load("scene=game:artemis");
    await app.js("(__bh.net.setName('Ana'), true)");
    await app.js("__bh.net.create('Real crew feed')");
    const code = await app.js<string>("__bh.net.net.room.code");
    const observer = new NetClient({
      url: new URL("net", app.url).href.replace("http", "ws"),
      build: "test",
      id: { device: "crew-feed-observer", name: "Observer", colour: "#89dce5" },
      p2p: false,
    });
    let data: unknown = null;
    const acks: Record<string, unknown>[] = [];
    observer.on("event", ({ ev }) => {
      if (ev.kind === "instruments") data = ev.data;
      if (ev.kind === "crew-ack") acks.push(ev as Record<string, unknown>);
    });
    try {
      await observer.join(code, "instruments");
      const limit = Date.now() + 15_000;
      while (!data && Date.now() < limit) await Bun.sleep(100);
      expect(data).not.toBeNull();
      const snapshot = data as {
        v: number;
        metrics: { speed: number; fuel?: number };
        body: string;
        auto?: object;
        sys?: object;
        warn?: string[];
      };
      expect(snapshot.v).toBe(1);
      expect(Number.isFinite(snapshot.metrics.speed)).toBe(true);
      // (the blocks the console's PFD, systems and annunciator read)
      expect(snapshot.auto).toBeTruthy();
      expect(snapshot.sys).toBeTruthy();
      expect(Array.isArray(snapshot.warn)).toBe(true);
      // the crew's orders (PLAN-CREW-ACTIONS A0): the families announced, an order carried out and answered, then
      // refused once the pilot locks them
      const caps = (data as { caps?: { on: boolean; fam: string[] } }).caps;
      expect(caps?.on).toBe(true);
      expect(caps?.fam).toContain("config");
      const pilotSlot = await app.js<number>("__bh.net.net.room.slot");
      const ask = async (id: string) => {
        observer.event({ kind: "crew-cmd", v: 1, id, to: pilotSlot, act: "cfg.ack", args: {} });
        const until = Date.now() + 5000;
        while (!acks.some((a) => a.id === id) && Date.now() < until) await Bun.sleep(50);
        return acks.find((a) => a.id === id);
      };
      expect(await ask("e2e-ack-1")).toMatchObject({ ok: true, act: "cfg.ack" });
      await app.js("(__bh.settings.netCrewActions = false, true)");
      const refused = await ask("e2e-ack-2");
      expect(refused).toMatchObject({ ok: false });
      expect(String(refused?.msg)).toMatch(/verrouill|lock/i);
      await app.js("(__bh.settings.netCrewActions = true, true)");
      await app.js("(__bh.net.open(), true)");
      await app.click("[data-testid=net-tab-screens]");
      await app.waitFor("!!document.querySelector('[data-testid=net-screen-role]')", 10_000);
      // (the pilot's lock on the crew's actions, beside the link)
      expect(await app.js<boolean>("document.querySelector('[data-testid=net-crew-actions]').checked")).toBe(true);
      await app.js(
        "(() => { const s=document.querySelector('[data-testid=net-screen-role]'); s.value='instruments'; s.dispatchEvent(new Event('change')); return true; })()",
      );
      expect(await app.js<string>("document.querySelector('.netp-link').textContent")).toContain(`/crew/#join=${code}`);
      const shared = await app.js<string>(
        `Promise.resolve(__bh.tars.tools().find(t => t.name === 'show_screen').run({screen:'crew_console'}, new AbortController().signal)).then(r => r?.result ?? r)`,
      );
      expect(shared).toContain(`/crew/#join=${code}`);
    } finally {
      observer.close();
    }
  }, 240_000);
});
