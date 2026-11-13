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
  let Proc: (new () => { process(i: unknown, o: Float32Array[][], p: Record<string, Float32Array>): boolean }) | null = null;
  const g = globalThis as unknown as Record<string, unknown>;
  g.sampleRate = 48_000;
  g.AudioWorkletProcessor = class {};
  g.registerProcessor = (_n: string, C: typeof Proc) => void (Proc = C);
  await import("../src/audio/engine-worklet");
  const p = new Proc!();
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
