import { describe, expect, test } from "bun:test";
import type { CraftVoice } from "../src/a320/sound/types";
import { type Ear, FADE_OUT, type VoiceFactory, VoiceBook, type VoiceNodes } from "../src/audio/samples";

// PLAN-A320 A12: an aircraft's recorded voices kept from frame to frame (src/audio/samples.ts VoiceBook) — a looped
// voice started once, its gain and rate eased, faded out once gone; a one-shot played at its first sight and at each
// new count of its shot, not again while it stays; the inside's voices silent outside and the outside's inside; all
// silent paused; a recording not decoded yet tried again next frame.

type Log = { ev: string; id: string; v?: number | number[] | null }[];

/** a fake factory: what was made and asked, in order; `ready` the recordings decoded */
function fake(ready = new Set<string>(["hum", "click", "wind", "spool"])) {
  const log: Log = [];
  const f: VoiceFactory = {
    loop(v) {
      if (!ready.has(v.url)) return null;
      log.push({ ev: "start", id: v.id });
      const n: VoiceNodes = {
        gain: (x) => log.push({ ev: "gain", id: v.id, v: x }),
        rate: (x) => log.push({ ev: "rate", id: v.id, v: x }),
        place: (p) => log.push({ ev: "place", id: v.id, v: p }),
        stop: (fade) => log.push({ ev: "stop", id: v.id, v: fade }),
      };
      return n;
    },
    shot(v, g) {
      if (!ready.has(v.url)) return false;
      log.push({ ev: "shot", id: v.id, v: g });
      return true;
    },
  };
  return { f, log, ready };
}

const ear = (inside: boolean): Ear => ({ inside, toEar: (p) => [-p[0], p[1], -p[2]] });
const loop = (id: string, gain: number, o: Partial<CraftVoice> = {}): CraftVoice => ({
  id,
  url: "hum",
  loop: true,
  gain,
  rate: 1,
  pos: [2, 0, 5],
  where: "both",
  ...o,
});
const once = (id: string, o: Partial<CraftVoice> = {}): CraftVoice => ({
  id,
  url: "click",
  loop: false,
  gain: 0.8,
  rate: 1,
  pos: null,
  where: "inside",
  ...o,
});
const last = (log: Log, ev: string, id: string) => log.filter((e) => e.ev === ev && e.id === id).at(-1)?.v;

describe("an aircraft's recorded voices", () => {
  test("a loop: started once, its gain and rate set each frame, placed about the ear, faded out once gone", () => {
    const { f, log } = fake();
    const B = new VoiceBook(f);
    B.frame([loop("eng1", 0.5)], ear(true));
    B.frame([loop("eng1", 0.7, { rate: 1.2 })], ear(true));
    expect(log.filter((e) => e.ev === "start")).toHaveLength(1);
    expect(last(log, "gain", "eng1")).toBe(0.7);
    expect(last(log, "rate", "eng1")).toBe(1.2);
    expect(last(log, "place", "eng1")).toEqual([-2, 0, -5]);
    expect(B.state()).toMatchObject({ voices: 1, playing: ["eng1"], gains: { eng1: 0.7 } });
    B.frame([], ear(true));
    expect(last(log, "stop", "eng1")).toBe(FADE_OUT);
    expect(B.state().voices).toBe(0);
    // (back: a new source)
    B.frame([loop("eng1", 0.5)], ear(true));
    expect(log.filter((e) => e.ev === "start")).toHaveLength(2);
  });

  test("head-locked without a place; the inside's silent outside, the outside's inside, both's always", () => {
    const { f, log } = fake();
    const B = new VoiceBook(f);
    const vs = [loop("cpt", 0.6, { where: "inside", pos: null }), loop("ext", 0.4, { where: "outside" }), loop("air", 0.3)];
    B.frame(vs, ear(true));
    expect(last(log, "place", "cpt")).toBeNull();
    expect(last(log, "gain", "cpt")).toBe(0.6);
    expect(last(log, "gain", "ext")).toBe(0);
    expect(last(log, "gain", "air")).toBe(0.3);
    B.frame(vs, ear(false));
    expect(last(log, "gain", "cpt")).toBe(0);
    expect(last(log, "gain", "ext")).toBe(0.4);
    expect(last(log, "gain", "air")).toBe(0.3);
  });

  test("paused: every voice silent, kept", () => {
    const { f, log } = fake();
    const B = new VoiceBook(f);
    B.frame([loop("eng1", 0.5)], ear(true), false);
    expect(last(log, "gain", "eng1")).toBe(0);
    expect(B.state().voices).toBe(1);
  });

  test("a one-shot: at its first sight, not again while it stays, again at a new count or after it left", () => {
    const { f, log } = fake();
    const B = new VoiceBook(f);
    const shots = () => log.filter((e) => e.ev === "shot").length;
    B.frame([once("click/bat1")], ear(true));
    B.frame([once("click/bat1")], ear(true));
    expect(shots()).toBe(1);
    B.frame([once("gear", { shot: 1 })], ear(true));
    B.frame([once("gear", { shot: 1 })], ear(true));
    B.frame([once("gear", { shot: 2 })], ear(true));
    expect(shots()).toBe(3);
    B.frame([], ear(true));
    B.frame([once("click/bat1")], ear(true));
    expect(shots()).toBe(4);
    expect(B.state().shots).toEqual(["click/bat1", "gear", "gear", "click/bat1"]);
    // (an inside one-shot outside: not played, not saved for later)
    B.frame([once("click/x")], ear(false));
    B.frame([], ear(true));
    expect(shots()).toBe(4);
  });

  test("a recording not decoded yet: tried again next frame", () => {
    const { f, log, ready } = fake(new Set());
    const B = new VoiceBook(f);
    B.frame([loop("eng1", 0.5, { url: "spool" }), once("gpws/500", { url: "500" })], ear(true));
    expect(log).toHaveLength(0);
    expect(B.state().voices).toBe(0);
    ready.add("spool");
    ready.add("500");
    B.frame([loop("eng1", 0.5, { url: "spool" }), once("gpws/500", { url: "500" })], ear(true));
    expect(log.filter((e) => e.ev === "start")).toHaveLength(1);
    expect(log.filter((e) => e.ev === "shot")).toHaveLength(1);
  });

  test("stopped: every loop faded out", () => {
    const { f, log } = fake();
    const B = new VoiceBook(f);
    B.frame([loop("a", 1), loop("b", 1, { url: "wind" })], ear(true));
    B.stop();
    expect(log.filter((e) => e.ev === "stop").map((e) => e.id)).toEqual(["a", "b"]);
    expect(B.state().voices).toBe(0);
  });
});
