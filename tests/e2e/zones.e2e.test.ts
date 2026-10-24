import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// Offline zones (docs/ANALYSE-IGN-LIDAR.md §9, I8a; src/pwa-zones.ts, src/system/zones.ts, src/sw.ts): a region's tiles
// fetched ahead into the Service Worker's zones' cache, then the network cut and a low flight across it — its ground whole,
// not one tile asked of the network. Over Chamonix, a 1.5 km zone of the low flight's profile (the orthophotos to z 17,
// 0.8 m) with a detailed core of 0.8 km (an airfield's levels: the orthophotos to z 18, 0.4 m), the detail's normal reach, the IGN's relief off in this test (its chains: tests/zones.test.ts); the download
// paused half-way and resumed, its progress on screen; the tiles' own cache emptied, the network cut, the page loaded
// again (no tile in its memory); the ground looked at in the core, held still, its orthophotos to z 18, its detail
// measured against the same view online; then flown 1.8 km up the valley at 450 m over its floor, out of the core,
// held level at 120 m/s, in the cockpit, the page's tile responses counted (a zone's marked by the worker — the z 18
// apart: the core's from the zone, none asked past it); the zone dropped at the end. The world scenery off: not in a zone
// yet.
// (E2E_SHOTS=<dir>: zones-chamonix-online, zones-chamonix-offline — the ground held still, every pixel shaded.)
// Duration: ~4 min on kerr-mini (the download ~2 of them).
// Done when: the zone ready, the flight's tiles all from it (none from the network, not even the finer than the profile's),
// the z 18 drawn in the core, its ground whole, the zone dropped.

// (the low flight's profile: the orthophotos to z 17 — 0.8 m; the game asks z 18 under ~1 km over the ground, full
// screen: the core's in the zone; past it, offline, the game asks none — system/zones.ts zoneLevelsAt —, the z 17 drawn)
const ORTHO_Z1 = 17;
const ZONE = { name: "Chamonix (e2e)", lat: 45.92, lon: 6.87, radiusKm: 1.5, profile: "low", coreKm: 0.8 };
const D = Math.PI / 180;
// (the flight: 0.6 km south-west of the centre, in the core, up the valley's axis at 45° — its floor 1 084–1 104 m over
// ±1.5 km, its sides past 1 600 m 1.5 km off —, 1.8 km flown: out of the core at 1.4, 1.2 km past the centre at the end)
const START = {
  lat: ZONE.lat - (0.6 * Math.cos(45 * D)) / 111.2,
  lon: ZONE.lon - (0.6 * Math.sin(45 * D)) / (111.2 * Math.cos(ZONE.lat * D)),
};
const SETTINGS = `{ traffic: false, weather: "fair", earthClouds: 0, dof: false, earthPipeline: "raster", earthOrtho: true, earthIgnRelief: false, earthIgnSilhouettes: false, earthScenery: "off", earthSurface: "off", detailReach: "normal", f35AutoProtect: false }`;

/** the progress on screen (top middle, French as the user reads it): the phase the test sets, the zone's figures read every
 *  second and a half — put back after each load */
const PROGRESS = `(() => {
  document.getElementById("zone-progress")?.remove();
  const el = Object.assign(document.createElement("div"), { id: "zone-progress" });
  el.style.cssText = "position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:99999;padding:8px 16px;border-radius:8px;background:rgba(10,14,20,.82);color:#e8f1ff;font:13px/1.45 ui-monospace,monospace;text-align:center;pointer-events:none;white-space:pre";
  document.body.append(el);
  window.__zonePhase ??= "";
  clearInterval(window.__zoneTimer);
  const mb = (b) => (b / 1e6).toFixed(0) + " Mo";
  const state = { downloading: "téléchargement", paused: "en pause", ready: "prête" };
  window.__zoneTimer = setInterval(async () => {
    const z = (await __bh.pwa?.zones?.list().catch(() => []))?.find((v) => v.name === ${JSON.stringify(ZONE.name)});
    const t = window.__tiles;
    el.textContent = "Zone hors ligne « Chamonix » — 1,5 km, profil vol bas, cœur détaillé 0,8 km\\n" + (window.__zonePhase || "") +
      (z ? "\\n" + z.cursor + " / " + z.total + " tuiles · " + mb(z.bytes) + " · " + (state[z.state] ?? z.state) : "") +
      (t ? "\\ntuiles reçues en vol : " + t.zone + " de la zone · " + (t.other + t.failed) + " du réseau" + (t.finer ? " · dont " + t.finer + " plus fines que le profil (cœur)" : "") : "");
  }, 1500);
  return 1; })()`;

describe.skipIf(!E2E)("an offline zone", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const phase = (text: string) => app.js(`(window.__zonePhase = ${JSON.stringify(text)}, 1)`);
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", sw: true, tiles: true });
    await app.js(`(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${SETTINGS}); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    expect(await app.js<boolean>("__bh.pwa.ready()")).toBe(true);
    await app.waitFor("!!__bh.pwa.zones", 30_000);
    await app.js(PROGRESS);
  }, 300_000);
  afterAll(async () => {
    await app?.cdp
      .send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
      .catch(() => {});
    app?.close();
    stopServer();
  });

  const zone = () =>
    app.js<{ state: string; done: number; total: number; cursor: number; bytes: number; none: number; failed: number } | null>(
      `(async () => (await __bh.pwa.zones.list()).find((z) => z.name === ${JSON.stringify(ZONE.name)}) ?? null)()`,
    );
  // (the ground's detail on screen: the mean step of luminance between neighbouring pixels over a band of the valley's floor
  // ahead, under the HUD's ladder, above the cockpit — an orthophoto's fields and roofs high, a smooth shading low)
  const groundDetail = async () => {
    const { data } = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
    return app.js<number>(`(async () => {
      const b = await (await fetch("data:image/png;base64,${data}")).blob(), i = await createImageBitmap(b);
      const c = new OffscreenCanvas(i.width, i.height), g = c.getContext("2d"); g.drawImage(i, 0, 0);
      const x0 = Math.round(0.22 * i.width), x1 = Math.round(0.45 * i.width), y0 = Math.round(0.7 * i.height), y1 = Math.round(0.78 * i.height);
      const px = g.getImageData(x0, y0, x1 - x0, y1 - y0).data, w = x1 - x0;
      const L = (k) => 0.2126 * px[4 * k] + 0.7152 * px[4 * k + 1] + 0.0722 * px[4 * k + 2];
      let sum = 0, n = 0;
      for (let y = 0; y < y1 - y0; y++) for (let x = 1; x < w; x++) { sum += Math.abs(L(y * w + x) - L(y * w + x - 1)); n++; }
      return sum / n; })()`);
  };
  // (the flight: the date, a second for the clock, the jump — never in the same tick —; held while the ground there comes
  // in — its finest relief and orthophotos —, placed again on it — its 450 m measured over the valley's floor (to the
  // wheels: ~400 m to the ground under the centre), not over a coarse level's, nor the sea's with no tile in —, then flown
  // level at 120 m/s on the autopilot and the auto-throttle, engaged a frame after the thaw, in the cockpit; checked, or
  // the test stops there)
  const fly = async (label: "online" | "offline") => {
    await app.js(`(() => { __bh.game.setDate("2026-07-10T10:30:00Z"); return 1; })()`);
    await Bun.sleep(1000);
    const place = `__bh.game.flyAt(${START.lat}, ${START.lon}, 450, 45, 120); __bh.settings.shipMount = "cockpit";`;
    await app.js(`(() => { ${place} __bh.freeze(true); return 1; })()`);
    await Bun.sleep(1000);
    // (the ground's state said if it never comes: which of its levels, what it still waits for)
    const groundIn = `(() => { const t = __bh.renderer.earthTiles; return { finest: t.finest, orthoFinest: t.orthoFinest, pending: t.pending, orthoPending: t.orthoPending, tiles: window.__tiles ?? null }; })()`;
    const until = (cond: string, what: string) =>
      app.waitFor(`(() => { const t = __bh.renderer.earthTiles; return ${cond}; })()`, 120_000).catch(async (e) => {
        throw new Error(`${what} never came in: ${JSON.stringify(await app.js(groundIn))} — ${e}`);
      });
    // (the relief first — the placing's measure —, the orthophotos once placed on it: the levels wanted follow the height)
    await until("t.finest >= 14 && t.pending === 0", "the relief");
    const at = await app.js<{ alt: number; ground: number }>(`(() => { ${place} const g = __bh.camera.geoNow();
      return { alt: g.alt, ground: __bh.sys.groundAt(g.lat, g.lon) }; })()`);
    await until("t.orthoFinest >= 17 && t.orthoPending === 0 && t.pending === 0", "the orthophotos");
    expect(at.alt - at.ground).toBeGreaterThan(350);
    expect(at.alt - at.ground).toBeLessThan(500);
    // (the ground looked at, held still: every pixel shaded at the full scale, the raster armed again — a moving view is
    // drawn in the governor's blocks, a small GPU's may have given the raster up (tests/e2e/swisstopo.e2e.test.ts) —, its
    // detail measured, shot; the game's own settings back after)
    await app.js(
      `(() => { Object.assign(__bh.settings, { dynamicResolution: false, earthRasterShading: "every", earthRasterScale: 1, motionBlur: 0 }); __bh.renderer.rasterFellBack = false; return 1; })()`,
    );
    await app.settled();
    // (in the core, at the full scale: the orthophotos to z 18 — 0.4 m)
    await app
      .waitFor(`(() => { const t = __bh.renderer.earthTiles; return t.orthoFinest >= 18 && t.orthoPending === 0; })()`, 60_000)
      .catch(() => {});
    const orthoFinest = await app.js<number>(`__bh.renderer.earthTiles.orthoFinest`);
    // (the game paused — held, a frozen view is still drawn as a moving one, in the governor's blocks —: the view refining,
    // its detail measured until two in a row agree — a slow GPU's shading sweeps the frame for seconds)
    await app.js(`(__bh.game.pause(true), 1)`);
    await app.waitFor(`__bh.renderer.lastPhase !== "realtime"`, 20_000).catch(() => {});
    await Bun.sleep(2000);
    let detail = await groundDetail();
    for (let k = 0, t0 = Date.now(); k < 20 && Date.now() - t0 < 40_000; k++) {
      await Bun.sleep(2000);
      const d = await groundDetail();
      const steady = Math.abs(d - detail) < 0.05 * Math.max(d, detail);
      detail = d;
      if (steady) break;
    }
    const look = {
      pipe: await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`),
      phase: await app.js<string>(`__bh.renderer.lastPhase`),
      detail,
      orthoFinest,
    };
    expect(look.phase).not.toBe("realtime");
    expect(look.pipe).toBe("raster");
    if (shots) {
      await Bun.$`mkdir -p ${shots}`;
      await app.shot(`${shots}/zones-chamonix-${label}.png`);
    }
    await app.js(
      `(() => { Object.assign(__bh.settings, { earthRasterShading: "auto", dynamicResolution: true, earthRasterScale: 0.75, motionBlur: 0.5 }); __bh.game.pause(false); return 1; })()`,
    );
    await app.js(`(__bh.freeze(false), 1)`);
    await Bun.sleep(1500);
    const modes = await app.js<{ alt: number | null; spd: number | null }>(`(() => { const c = __bh.camera;
      if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
      if (c.jetModes.spd !== null) c.jetModes.spd = 120; return { alt: c.jetModes.alt, spd: c.jetModes.spd }; })()`);
    expect(modes.alt).not.toBeNull();
    expect(modes.spd).not.toBeNull();
    return { ...at, hold: modes.alt!, look };
  };
  // (the jet flying as asked: level on its hold, at its speed, over the floor)
  const flying = () =>
    app.js<{ alt: number; agl: number; gs: number; pitch: number }>(`(() => { const c = __bh.camera, g = c.geoNow();
      return { alt: g.alt, agl: g.alt - __bh.sys.groundAt(g.lat, g.lon), gs: g.gs, pitch: (c.attitudeNow().pitch * 180) / Math.PI }; })()`);

  test("Chamonix's valley: fetched ahead (paused, resumed), then flown low offline — its ground whole, the network asked nothing", async () => {
    // (parked at the flight's start meanwhile, held: the game's own tiles in first)
    await phase("Téléchargement de la zone (le jeu charge les siennes d'abord)");
    const online = await fly("online");
    console.log(`  online, the ground looked at (${online.look.pipe}, ${online.look.phase}): detail ${online.look.detail.toFixed(2)}`);
    await Bun.sleep(1500);
    await app.js(`(__bh.freeze(true), 1)`);
    const draw = `(() => { const t = __bh.renderer.earthTiles; return { loaded: t.loaded, failed: t.failed, orthoLoaded: t.orthoLoaded, imagery: t.imagery }; })()`;
    console.log(`  online, drawn: ${JSON.stringify(await app.js(draw))}`);
    const est = await app.js<{ chains: number; urls: number; bytes: number }>(`__bh.pwa.zones.estimate(${JSON.stringify(ZONE)})`);
    console.log(`  the zone: ${est.chains} chains, ${est.urls} URLs, ≈ ${(est.bytes / 1e6).toFixed(0)} MB`);
    const id = await app.js<string | null>(`__bh.pwa.zones.add(${JSON.stringify(ZONE)})`);
    expect(id).toBeTruthy();
    // (half-way: paused — nothing more asked for a while —, then resumed)
    await app.waitFor(
      `(async () => { const z = (await __bh.pwa.zones.list()).find((z) => z.id === ${JSON.stringify(id)}); return z && z.cursor > z.total / 2; })()`,
      600_000,
    );
    await app.js(`__bh.pwa.zones.pause(${JSON.stringify(id)})`);
    await phase("Pause : plus rien de demandé pendant 6 s");
    await Bun.sleep(3000);
    const p0 = await zone();
    await Bun.sleep(6000);
    const p1 = await zone();
    console.log(`  paused at ${p1?.cursor} / ${p1?.total} chains (${((p1?.bytes ?? 0) / 1e6).toFixed(0)} MB), state ${p1?.state}`);
    expect(p1?.state).toBe("paused");
    expect(p1?.cursor).toBe(p0?.cursor);
    await app.js(`__bh.pwa.zones.resume(${JSON.stringify(id)})`);
    await phase("Reprise du téléchargement");
    const t0 = Date.now();
    await app.waitFor(
      `(async () => { const z = (await __bh.pwa.zones.list()).find((z) => z.id === ${JSON.stringify(id)}); return z && (z.state === "ready" || (z.state === "paused" && z.cursor >= z.total)); })()`,
      900_000,
    );
    const z = await zone();
    console.log(
      `  ready in ${((Date.now() - t0) / 1000).toFixed(0)} s after the resume: ${z?.done} links in, ${z?.none} none, ${z?.failed} failed, ${((z?.bytes ?? 0) / 1e6).toFixed(0)} MB, state ${z?.state}`,
    );
    expect(z?.failed).toBe(0);
    // (only the zone's then: the tiles' own cache emptied, the network cut, the page loaded again — nothing in its memory —,
    // its tile responses counted from its first script: a zone's marked by the worker, any other the network's)
    await app.js(`__bh.pwa.clearTiles()`);
    const s0 = await app.js<{ zoneTiles: number; zoneBytes: number }>(`__bh.pwa.stats()`);
    console.log(`  the zones' cache: ${s0.zoneTiles} tiles, ${(s0.zoneBytes / 1e6).toFixed(0)} MB`);
    await app.cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => { const hosts = ["s3.amazonaws.com", "gibs.earthdata.nasa.gov", "tiles.maps.eox.at", "data.geopf.fr", "geo.admin.ch"];
        const f = window.fetch.bind(window); window.__tiles = { zone: 0, other: 0, failed: 0, finer: 0, others: [] };
        // (the finer than the profile's, z 18: counted with the others — the core's from the zone —, and apart)
        const finer = (url) => /ORTHOIMAGERY|swissimage/.test(url) && Number(url.match(/TILEMATRIX=(\\d+)/)?.[1] ?? url.match(/\\/(\\d+)\\/\\d+\\/\\d+\\.jpe?g/)?.[1]) > ${ORTHO_Z1};
        window.fetch = async (input, init) => { const url = String(input instanceof Request ? input.url : input);
          const tile = hosts.some((h) => url.includes(h));
          if (tile && finer(url)) window.__tiles.finer++;
          try { const r = await f(input, init); if (tile) { if (r.headers.get("x-kerr-zone") === "1") window.__tiles.zone++; else { window.__tiles.other++; if (window.__tiles.others.length < 8) window.__tiles.others.push(r.status + " " + url.slice(0, 240)); } } return r; }
          catch (e) { if (tile) { window.__tiles.failed++; if (window.__tiles.others.length < 8) window.__tiles.others.push("failed " + url.slice(0, 150)); } throw e; } }; })();`,
    });
    await app.cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await app.load("scene=game:artemis");
    // (the scene's settings again — the vessel is the scene's, not a preference kept)
    await app.js(`(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${SETTINGS}); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 120_000);
    await app.js(PROGRESS);
    // (counted from the jump: what the scene's start asked — far from the zone, the worker's own fetches not cut by the
    // page's emulation — left to come in and out of the count; then the ground's arrival and the flight, all of it)
    await app
      .waitFor(`(() => { const t = __bh.renderer.earthTiles; return t.pending === 0 && t.orthoPending === 0; })()`, 60_000)
      .catch(() => {});
    await Bun.sleep(2000);
    await app.js(`(() => { Object.assign(window.__tiles, { zone: 0, other: 0, failed: 0, finer: 0, others: [] }); return 1; })()`);
    await phase("Réseau coupé, page rechargée : vol bas dans la vallée");
    const at = await fly("offline");
    console.log(
      `  offline, the ground looked at (${at.look.pipe}, ${at.look.phase}): detail ${at.look.detail.toFixed(2)} (online ${online.look.detail.toFixed(2)})`,
    );
    console.log(
      `  placed at ${at.alt.toFixed(0)} m, ${(at.alt - at.ground).toFixed(0)} m over the floor; held at ${at.hold} m; orthophotos to z ${at.look.orthoFinest} (online ${online.look.orthoFinest}); navigator.onLine ${await app.js<boolean>("navigator.onLine")}`,
    );
    await Bun.sleep(5000);
    const f0 = await flying();
    expect(Math.abs(f0.pitch)).toBeLessThan(15);
    // (10 s more: 1.8 km flown from the start, out of the core at 1.4, still in the disc)
    await Bun.sleep(10_000);
    const f1 = await flying();
    console.log(
      `  flown: ${f1.alt.toFixed(0)} m (${f1.agl.toFixed(0)} m over the floor), ${f1.gs.toFixed(0)} m/s, pitch ${f1.pitch.toFixed(1)}°`,
    );
    expect(Math.abs(f1.alt - at.hold)).toBeLessThan(60);
    expect(f1.agl).toBeGreaterThan(300);
    expect(f1.gs).toBeGreaterThan(105);
    await app.js(`(__bh.freeze(true), 1)`);
    await app
      .waitFor(`(() => { const t = __bh.renderer.earthTiles; return t.pending === 0 && t.orthoPending === 0; })()`, 60_000)
      .catch(() => {});
    const seen = await app.js<{ zone: number; other: number; failed: number; finer: number; others: string[] }>(`window.__tiles`);
    const ground = await app.js<{ pending: number; ortho: number; finest: number; orthoFinest: number; pipe: string; d: number }>(
      `(() => { const t = __bh.renderer.earthTiles, g = __bh.camera.geoNow(); return { pending: t.pending, ortho: t.orthoPending, finest: t.finest, orthoFinest: t.orthoFinest, pipe: __bh.renderer.earthPipelineNow(__bh.settings), d: Math.hypot((g.lat - ${ZONE.lat}) * 111.2, (g.lon - ${ZONE.lon}) * 111.2 * Math.cos(${ZONE.lat * D})) }; })()`,
    );
    const net = seen.other + seen.failed;
    // (what was drawn of them: the tiles' loads, the orthophotos decoded — and one of the zone's decoded here, offline)
    const drawn = await app.js<{ loaded: number; failed: number; orthoLoaded: number; imagery: number }>(draw);
    const decode = await app.js<string>(
      `(async () => { try { const r = await fetch(${JSON.stringify(
        `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=17&TILEROW=${Math.floor(((1 - Math.asinh(Math.tan(ZONE.lat * D)) / Math.PI) / 2) * 2 ** 17)}&TILECOL=${Math.floor(((ZONE.lon + 180) / 360) * 2 ** 17)}&FORMAT=image/jpeg`,
      )}); const b = await r.blob(); const i = await createImageBitmap(b); return r.status + " " + r.headers.get("x-kerr-zone") + " " + b.type + " " + b.size + " B " + i.width + "×" + i.height; } catch (e) { return "error " + e; } })()`,
    );
    console.log(`  offline, drawn: ${JSON.stringify(drawn)}; a zone's orthophoto decoded: ${decode}`);
    console.log(
      `  offline, loaded again and flown up the valley: ${seen.zone} tiles from the zone, ${seen.other} from elsewhere, ${seen.failed} failed, ${seen.finer} of them orthophotos finer than the profile's (z > ${ORTHO_Z1}: the core's)${seen.others.length ? ` (${seen.others.join(" · ")})` : ""}; at the end ${ground.d.toFixed(2)} km from the centre (out of the core): ground pending ${ground.pending} (orthophotos ${ground.ortho}), levels to z ${ground.finest}, orthophotos to z ${ground.orthoFinest}, ${ground.pipe}, pitch ${f1.pitch.toFixed(1)}°`,
    );
    await phase(
      `Hors ligne : ${seen.zone} tuiles de la zone (dont ${seen.finer} du cœur, z 18), ${net} du réseau — sol complet : ${ground.pending === 0 ? "oui" : "non"}`,
    );
    await app.cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    expect(seen.zone).toBeGreaterThan(100);
    // (the zone's imagery drawn, not only loaded: the ground as detailed as online)
    expect(at.look.detail).toBeGreaterThan(0.6 * online.look.detail);
    expect(net).toBe(0);
    expect(ground.pending).toBe(0);
    expect(ground.ortho).toBe(0);
    // (the core's z 18 drawn, from the zone; past it, the profile's z 17 — none finer asked)
    expect(at.look.orthoFinest).toBeGreaterThanOrEqual(18);
    expect(seen.finer).toBeGreaterThan(0);
    expect(ground.d).toBeGreaterThan(ZONE.coreKm);
    expect(ground.orthoFinest).toBe(17);
    // (dropped: its tiles gone with it)
    await app.js(`__bh.pwa.zones.remove(${JSON.stringify(id)})`);
    await phase("Zone supprimée");
    const s2 = await app.js<{ zoneTiles: number }>(`__bh.pwa.stats()`);
    expect(s2.zoneTiles).toBe(0);
    expect(await zone()).toBeNull();
  }, 1_200_000);
});
