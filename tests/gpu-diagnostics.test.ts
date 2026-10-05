import { expect, test } from "bun:test";
import { GpuDiagnostics } from "../src/gpu-diagnostics";

test("graphics diagnostics preserve the failed stage across reload without recursive reports", () => {
  let saved = "";
  let now = 100;
  const storage = {
    getItem: () => saved,
    setItem: (_key: string, value: string) => {
      saved = value;
    },
  };
  const first = new GpuDiagnostics(storage, () => now);
  first.setContext({ browser: "test", adapter: { features: [] } });
  first.enter("device-request");
  now += 50;
  first.record("startup-failure", new Error("Device unavailable"), true);
  first.enter("running"); // a late compilation must not erase the actual failure
  first.ready();
  expect(first.snapshot().stage).toBe("device-request");
  expect(first.snapshot().status).toBe("failed");
  expect(first.snapshot().events.at(-1)?.atMs).toBe(50);
  expect(first.snapshot().events.at(-1)?.message).toBe("Error: Device unavailable");
  const second = new GpuDiagnostics(storage);
  expect(second.report().previousIncompleteSession).toMatchObject({ stage: "device-request", status: "failed" });
  second.record("startup-failure", "again", true);
  const third = new GpuDiagnostics(storage);
  expect(third.report().previousIncompleteSession).not.toHaveProperty("previousIncompleteSession");
});

test("diagnostics remain bounded and work when storage or renderer inspection fails", () => {
  const diag = new GpuDiagnostics({
    getItem() {
      throw new Error("Blocked");
    },
    setItem() {
      throw new Error("Full");
    },
  });
  diag.setRuntime(() => {
    throw new Error("Not ready");
  });
  for (let i = 0; i < 100; i++) diag.record("validation", "x".repeat(10_000));
  expect(diag.snapshot().events).toHaveLength(32);
  expect(diag.snapshot().events.every((event) => event.message.length <= 2048)).toBe(true);
  expect(diag.snapshot().runtime).toBeNull();
  expect(JSON.stringify(diag.report()).length).toBeLessThan(100_000);
});

test("native GPU errors preserve their message even though they do not extend Error", () => {
  class GPUValidationError {
    constructor(readonly message: string) {}
  }
  const diag = new GpuDiagnostics();
  diag.record("uncaptured-gpu-error", new GPUValidationError("Binding exceeds device limit"));
  expect(diag.snapshot().events[0]?.message).toBe("GPUValidationError: Binding exceeds device limit");
});
