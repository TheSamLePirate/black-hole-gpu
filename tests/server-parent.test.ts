import { expect, test } from "bun:test";

// A test's production server (tests/e2e/lib/app.ts starts it with KERR_PARENT_PID) goes with the process that
// started it: once that one dies hard, the server does not hold its port for hours (one ran 56 min orphaned).
test("the server exits once the process that started it is gone", async () => {
  const parent = Bun.spawn(["sleep", "30"]);
  const port = 3900 + Math.floor(Math.random() * 90);
  const server = Bun.spawn(["bun", "server.ts"], {
    env: { ...process.env, PORT: String(port), NODE_ENV: "production", KERR_PARENT_PID: String(parent.pid) },
    stdout: "ignore",
    stderr: "ignore",
  });
  try {
    await Bun.sleep(1500);
    expect(server.exitCode).toBeNull();
    parent.kill("SIGKILL");
    await Promise.race([server.exited, Bun.sleep(8000)]);
    expect(server.exitCode).toBe(0);
  } finally {
    server.kill();
    parent.kill();
  }
}, 20_000);
