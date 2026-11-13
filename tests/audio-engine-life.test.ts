import { afterAll, expect, test } from "bun:test";

// The sound engine's life (audit 2026-11-10, TA-24): its meters read into kept buffers (TARS's orb reads the voice bus every
// frame he speaks), the rocket's worklet with no object made per 128-sample block, a context Safari left "interrupted"
// (a call, another app's audio) started again like a suspended one.

// (the engine's module makes its engine on import: a page's document stood in for)
// (and taken back after: the other files of a suite see no page — docs/E2E.md, test-state leaks)
const G = globalThis as unknown as Record<string, unknown>;
const stood = ["document", "addEventListener", "sampleRate", "AudioWorkletProcessor", "registerProcessor"].filter((k) => !(k in G));
G.document ??= { hidden: false, addEventListener: () => {} };
G.addEventListener ??= () => {};
// (the worklet's scope: its processors kept by name as the module registers them, once)
type Proc = new () => { port: { postMessage(m: unknown): void }; process(i: unknown, o?: unknown, p?: unknown): boolean };
const procs = new Map<string, Proc>();
G.sampleRate = 48_000;
G.AudioWorkletProcessor = class {
  port = { postMessage: (_m: unknown) => {} };
};
G.registerProcessor = (n: string, C: Proc) => void procs.set(n, C);
afterAll(() => {
  for (const k of stood) delete G[k];
});

/** an analyser that keeps the buffers it was handed */
const analyser = (seen: Float32Array[]) =>
  ({ fftSize: 256, getFloatTimeDomainData: (d: Float32Array) => (seen.push(d), d.fill(0.1)) }) as unknown as AnalyserNode;

test("the meters read into kept buffers, not one made per reading", async () => {
  const { SoundEngine } = await import("../src/audio/engine");
  const e = Object.create(SoundEngine.prototype) as InstanceType<typeof SoundEngine>;
  const seen: Float32Array[] = [];
  const E = e as unknown as { meter: AnalyserNode; busMeters: Record<string, AnalyserNode> };
  E.meter = analyser(seen);
  E.busMeters = { voice: analyser(seen), engine: analyser(seen) };
  const a = e.busLevels();
  const n = seen.length;
  e.busLevels();
  expect(a.voice).toBeCloseTo(-20, 0);
  // the second reading's buffers are the first's
  const first = new Set(seen.slice(0, n));
  expect(seen.slice(n).every((d) => first.has(d))).toBe(true);
});

test("the rocket's worklet: no object made per block", async () => {
  await import("../src/audio/engine-worklet");
  const p = new (
    procs.get("kerr-rocket") as unknown as new () => {
      process(i: unknown, o: Float32Array[][], p: Record<string, Float32Array>): boolean;
    }
  )();
  const got: unknown[] = [];
  const P = p as unknown as { synth: { process(ch: Float32Array, c: unknown): void } };
  P.synth = { process: (_ch, c) => void got.push(c) };
  const out = [[new Float32Array(128), new Float32Array(128)]];
  const params = { throttle: new Float32Array([0.5]), air: new Float32Array([1]), pitch: new Float32Array([1]) };
  p.process([], out, params);
  params.throttle[0] = 0.8;
  p.process([], out, params);
  expect(got[0]).toBe(got[1]);
  expect((got[1] as { throttle: number }).throttle).toBeCloseTo(0.8, 5);
});

test("a context left interrupted (Safari) started again at the next gesture or return", async () => {
  const { SoundEngine } = await import("../src/audio/engine");
  let resumed = 0;
  const e = Object.create(SoundEngine.prototype) as InstanceType<typeof SoundEngine>;
  const E = e as unknown as { started: boolean; enabled: boolean; ctx: unknown; start(): void };
  E.started = true;
  E.enabled = true;
  E.ctx = { state: "interrupted", resume: async () => void resumed++ };
  E.start();
  expect(resumed).toBe(1);
});

test("TARS's ear in the worklet: the microphone's 128-sample blocks handed on in parts of 1 024, nothing lost (TA-22)", async () => {
  const { MIC_PART } = await import("../src/audio/engine-worklet");
  const Mic = procs.get("kerr-mic");
  expect(Mic ?? null).not.toBeNull();
  const m = new Mic!();
  const parts: Float32Array[] = [];
  m.port = { postMessage: (x: unknown) => void parts.push(x as Float32Array) };
  let v = 0;
  for (let b = 0; b < 17; b++) {
    const block = new Float32Array(128);
    for (let i = 0; i < 128; i++) block[i] = (v++ % 1000) / 1000;
    m.process([[block]]);
  }
  // 17 × 128 = 2 176 samples: two parts of 1 024 handed on, in order
  expect(parts.length).toBe(2);
  expect(parts[0]!.length).toBe(MIC_PART);
  expect(parts[1]![0]).toBeCloseTo((1024 % 1000) / 1000, 6);
});
