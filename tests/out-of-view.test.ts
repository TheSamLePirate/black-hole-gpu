import { expect, test } from "bun:test";
import { awayWords, OutOfView } from "../src/game/out-of-view";

// The game out of view (src/game/out-of-view.ts; audit AR-02, NET-14; wave 4.2): saved as it goes, paused alone, the room
// told in one, the pause's line saying how long at the return. The e2e: tests/e2e/hidden-tab.e2e.test.ts.

const make = (o: { room?: boolean; playing?: boolean } = {}) => {
  let t = 0;
  const calls: string[] = [];
  const v = new OutOfView(
    {
      inRoom: () => !!o.room,
      playing: () => o.playing ?? true,
      save: () => calls.push("save"),
      pause: (why) => calls.push(`pause:${why}`),
      repause: (why) => (calls.push(`repause:${why}`), true),
      presence: (away, s) => calls.push(`presence:${away}:${s}`),
    },
    () => ({ away: "out of view", back: "out of view {0}" }),
    () => t,
  );
  return { v, calls, at: (ms: number) => (t = ms) };
};

test("alone: saved and paused as it goes; the pause's line says how long at the return", () => {
  const { v, calls, at } = make();
  v.change(true);
  at(135_000);
  v.change(false);
  expect(calls).toEqual(["save", "pause:out of view", "repause:out of view 2 min 15 s"]);
  expect(v.lastS).toBe(135);
});

test("alone, nothing being played (the title, a paused game): saved, not paused", () => {
  const { v, calls, at } = make({ playing: false });
  v.change(true);
  at(5000);
  v.change(false);
  expect(calls).toEqual(["save"]);
});

test("in a room: nothing paused; the room told as it goes and at the return (how long)", () => {
  const { v, calls, at } = make({ room: true });
  v.change(true);
  at(42_400);
  v.change(false);
  expect(calls).toEqual(["save", "presence:true:0", "presence:false:42.4"]);
});

test("a repeated change is one (two hidden in a row, a visible with no hidden before)", () => {
  const { v, calls } = make();
  v.change(false);
  v.change(true);
  v.change(true);
  expect(calls).toEqual(["save", "pause:out of view"]);
});

test("the duration in words", () => {
  expect(awayWords(3.4)).toBe("3 s");
  expect(awayWords(65)).toBe("1 min 05 s");
  expect(awayWords(3725)).toBe("1 h 02 min");
});
