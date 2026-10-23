import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { loadHeights } from "../../src/system/heights-file";
import { geoidN } from "../../src/system/geoid-grid";

// The geoid (docs/ANALYSE-IGN-LIDAR.md I0, src/system/geoid.ts): the sea's surface at EGM2008's N over the WGS84
// ellipsoid, the ground its height above the sea plus N — the tracer's table read as the CPU reads it, the ground
// stood on over the open sea at N, Paris's streets some 35 m above the sea, so ~80 m over the ellipsoid; then the
// F-35 low over the sea off Toulon (N ≈ +49 m) in its cockpit, the altimeter over the sea. (E2E_SHOTS=<dir>: the view.)
// Duration: ~3 min on kerr-mini.
// Done when: the F-35 holds 150 m over the sea off Toulon on its autopilot (and its cockpit is shot).

const trace = await Bun.file(new URL("../../src/shaders/trace.wgsl", import.meta.url)).text();
const fn = (name: string) => {
  const start = trace.indexOf(`fn ${name}(`);
  let end = trace.indexOf("{", start),
    depth = 1;
  while (depth && ++end < trace.length) {
    if (trace[end] === "{") depth++;
    if (trace[end] === "}") depth--;
  }
  return trace.slice(start, end + 1);
};
const constLine = (name: string) => new RegExp(`^const ${name}\\b[^;]*;`, "m").exec(trace)![0];
const grid = await loadHeights(
  "geoid",
  async () => new Response(Bun.file(new URL("../../assets/earth/geoid-egm2008-15.bin", import.meta.url))),
);

describe.skipIf(!E2E)("the geoid", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.waitFor(`__bh.sys.geoid(48.85, 2.35) > 40`, 120_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the tracer's table: its N as the CPU's, to the centimetre, anywhere (poles and date line too)", async () => {
    const D = Math.PI / 180;
    const pts: [number, number][] = [
      [48.8566, 2.3522],
      [45.9237, 6.8694],
      [28.5729, -80.649],
      [6.93, 79.85],
      [-5, 145],
      [89.99, 10],
      [-89.99, -170],
      [10, 179.999],
      [10, -179.999],
      [0, 0],
    ];
    for (let k = 0; k < 40; k++) pts.push([Math.asin(2 * ((k * 0.6180339887) % 1) - 1) / D, ((k * 137.508) % 360) - 180]);
    const dirs = pts.map(([la, lo]) => [Math.cos(la * D) * Math.cos(lo * D), Math.cos(la * D) * Math.sin(lo * D), Math.sin(la * D)]);
    const shader = `
      ${["GEOID_OFF", "GEOID_W", "GEOID_H", "PI", "TAU"].map(constLine).join("\n")}
      @group(0) @binding(0) var<storage, read> bodies: array<vec4f>;
      @group(0) @binding(1) var<storage, read_write> out: array<f32>;
      ${fn("geoidNode")}
      ${fn("geoidN")}
      const Q = array<vec3f, ${dirs.length}>(${dirs.map((d) => `vec3f(${d.join(",")})`).join(",")});
      @compute @workgroup_size(1) fn check(@builtin(global_invocation_id) id: vec3u) { out[id.x] = geoidN(Q[id.x]); }`;
    const n = dirs.length;
    const gpu = await app.js<number[]>(`(async () => {
      const device = __bh.renderer.device; device.pushErrorScope("validation");
      const pipeline = await device.createComputePipelineAsync({ layout: "auto", compute: { module: device.createShaderModule({ code: ${JSON.stringify(shader)} }), entryPoint: "check" } });
      const out = device.createBuffer({ size: ${n * 4}, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const read = device.createBuffer({ size: ${n * 4}, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      try {
        const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: __bh.renderer.bodyBuf } }, { binding: 1, resource: { buffer: out } }] });
        const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
        pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(${n}); pass.end();
        enc.copyBufferToBuffer(out, 0, read, 0, ${n * 4}); device.queue.submit([enc.finish()]); await read.mapAsync(GPUMapMode.READ);
        const v = [...new Float32Array(read.getMappedRange())]; read.unmap();
        const error = await device.popErrorScope(); if (error) throw new Error(error.message); return v;
      } finally { out.destroy(); read.destroy(); }
    })()`);
    const cpu = await app.js<number[]>(`${JSON.stringify(pts)}.map(([la, lo]) => __bh.sys.geoid(la, lo))`);
    let worst = 0;
    for (let k = 0; k < n; k++) {
      const local = geoidN(pts[k]![0] * D, pts[k]![1] * D, grid);
      expect(Math.abs(cpu[k]! - local)).toBeLessThan(1e-6);
      worst = Math.max(worst, Math.abs(gpu[k]! - cpu[k]!));
    }
    console.log(
      `  ${n} places: GPU − CPU ${(worst * 100).toFixed(2)} cm at worst; Paris ${cpu[0]!.toFixed(2)} m, Kennedy ${cpu[2]!.toFixed(2)} m`,
    );
    expect(worst).toBeLessThan(0.02);
    expect(app.cdp.errors).toEqual([]);
  }, 120_000);

  test("the ground stood on: the open sea at N, Paris some 35 m above the sea", async () => {
    // (the tiles of each place in: flown over it a moment, the relief settled)
    const at = async (lat: number, lon: number) => {
      await app.js(`(() => { __bh.game.flyAt(${lat}, ${lon}, 800, 90, 120); return 1; })()`);
      await app.waitFor(`__bh.renderer.earthTiles.pending === 0`, 60_000).catch(() => {});
      await Bun.sleep(1500);
      return app.js<{ g: number; n: number }>(`({ g: __bh.sys.groundAt(${lat}, ${lon}), n: __bh.sys.geoid(${lat}, ${lon}) })`);
    };
    const sea = await at(42.6, 6.0); // off Toulon
    const ocean = await at(28.3, -80.3); // off Cape Canaveral
    const paris = await at(48.8606, 2.3376); // the Louvre's courtyard
    console.log(
      `  off Toulon ground ${sea.g.toFixed(2)} m (N ${sea.n.toFixed(2)}) · off Kennedy ${ocean.g.toFixed(2)} m (N ${ocean.n.toFixed(2)}) · Paris ${paris.g.toFixed(1)} m over the ellipsoid, ${(paris.g - paris.n).toFixed(1)} m above the sea`,
    );
    expect(Math.abs(sea.g - sea.n)).toBeLessThan(0.5);
    expect(sea.n).toBeGreaterThan(45);
    expect(Math.abs(ocean.g - ocean.n)).toBeLessThan(0.5);
    expect(ocean.n).toBeLessThan(-25);
    expect(paris.g - paris.n).toBeGreaterThan(25);
    expect(paris.g - paris.n).toBeLessThan(50);
  }, 240_000);

  test("low over the sea off Toulon, in the cockpit: 150 m on the altimeter, the sea 150 m below", async () => {
    await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { __bh.game.setDate("2026-07-10T16:30:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0 });
      __bh.game.flyAt(42.6, 6.0, 150, 20, 150); __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await Bun.sleep(1500);
    await app.js(`(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); return 1; })()`);
    await Bun.sleep(6000);
    const r = await app.js<{ alt: number; n: number }>(
      `(() => { const g = __bh.camera.geoNow(); return { alt: g.alt, n: __bh.sys.geoid(g.lat, g.lon) }; })()`,
    );
    console.log(`  altitude over the sea ${r.alt.toFixed(1)} m · N ${r.n.toFixed(1)} m`);
    // (the altitude held over the sea, not over the ellipsoid: 49 m apart here)
    expect(Math.abs(r.alt - 150)).toBeLessThan(25);
    if (shots) {
      await Bun.$`mkdir -p ${shots}`;
      await app.js(`(__bh.freeze(true), 1)`);
      await Bun.sleep(1200);
      await app.shot(`${shots}/geoid-sea-toulon.png`);
      await app.js(`(__bh.freeze(false), 1)`);
    }
  }, 120_000);
});
