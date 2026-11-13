import { expect, test } from "bun:test";
import { Persistence } from "../src/game/persistence";

// What the game keeps of itself (src/game/persistence.ts; audit AR-12, wave 4.8's first lot): the autosave every period,
// after a setting changed with the preferences (two seconds after the last write at the soonest), at the page's leaving; never a render's or a replay's scene,
// never a benchmark's settings; a refusal said once.

const make = (o: { on?: boolean; every?: number; own?: boolean; ok?: boolean } = {}) => {
  const calls: string[] = [];
  const state = { started: true, busy: false, ok: o.ok ?? true };
  const p = new Persistence({
    autosave: () => ({ on: o.on ?? true, every: o.every ?? 10 }),
    autosaveNow: () => (calls.push("save"), state.ok),
    writePrefs: () => calls.push("prefs"),
    ownPrefs: o.own ?? true,
    started: () => state.started,
    busy: () => state.busy,
    refused: () => calls.push("refused"),
  });
  return { p, calls, state };
};

test("every period of the loop's time; not before the first image", () => {
  const { p, calls, state } = make({ every: 10 });
  state.started = false;
  for (let i = 0; i < 120; i++) p.tick(0.1);
  expect(calls).toEqual([]);
  state.started = true;
  p.tick(0.1);
  expect(calls).toEqual(["save"]);
  for (let i = 0; i < 99; i++) p.tick(0.1);
  expect(calls).toEqual(["save"]);
  p.tick(0.2);
  expect(calls).toEqual(["save", "save"]);
});

test("a setting changed: the preferences and the game two seconds after the last write at the soonest, once for several changes", () => {
  const { p, calls } = make({ every: 60 });
  p.changed();
  p.tick(1);
  p.changed();
  p.tick(1.5);
  expect(calls).toEqual(["prefs", "save"]);
  p.tick(5);
  expect(calls).toEqual(["prefs", "save"]);
});

test("a render or a replay running: nothing of its scene kept; a benchmark's settings never the player's", () => {
  const { p, calls, state } = make({ own: false });
  state.busy = true;
  p.changed();
  for (let i = 0; i < 30; i++) p.tick(1);
  p.leaving();
  expect(calls).toEqual([]);
  state.busy = false;
  p.leaving();
  expect(calls).toEqual(["save"]);
  // (the change made during it kept: written at the first frame after, with the game)
  p.tick(0.1);
  expect(calls).toEqual(["save", "save"]);
});

test("leaving: the preferences and the game now; the autosave off: the preferences alone", () => {
  const a = make();
  a.p.leaving();
  expect(a.calls).toEqual(["prefs", "save"]);
  const b = make({ on: false });
  b.p.leaving();
  expect(b.calls).toEqual(["prefs"]);
});

test("refused: said once, again only after one has taken", () => {
  const { p, calls, state } = make({ every: 1, ok: false });
  p.tick(1.1);
  p.tick(1.1);
  expect(calls).toEqual(["save", "refused", "save"]);
  state.ok = true;
  p.tick(1.1);
  state.ok = false;
  p.tick(1.1);
  expect(calls).toEqual(["save", "refused", "save", "save", "save", "refused"]);
});
