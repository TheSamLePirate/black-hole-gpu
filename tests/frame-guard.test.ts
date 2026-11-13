import { expect, test } from "bun:test";
import { FrameGuard } from "../src/game/frame";

// The frame's guarded stages (src/game/frame.ts; audit AR-03, wave 4.8): a stage that throws costs itself, said once; set aside after
// three failing frames, tried again every 5 s, back and said so once it runs.

const make = () => {
  let t = 0;
  const said: string[] = [];
  const g = new FrameGuard({
    say: ({ stage, error, back }) => said.push(back ? `${stage} back` : `${stage}: ${(error as Error).message}`),
    now: () => t,
  });
  return { g, said, at: (ms: number) => (t = ms) };
};

test("a stage that works: its value; one that throws: the fallback, said once, the next stage unharmed", () => {
  const { g, said } = make();
  expect(g.run("a", () => 1, 0)).toBe(1);
  for (let i = 0; i < 10; i++)
    expect(
      g.run(
        "b",
        () => {
          throw new Error("boom");
        },
        -1,
      ),
    ).toBe(-1);
  expect(g.run("c", () => 3)).toBe(3);
  expect(said).toEqual(["b: boom"]);
  expect(g.states().b!.failures).toBe(3);
});

test("set aside after three failing frames: skipped, tried again every 5 s; back, said so", () => {
  const { g, said, at } = make();
  let calls = 0;
  let broken = true;
  const f = () => {
    calls++;
    if (broken) throw new Error("x");
    return "ok";
  };
  for (let i = 0; i < 3; i++) g.run("s", f, "fb");
  expect(calls).toBe(3);
  at(1000);
  for (let i = 0; i < 50; i++) g.run("s", f, "fb");
  expect(calls).toBe(3);
  at(5001);
  expect(g.run("s", f, "fb")).toBe("fb");
  expect(calls).toBe(4);
  broken = false;
  at(10_002);
  expect(g.run("s", f, "fb")).toBe("ok");
  expect(said).toEqual(["s: x", "s back"]);
});

test("an intermittent failure: said again only after half a minute", () => {
  const { g, said, at } = make();
  const bad = () => {
    throw new Error("now and then");
  };
  for (let k = 0; k < 20; k++) {
    at(k * 1000);
    g.run("i", bad);
    g.run("i", () => 1);
  }
  expect(said.length).toBe(1);
  at(40_000);
  g.run("i", bad);
  expect(said.length).toBe(2);
});
