import { expect, test } from "bun:test";
import { AsyncResource, CompileQueue } from "../src/util/async-resource";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("LUT failure cannot suppress an independently successful quality pipeline", async () => {
  const q = deferred<string>();
  const lut = deferred<string>();
  const quality = new AsyncResource(() => q.promise);
  const optional = new AsyncResource(() => lut.promise);
  const ready = quality.start();
  const failed = optional.start();
  expect(quality.start()).toBe(ready);
  lut.reject(new Error("LUT rejected"));
  q.resolve("quality");
  await Promise.all([ready, failed]);
  expect(quality.state).toBe("ready");
  expect(quality.value).toBe("quality");
  expect(optional.state).toBe("failed");
  expect(optional.error).toBe("LUT rejected");
});

test("a stuck compile terminates waiting and ignores its late result", async () => {
  const q = deferred<string>();
  let changes = 0;
  const quality = new AsyncResource(
    () => q.promise,
    () => {
      changes++;
    },
    10,
  );
  await quality.start();
  expect(quality.state).toBe("failed");
  expect(quality.error).toContain("timed out");
  q.resolve("late");
  await Bun.sleep(0);
  expect(quality.value).toBeNull();
  expect(changes).toBe(1);
});

test("specialised compiles stay serial and obsolete queued work never starts", async () => {
  const queue = new CompileQueue();
  const first = deferred<string>();
  const calls: string[] = [];
  let obsolete = false;
  const a = queue.run(
    () => true,
    () => {
      calls.push("A");
      return first.promise;
    },
  );
  const b = queue.run(
    () => !obsolete,
    async () => {
      calls.push("B");
      return "B";
    },
  );
  const c = queue.run(
    () => true,
    async () => {
      calls.push("C");
      return "C";
    },
  );
  await Bun.sleep(0);
  expect(calls).toEqual(["A"]);
  obsolete = true;
  first.resolve("A");
  expect(await Promise.all([a, b, c])).toEqual(["A", null, "C"]);
  expect(calls).toEqual(["A", "C"]);
  expect(queue.pending).toBe(0);
});

test("a rejected compile releases the serial queue for subsequent scenes", async () => {
  const queue = new CompileQueue();
  const failure = queue
    .run(
      () => true,
      async () => {
        throw new Error("failed");
      },
    )
    .catch((e: Error) => e.message);
  const next = queue.run(
    () => true,
    async () => "next",
  );
  expect(await failure).toBe("failed");
  expect(await next).toBe("next");
});

test("optional resources do no work before demand and compile once for concurrent callers", async () => {
  let calls = 0;
  const resource = new AsyncResource(async () => {
    calls++;
    return "ready";
  });
  await Bun.sleep(0);
  expect(resource.state).toBe("idle");
  expect(calls).toBe(0);
  await Promise.all([resource.start(), resource.start()]);
  expect(calls).toBe(1);
  expect(resource.value).toBe("ready");
});

test("synchronous and empty-message failures still provide a terminal error", async () => {
  const resource = new AsyncResource<string>(() => {
    throw new Error("");
  });
  await resource.start();
  expect(resource.state).toBe("failed");
  expect(resource.error).toBe("Compilation failed");
});
