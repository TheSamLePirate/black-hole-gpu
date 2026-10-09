import { afterAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

const scene = `scene=${encodeURIComponent("Kerr a=0.94, near edge-on")}`;
const options = `{ width: 16, height: 16, spp: 1, tolerance: 1e-3, eps: 0.1, maxSteps: 1000,
  noiseThreshold: 0, minSpp: 1, shutter: 0, budgetMs: 20 }`;

function fault(entry: "main" | "lut") {
  return `(() => {
    const original = GPUDevice.prototype.createComputePipelineAsync;
    globalThis.__faults = 0;
    GPUDevice.prototype.createComputePipelineAsync = function(desc) {
      if (desc.compute.entryPoint === ${JSON.stringify(entry)} && desc.compute.constants?.QUALITY_PIPELINE === 1) {
        globalThis.__faults++;
        return Promise.reject(new Error("Injected optional compile failure"));
      }
      return original.call(this, desc);
    };
  })()`;
}

describe.skipIf(!E2E)("WebGPU startup and quality failures", () => {
  afterAll(stopServer);

  // (PLAN-MONDE M9: an adapter binding 8 storage buffers a stage — WebGPU's default, a part of Android and
  // Safari — no longer a startup failure: it starts, and draws)
  test("an adapter of 8 storage buffers a stage: the device at WebGPU's default, the tracer drawing, no GPU error", async () => {
    const app = await App.boot({
      hash: scene,
      width: 320,
      height: 240,
      initScript: `(() => {
        const original = GPUAdapter.prototype.requestDevice;
        GPUAdapter.prototype.requestDevice = function (desc) {
          globalThis.__asked = desc?.requiredLimits?.maxStorageBuffersPerShaderStage ?? null;
          return original.call(this, desc);
        };
      })()`,
    });
    try {
      await app.waitFor("__bh.gpu.frames().completedFrames > 30", 60_000);
      const seen = await app.js<{ asked: number | null; limit: number; errors: number; lost: string | null }>(
        `({ asked: globalThis.__asked, limit: __bh.renderer.device.limits.maxStorageBuffersPerShaderStage, errors: __bh.renderer.gpuErrors, lost: __bh.renderer.lost })`,
      );
      expect(seen.asked === null || seen.asked <= 8).toBe(true);
      expect(seen.limit).toBe(8);
      expect(seen.errors).toBe(0);
      expect(seen.lost).toBeNull();
    } finally {
      app.close();
    }
  }, 120_000);

  for (const failure of ["adapter", "pipeline"] as const) {
    test(`${failure} startup failure exposes a downloadable diagnostic with the failing stage`, async () => {
      const initScript =
        failure === "adapter"
          ? `navigator.gpu.requestAdapter = async () => null;`
          : `GPUDevice.prototype.createComputePipelineAsync = function() { return Promise.reject(new Error("Injected core compilation failure")); };`;
      const app = await App.boot({ hash: scene, width: 320, height: 240, initScript, startupFailure: true });
      try {
        const report = await app.js<{ status: string; stage: string; events: { message: string }[] }>(
          `JSON.parse(localStorage.getItem("kerr.gpu-diagnostic.v1"))`,
        );
        expect(report.status).toBe("failed");
        expect(report.stage).toBe(failure === "pipeline" ? "core-pipeline-compilation" : "adapter-request");
        expect(
          report.events.some((event) =>
            event.message.includes(failure === "adapter" ? "No WebGPU adapter" : "Injected core compilation failure"),
          ),
        ).toBe(true);
        expect(
          await app.js<boolean>(
            `[...document.querySelectorAll("#error button")].some((button) => button.textContent.includes("diagnostic"))`,
          ),
        ).toBe(true);
      } finally {
        app.close();
      }
    }, 300_000);
  }

  test("a stalled core compilation terminates with a diagnostic instead of an endless splash", async () => {
    const app = await App.boot({
      hash: scene,
      startupFailure: true,
      initScript: `(() => {
      const original = globalThis.setTimeout;
      globalThis.setTimeout = (fn, ms, ...args) => original(fn, ms === 180000 ? 1500 : ms, ...args);
      GPUDevice.prototype.createComputePipelineAsync = () => new Promise(() => {});
    })()`,
    });
    try {
      const report = await app.js<{ status: string; events: { message: string }[] }>(
        `JSON.parse(localStorage.getItem("kerr.gpu-diagnostic.v1"))`,
      );
      expect(report.status).toBe("failed");
      expect(report.events.some((event) => event.message.includes("Graphics startup timed out"))).toBe(true);
    } finally {
      app.close();
    }
  }, 300_000);

  // (the general kernel — every feature compiled in, minutes on D3D12 — is no longer what the first image
  // waits for: the scene's specialised kernel draws it, the general one compiling after it)
  test("the first image waits for the scene's own kernel, not the general one", async () => {
    const app = await App.boot({
      hash: scene,
      width: 320,
      height: 240,
      initScript: `(() => {
      const original = GPUDevice.prototype.createComputePipelineAsync;
      globalThis.__general = 0;
      GPUDevice.prototype.createComputePipelineAsync = function(desc) {
        const c = desc.compute.constants ?? {};
        if ((desc.compute.entryPoint === "main" || desc.compute.entryPoint === "env") && !("HAS_RADIO" in c)) {
          globalThis.__general++;
          return new Promise(() => {});
        }
        return original.call(this, desc);
      };
    })()`,
    });
    try {
      await app.waitFor("globalThis.__general === 2", 60_000);
      const seen = await app.js<{ first: number; general: number; status: string; compiled: string[] }>(`(() => {
        const d = __bh.graphicsDiagnostic();
        return { first: __bh.renderer.firstFrameDoneAt, general: globalThis.__general, status: __bh.renderer.pipelineStatus.general,
          compiled: d.events.filter((e) => e.kind === "pipeline-compiled").map((e) => e.message) };
      })()`);
      expect(seen.first).toBeGreaterThan(0);
      // (asked for after the scene's kernel and its probe, and still compiling: not waited for)
      expect(seen.general).toBe(2);
      expect(seen.status).toBe("pending");
      expect(seen.compiled.some((m) => m.startsWith("tracer main"))).toBe(true);
    } finally {
      app.close();
    }
  }, 300_000);

  // (the still view refines on the scene's own quality kernel: the general one — every feature, 5 min on
  // an RX 5700 XT — is not waited for)
  test("a still view converges without the general quality kernel", async () => {
    const app = await App.boot({
      hash: scene,
      width: 320,
      height: 240,
      initScript: `(() => {
      const original = GPUDevice.prototype.createComputePipelineAsync;
      GPUDevice.prototype.createComputePipelineAsync = function(desc) {
        const c = desc.compute.constants ?? {};
        if (c.QUALITY_PIPELINE === 1 && !("HAS_RADIO" in c)) return new Promise(() => {});
        return original.call(this, desc);
      };
    })()`,
    });
    try {
      await app.js("(__bh.freeze(true), (__bh.settings.adaptiveIntegrator = true), __bh.touch(), true)");
      await app.waitFor("__bh.renderer.sampleIndex > 0", 120_000);
      expect(await app.js<boolean>("__bh.settings.adaptiveIntegrator")).toBe(true);
      expect(await app.js<string | null>("__bh.renderer.pipelineStatus.quality")).not.toBe("ready");
    } finally {
      app.close();
    }
  }, 300_000);

  // (Windows/D3D12: the general kernel minutes away, each specialised one long — a scene changed then
  // was left on the first scene's image, its compiles queued behind the first scene's remaining ones)
  test("a scene change before the general kernel: the new scene's kernel next, the old one's skipped, said meanwhile", async () => {
    const app = await App.boot({
      hash: scene,
      width: 320,
      height: 240,
      initScript: `(() => {
      const original = GPUDevice.prototype.createComputePipelineAsync;
      const BITS = ["HAS_RADIO", "HAS_POL", "HAS_JET", "HAS_SPOT", "HAS_VOL", "HAS_WH", "HAS_THICK", "HAS_BODIES", "HAS_RWY", "HAS_KERR", "HAS_WX"];
      globalThis.__compiles = [];
      GPUDevice.prototype.createComputePipelineAsync = function(desc) {
        const c = desc.compute.constants ?? {};
        const entry = desc.compute.entryPoint;
        if (entry === "main" || entry === "env" || entry === "lut") {
          if (!("HAS_RADIO" in c)) return new Promise(() => {});
          const key = BITS.reduce((k, b, i) => k | (c[b] ? 1 << i : 0), 0);
          __compiles.push({ at: performance.now(), key, entry, q: c.QUALITY_PIPELINE === 1 });
          return new Promise((r) => setTimeout(r, 3000)).then(() => original.call(this, desc));
        }
        return original.call(this, desc);
      };
    })()`,
    });
    try {
      const first = await app.js<number>("__bh.renderer.cameraKey");
      const switchedAt = await app.js<number>(
        `(__bh.preset("Interstellar: the Endurance before Gargantua"), __bh.touch(), performance.now())`,
      );
      let pill = false;
      const t0 = Date.now();
      for (;;) {
        const s = await app.js<{ key: number; rt: boolean; shown: boolean }>(
          "({ key: __bh.renderer.cameraKey, rt: !!__bh.renderer.variants.get(__bh.renderer.cameraKey)?.rt, shown: __bh.renderer.sceneTracerShown })",
        );
        pill ||= s.shown;
        if (s.key !== first && s.rt && !s.shown) break;
        if (Date.now() - t0 > 60_000) throw new Error(`the new scene never drawn: ${JSON.stringify(s)}`);
        await new Promise((r) => setTimeout(r, 250));
      }
      expect(pill).toBe(true);
      // (the first scene's compiles not started after the change — one already running finishes)
      const late = await app.js<number>(`__compiles.filter((c) => c.key === ${first} && c.at > ${switchedAt} + 50).length`);
      expect(late).toBe(0);
    } finally {
      app.close();
    }
  }, 300_000);

  test("device loss during initialization is reported even before runtime callbacks exist", async () => {
    const app = await App.boot({
      hash: scene,
      startupFailure: true,
      initScript: `(() => {
      const original = GPUAdapter.prototype.requestDevice;
      GPUAdapter.prototype.requestDevice = async function(options) {
        const device = await original.call(this, options);
        device.destroy();
        return device;
      };
    })()`,
    });
    try {
      const report = await app.js<{ status: string; events: { kind: string; message: string }[] }>(
        `JSON.parse(localStorage.getItem("kerr.gpu-diagnostic.v1"))`,
      );
      expect(report.status).toBe("failed");
      expect(report.events.some((event) => event.message.includes("GPU lost during startup"))).toBe(true);
      expect(report.events.some((event) => event.kind === "device-lost:destroyed")).toBe(true);
    } finally {
      app.close();
    }
  }, 300_000);

  test("an error thrown after the first frame leaves the loop running", async () => {
    const app = await App.boot({ hash: scene, width: 320, height: 240 });
    try {
      const before = await app.js<number>(`(() => {
        setTimeout(() => { throw new Error("Injected error after the first image"); });
        void Promise.reject(new Error("Injected rejection after the first image"));
        return __bh.renderer.completedFrames;
      })()`);
      await app.waitFor(`__bh.graphicsDiagnostic().events.filter((event) => event.message.includes("after the first image")).length === 2`);
      // (the loop still turning: a change drawn again, frame after frame)
      for (let i = 0; i < 5; i++) {
        const done = await app.js<number>("(__bh.touch(), __bh.renderer.completedFrames)");
        await app.waitFor(`__bh.renderer.completedFrames > ${done}`);
      }
      expect(await app.js<number>("__bh.renderer.completedFrames")).toBeGreaterThan(before + 4);
      const report = await app.js<{ status: string; events: { kind: string }[] }>("__bh.graphicsDiagnostic()");
      expect(report.status).toBe("running");
      expect(report.events.map((event) => event.kind)).toEqual(expect.arrayContaining(["javascript-error", "unhandled-rejection"]));
      expect(await app.js<boolean>(`document.getElementById("error").hidden`)).toBe(true);
    } finally {
      app.close();
    }
  }, 300_000);

  test("the quality LUT starts compiling as the quality kernel lands, no frame needed", async () => {
    const app = await App.boot({
      hash: scene,
      width: 320,
      height: 240,
      initScript: `(() => {
      const original = GPUDevice.prototype.createComputePipelineAsync;
      let release;
      const gate = new Promise((resolve) => (release = resolve));
      globalThis.__releaseQuality = () => release();
      GPUDevice.prototype.createComputePipelineAsync = function(desc) {
        if (desc.compute.entryPoint === "main" && desc.compute.constants?.QUALITY_PIPELINE === 1)
          return gate.then(() => original.call(this, desc));
        return original.call(this, desc);
      };
    })()`,
    });
    try {
      // (a still view the far field's LUT serves: time held, no jet)
      await app.js("(__bh.freeze(true), (__bh.settings.jet = false), __bh.touch(), true)");
      await app.waitFor(`__bh.renderer.qualityCompile.state === "pending" && __bh.renderer.lutWanted`, 30_000);
      // (no frame submitted from here: a converged view draws none)
      const lutQuality = await app.js<string>(`(async () => {
        const renderer = __bh.renderer;
        renderer.frame = () => null;
        __releaseQuality();
        await renderer.qualityCompile.start();
        return renderer.lutQCompile.state;
      })()`);
      expect(lutQuality).not.toBe("idle");
    } finally {
      app.close();
    }
  }, 300_000);

  test("failed quality LUT leaves the adaptive kernel and a PNG export usable", async () => {
    const app = await App.boot({ hash: scene, width: 320, height: 240, initScript: fault("lut") });
    try {
      expect(await app.js<boolean>("__bh.renderer.firstFrameDoneAt > 0")).toBe(true);
      await app.js(`(async () => {
        __bh.freeze(true);
        await Promise.all([__bh.renderer.qualityCompile.start(), __bh.renderer.lutQCompile.start()]);
        __bh.renderer.startOffline(__bh.settings, __bh.time(), ${options});
        return true;
      })()`);
      await app.waitFor("__bh.renderer.offlineState?.done || __bh.renderer.offlineState?.error", 120_000);
      expect(await app.js<string>("__bh.renderer.pipelineStatus.lutQuality")).toBe("failed");
      expect(await app.js<string>("__bh.renderer.pipelineStatus.quality")).toBe("ready");
      expect(await app.js<boolean>(`__bh.graphicsDiagnostic().events.some((event) => event.kind === "optional-pipeline-failure")`)).toBe(
        true,
      );
      expect(await app.js<string | null>("__bh.renderer.offlineState.error ?? null")).toBeNull();
      expect(await app.js<boolean>("__bh.renderer.offlineState.done")).toBe(true);
      expect(await app.js<number>("(await __bh.renderer.exportPNG(__bh.settings)).size")).toBeGreaterThan(100);
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  }, 300_000);

  test("failed adaptive kernel: the still view and the adaptive export converge on fixed steps", async () => {
    const app = await App.boot({ hash: scene, width: 320, height: 240, initScript: fault("main") });
    try {
      // (the live still view: refining on the fixed-step kernel, not drawing realtime frames for ever)
      await app.js("(__bh.freeze(true), __bh.touch(), true)");
      await app.waitFor(`__bh.renderer.pipelineStatus.quality === "failed"`, 30_000);
      await app.waitFor(`["converging", "converged"].includes(__bh.renderer.lastPhase)`, 30_000);
      expect(await app.js<string>("__bh.renderer.liveQualityError")).toContain("Injected optional compile failure");
      await app.js(`(__bh.renderer.startOffline(__bh.settings, __bh.time(), ${options}), true)`);
      await app.waitFor("__bh.renderer.offlineState?.done || __bh.renderer.offlineState?.error", 120_000);
      expect(await app.js<string | null>("__bh.renderer.offlineState.error ?? null")).toBeNull();
      expect(await app.js<boolean>("__bh.renderer.offlineState.done")).toBe(true);
      expect(await app.js<string>("__bh.renderer.offline.fixedSteps")).toContain("Injected optional compile failure");
      expect(await app.js<number>("(await __bh.renderer.exportPNG(__bh.settings)).size")).toBeGreaterThan(100);
      // (a video failing midway leaves the live view as it was)
      const videoFailure = await app.js<{
        message: string;
        active: boolean;
        rateRestored: boolean;
        scripted: boolean;
      } | null>(`(async () => {
        const rate = __bh.settings.timeSpeed;
        __bh.renderer.exportRGBA = async () => { throw new Error("Injected export failure"); };
        try { await __bh.video("injected-failure", { ...${options}, seconds: 1, fps: 1, rate: rate + 1 }); }
        catch (error) { return { message: error.message, active: __bh.renderer.offlineActive,
          rateRestored: __bh.settings.timeSpeed === rate, scripted: __bh.camera.scripted }; }
        finally { delete __bh.renderer.exportRGBA; }
        return null;
      })()`);
      expect(videoFailure).toEqual({
        message: "Injected export failure",
        active: false,
        rateRestored: true,
        scripted: false,
      });
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  }, 300_000);

  test("variants retain the most recently used scene (A, B, A, C)", async () => {
    const app = await App.boot({
      hash: scene,
      width: 320,
      height: 240,
      initScript: `(() => {
      globalThis.__prematureOptional = false;
      const original = GPUDevice.prototype.createComputePipelineAsync;
      GPUDevice.prototype.createComputePipelineAsync = function(desc) {
        const optional = desc.compute.entryPoint === "lut" ||
          (desc.compute.entryPoint === "main" && desc.compute.constants?.QUALITY_PIPELINE === 1);
        if (optional && !globalThis.__bh?.renderer?.firstFrameDoneAt) globalThis.__prematureOptional = true;
        return original.call(this, desc);
      };
    })()`,
    });
    try {
      const result = await app.js<number[]>(`(() => {
        const renderer = Object.create(__bh.renderer);
        renderer.variants = new Map();
        renderer.completedFrames = 1;
        renderer.variantQueue = { run: async (current, compile) => current() ? compile() : null };
        renderer.mkVariant = async () => null;
        for (const key of [1, 2, 1, 4]) { renderer.featureKey = key; renderer.traceVariant("rt"); }
        return [...renderer.variants.keys()];
      })()`);
      const integration = await app.js<{
        moving: { captured: { steps: number; eps: number } };
        still: { captured: { sampleIndex: number } };
        auto: { stats: { phase: string; targetSpp: number } };
      }>(`(() => {
        const source = __bh.renderer;
        const manual = { ...__bh.settings, quality: "ultra", dynamicResolution: false,
          realtimeSubsampling: 1, adaptiveIntegrator: false, realtimeSteps: 1000,
          realtimeEps: 0.05, targetSpp: 256, noiseThreshold: 0, temporalReprojection: false };
        const capture = (settings, sampleIndex, changed) => {
          const renderer = Object.assign(Object.create(source), {
            tier: { level: 1, capMpx: 0.9, label: "test" }, inFlight: 0, offline: null, lost: null,
            livePol: !!settings.polarization, sampleIndex, lastPhase: "converged", chartDirty: false,
            configureOutput() {}, probePlanets() {}, prof: { begin() {} },
            device: { createCommandEncoder() { return { clearBuffer() {} }; } },
          });
          let captured = null;
          renderer.writeParams = (_target, _settings, _time, params) => { captured = params; throw new Error("captured"); };
          let stats = null;
          try { stats = renderer.frame(settings, 0, changed, false, false); }
          catch (error) { if (error.message !== "captured") throw error; }
          return { captured, stats };
        };
        return { moving: capture(manual, 0, true), still: capture(manual, 16, false),
          // (the Game preset's 32 spp, capped to 16 on tier 1 — a value set by hand would be kept)
          auto: capture({ ...manual, quality: "game", dynamicResolution: true, realtimeSubsampling: "auto", targetSpp: 32 }, 16, false) };
      })()`);
      expect(integration.moving.captured.steps).toBe(1000);
      expect(integration.moving.captured.eps).toBe(0.05);
      expect(integration.still.captured.sampleIndex).toBe(16);
      expect(integration.auto.stats.phase).toBe("converged");
      expect(integration.auto.stats.targetSpp).toBe(16);
      expect(result).toEqual([1, 4]);
      expect(await app.js<boolean>("__prematureOptional")).toBe(false);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  }, 300_000);
  test("Earth caps are final for live automatic requests and absent for offline requests", async () => {
    const app = await App.boot({ hash: `scene=${encodeURIComponent("Earth: low orbit over the Amazon")}`, width: 640, height: 480 });
    try {
      const requested = await app.js<{ followedShip: string; export: string }>(`(() => {
        const source = __bh.renderer;
        const settings = { ...__bh.camera.viewSettings(), quality: "game", dynamicResolution: true, realtimeSubsampling: "auto" };
        const run = (focus, offline) => {
          const renderer = Object.assign(Object.create(source), { tier: { level: 1, capMpx: 0.9, label: "test" },
            shipFocus: focus, earthWant: null, earthCap: "high",
            requestEarthMaps(tier) { this.earthWant = tier; }, releaseEarthMaps() { this.earthWant = null; } });
          const target = offline ? { ...source.live, width: 2048, height: 2048 } : source.live;
          renderer.writeParams(target, settings, __bh.time(), { block: 1, eps: 0.03, steps: 100,
            y0: 0, y1: target.height, accumulate: false, sampleIndex: 0, flags: 0 });
          return renderer.earthWant;
        };
        return { followedShip: run({ body: "earth", altKm: 400 }, false), export: run(null, true) };
      })()`);
      expect(requested).toEqual({ followedShip: "med", export: "high" });
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  }, 300_000);
  // (M3: after the first image, not before it — its critical path first; ~3 s after, warmed for a later Earth scene)
  test("Earth downloads begin soon after the first image even in a Kerr scene with no Earth", async () => {
    const app = await App.boot({
      hash: scene,
      width: 320,
      height: 240,
      initScript: `(() => {
      globalThis.__earthWarmRequests = [];
      const original = globalThis.fetch;
      globalThis.fetch = function(input, options) {
        const record = options?.cache === "force-cache" ? {
          url: String(input), beforeImage: !globalThis.__bh?.renderer?.firstFrameDoneAt, ok: null,
        } : null;
        if (record) globalThis.__earthWarmRequests.push(record);
        const result = original.call(this, input, options);
        if (record) void result.then((response) => { record.ok = response.ok; }, () => { record.ok = false; });
        return result;
      };
    })()`,
    });
    try {
      await app.waitFor("__earthWarmRequests.length > 0 && __earthWarmRequests.every((request) => request.ok !== null)", 20_000);
      const state = await app.js<{
        requests: { url: string; beforeImage: boolean; ok: boolean }[];
        resident: string | null;
        earthInScene: boolean;
      }>(`({
        requests: __earthWarmRequests, resident: __bh.renderer.earthMaps.tier,
        earthInScene: __bh.renderer.lastBodies.some((body) => body.id === "earth"),
      })`);
      expect(state.earthInScene).toBe(false);
      expect(state.resident).toBeNull();
      expect(state.requests.length).toBeGreaterThanOrEqual(14);
      expect(state.requests.every((request) => !request.beforeImage)).toBe(true);
      expect(state.requests.every((request) => request.ok)).toBe(true);
      expect(state.requests.some((request) => /med-.*\.ktx2|day-med/.test(request.url))).toBe(true);
      expect(state.requests.some((request) => request.url.includes("relief-med"))).toBe(true);
      expect(state.requests.some((request) => request.url.includes("ocean-med"))).toBe(true);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  }, 300_000);
});
