import { expect, test } from "bun:test";
import { GpuDiagnostics, globalErrorRouter } from "../src/gpu-diagnostics";

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
  for (let i = 0; i < 100; i++) diag.record("validation", `${i} ${"x".repeat(10_000)}`);
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
  // (a minified build renames the class: the error's own name wins)
  class e {
    readonly name = "GPUOutOfMemoryError";
    constructor(readonly message: string) {}
  }
  diag.record("uncaptured-gpu-error", new e("Allocation failed"));
  expect(diag.snapshot().events[1]?.message).toBe("GPUOutOfMemoryError: Allocation failed");
});

test("an error repeated every frame is counted, its storage writes coalesced; fatal ones and stages written at once", () => {
  let writes = 0;
  let saved = "";
  const queued: (() => void)[] = [];
  let now = 0;
  const diag = new GpuDiagnostics(
    {
      getItem: () => null,
      setItem: (_key, value) => {
        writes++;
        saved = value;
      },
    },
    () => now,
    (write) => queued.push(write),
  );
  for (let frame = 0; frame < 600; frame++, now += 16) diag.record("uncaptured-gpu-error", new Error("Invalid bind group"));
  expect(writes).toBe(0);
  expect(queued).toHaveLength(1);
  queued.shift()!();
  expect(writes).toBe(1);
  const events = JSON.parse(saved).events;
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ kind: "uncaptured-gpu-error", count: 600, atMs: 0, lastAtMs: 599 * 16 });
  diag.enter("pipeline-creation");
  expect(writes).toBe(2);
  diag.record("startup-failure", new Error("Device lost"), true);
  expect(writes).toBe(3);
  expect(JSON.parse(saved).status).toBe("failed");
  diag.flush();
  expect(writes).toBe(4);
});

test("a page-wide error ends the start only before the first image; afterwards it is recorded and told once per kind", () => {
  let started = false;
  const fatal: string[] = [];
  const recorded: string[] = [];
  const told: string[] = [];
  const route = globalErrorRouter({
    started: () => started,
    fatal: (kind) => fatal.push(kind),
    record: (kind) => recorded.push(kind),
    notify: (kind) => told.push(kind),
  });
  route("javascript-error", new Error("during the start"));
  expect(fatal).toEqual(["javascript-error"]);
  started = true;
  for (let i = 0; i < 3; i++) route("unhandled-rejection", new Error("a stray promise"));
  route("javascript-error", new Error("in flight"));
  expect(fatal).toEqual(["javascript-error"]);
  expect(recorded).toEqual(["unhandled-rejection", "unhandled-rejection", "unhandled-rejection", "javascript-error"]);
  expect(told).toEqual(["unhandled-rejection", "javascript-error"]);
});
