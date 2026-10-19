import { describe, expect, test } from "bun:test";
import { MINIMUM, type PreflightInput, preflight, TOO_SLOW_MS, tooSlow } from "../src/preflight";

describe("tooSlow", () => {
  test("only past the threshold, and never on a missing measure", () => {
    expect(tooSlow(TOO_SLOW_MS)).toBe(false);
    expect(tooSlow(TOO_SLOW_MS + 1)).toBe(true);
    expect(tooSlow(Number.NaN)).toBe(false);
    expect(tooSlow(0)).toBe(false);
  });
});

const ok: PreflightInput = {
  webgpu: true,
  secureContext: true,
  adapter: { fallback: false, limits: { ...MINIMUM } },
  previous: null,
};
const refused = (i: PreflightInput) => {
  const v = preflight(i);
  if (v.kind !== "refuse") throw new Error("expected a refusal");
  return v.reasons.join(" ");
};

describe("preflight", () => {
  test("a conforming adapter runs, in the normal mode", () => {
    expect(preflight(ok)).toEqual({ kind: "run", safe: false, reasons: [] });
  });
  test("no WebGPU: refused, and an insecure page told apart", () => {
    expect(refused({ ...ok, webgpu: false })).toContain("no WebGPU");
    expect(refused({ ...ok, webgpu: false, secureContext: false })).toContain("https://");
  });
  test("no adapter: refused", () => {
    expect(refused({ ...ok, adapter: null })).toContain("no graphics adapter");
  });
  test("a limit under the minimum: refused, naming it", () => {
    const why = refused({ ...ok, adapter: { fallback: false, limits: { ...MINIMUM, maxComputeWorkgroupStorageSize: 8192 } } });
    expect(why).toContain("maxComputeWorkgroupStorageSize: 8192 < 16384");
  });
  test("a limit the adapter does not report counts as zero", () => {
    expect(refused({ ...ok, adapter: { fallback: false, limits: {} } })).toContain("maxBufferSize: 0");
  });
  test("a software renderer: refused, unless chosen", () => {
    const soft = { ...ok, adapter: { fallback: true, limits: { ...MINIMUM } } };
    expect(refused(soft)).toContain("software renderer");
    expect(preflight({ ...soft, allowSoftware: true }).kind).toBe("run");
  });
  test("a last start that stopped while compiling: the lightest mode, once", () => {
    const v = preflight({ ...ok, previous: { status: "starting", stage: "pipeline-creation" } });
    expect(v).toMatchObject({ kind: "run", safe: true });
  });
  test("a last start that failed or ended elsewhere does not trigger it", () => {
    expect(preflight({ ...ok, previous: { status: "starting", stage: "startup" } })).toMatchObject({ safe: false });
    expect(preflight({ ...ok, previous: { status: "running", stage: "pipeline-creation" } })).toMatchObject({ safe: false });
  });
});
