import { afterAll, beforeAll, expect, jest, test } from "bun:test";
import { loadHdMap, wantsJupiterKtx } from "../src/system/hd-maps";
import { KTX_IDLE_MS, ktxLevels } from "../src/system/ktx2";
import type { KtxReply, KtxRequest } from "../src/system/ktx-worker";

// Jupiter's 8K compressed map (audit M9): fetched only where it is worth its 32 MB, never retried once
// failed; the transcoder's worker — its heap grown to the largest file — let go once idle.

/** a stand-in for the transcoder's worker: it answers each request with `reply` */
class FakeWorker {
  static made: FakeWorker[] = [];
  static requests = 0;
  static reply: (q: KtxRequest) => KtxReply = (q) => ({ id: q.id, width: 4, height: 4, levels: [new Uint8Array(16)] });
  onmessage: ((e: { data: KtxReply }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  constructor() {
    FakeWorker.made.push(this);
  }
  postMessage(q: KtxRequest) {
    FakeWorker.requests++;
    queueMicrotask(() => this.onmessage?.({ data: FakeWorker.reply(q) }));
  }
  terminate() {
    this.terminated = true;
  }
}

const g = globalThis as unknown as { Worker: unknown; location: unknown };
const saved = { Worker: g.Worker, location: g.location };
beforeAll(() => {
  g.Worker = FakeWorker;
  g.location = { href: "https://example.test/app/" };
});
afterAll(() => {
  g.Worker = saved.Worker;
  g.location = saved.location;
  jest.useRealTimers();
});

const device = (features: GPUFeatureName[], maxTextureDimension2D = 16384) =>
  ({ features: new Set(features), limits: { maxTextureDimension2D } }) as unknown as GPUDevice;

test("the 8K map: a tier ≥ 2 that samples BC7 or ASTC at 8192 — the others keep the JPEG", () => {
  const bc = device(["texture-compression-bc"]);
  expect(wantsJupiterKtx(bc, { level: 2 })).toBe(true);
  expect(wantsJupiterKtx(device(["texture-compression-astc"]), { level: 4 })).toBe(true);
  // (a phone, a weak GPU, a ≤ 4 GB device: tier 1; software: 0)
  expect(wantsJupiterKtx(bc, { level: 1 })).toBe(false);
  expect(wantsJupiterKtx(bc, { level: 0 })).toBe(false);
  expect(wantsJupiterKtx(device([]), { level: 3 })).toBe(false);
  expect(wantsJupiterKtx(device(["texture-compression-bc"], 4096), { level: 3 })).toBe(false);
});

test("the transcoder's worker: kept between files, let go once idle, started again on demand", async () => {
  jest.useFakeTimers();
  await ktxLevels("a.ktx2", "bc7");
  expect(FakeWorker.made).toHaveLength(1);
  jest.advanceTimersByTime(KTX_IDLE_MS - 1);
  await ktxLevels("b.ktx2", "bc7");
  expect(FakeWorker.made).toHaveLength(1);
  expect(FakeWorker.made[0]!.terminated).toBe(false);
  jest.advanceTimersByTime(KTX_IDLE_MS);
  expect(FakeWorker.made[0]!.terminated).toBe(true);
  await ktxLevels("c.ktx2", "bc7");
  expect(FakeWorker.made).toHaveLength(2);
  jest.useRealTimers();
});

test("a failed compressed load is not retried this session", async () => {
  FakeWorker.reply = (q) => ({ id: q.id, error: "test: transcoding failed" });
  const bc = device(["texture-compression-bc"]);
  const before = FakeWorker.requests;
  // (the fake device has no pipelines: the JPEG path after the fallback throws — the compressed attempt
  // is what is under test)
  await loadHdMap(bc, "jupiter", { level: 3 }).catch(() => null);
  expect(FakeWorker.requests).toBe(before + 1);
  expect(wantsJupiterKtx(bc, { level: 3 })).toBe(false);
  await loadHdMap(bc, "jupiter", { level: 3 }).catch(() => null);
  expect(FakeWorker.requests).toBe(before + 1);
});
