// Speaking to TARS (PLAN-TARS-AGENT A5): the recognition's own early ends — Chrome's after half a second at
// times, Safari's after its first phrase — begun again while listening is wanted, the words kept; a refusal,
// or ends right at the start three times running, give up with their reason.
import { expect, test } from "bun:test";
import { PushToTalk } from "../src/ai/listen";

type Fake = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
  say(text: string, final: boolean): void;
  end(error?: string): void;
};

function setup() {
  const made: Fake[] = [];
  let clock = 0;
  class Rec implements Fake {
    lang = "";
    continuous = false;
    interimResults = false;
    onresult: Fake["onresult"] = null;
    onerror: Fake["onerror"] = null;
    onend: Fake["onend"] = null;
    constructor() {
      made.push(this);
    }
    start() {}
    stop() {
      this.end();
    }
    abort() {}
    say(text: string, final: boolean) {
      this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: final })] });
    }
    end(error?: string) {
      if (error) this.onerror?.({ error });
      this.onend?.();
    }
  }
  const log = { states: [] as boolean[], heard: [] as string[], failed: [] as string[] };
  const ptt = new PushToTalk(
    {
      lang: () => "fr",
      hearing: () => {},
      heard: (t) => log.heard.push(t),
      failed: (why, code) => log.failed.push(`${why}:${code}`),
      state: (on) => log.states.push(on),
    },
    () => Rec as never,
    () => clock,
  );
  return { ptt, made, log, tick: (ms: number) => (clock += ms) };
}

test("an early end of the browser's own: begun again, the words kept, sent once at the stop", () => {
  const { ptt, made, log, tick } = setup();
  ptt.start();
  expect(made.length).toBe(1);
  expect(made[0]!.lang).toBe("fr-FR");
  tick(500);
  made[0]!.say("emmène-nous", false);
  // (Chrome's end half a second in, mid-phrase: "aborted")
  made[0]!.end("aborted");
  expect(made.length).toBe(2);
  expect(log.states).toEqual([true]);
  tick(2000);
  made[1]!.say("sur la Lune", true);
  made[1]!.end("no-speech");
  expect(made.length).toBe(3);
  ptt.stop();
  expect(log.states).toEqual([true, false]);
  expect(log.heard).toEqual(["emmène-nous sur la Lune"]);
  expect(log.failed).toEqual([]);
});

test("the microphone refused: given up at once, said; ends right at the start three times: given up with its code", () => {
  const a = setup();
  a.ptt.start();
  a.made[0]!.end("not-allowed");
  expect(a.made.length).toBe(1);
  expect(a.log.failed).toEqual(["denied:not-allowed"]);
  expect(a.log.states).toEqual([true, false]);
  const b = setup();
  b.ptt.start();
  for (let i = 0; i < 3; i++) b.made[i]!.end("network");
  expect(b.made.length).toBe(3);
  expect(b.log.failed).toEqual(["network:network"]);
  expect(b.log.states).toEqual([true, false]);
});

test("the key held: listening after the hold, released: sent; a tap: the field", async () => {
  const { ptt, made, log } = setup();
  ptt.down();
  await new Promise((r) => setTimeout(r, 320));
  expect(made.length).toBe(1);
  made[0]!.say("bonjour", true);
  expect(ptt.up()).toBe(false);
  expect(log.heard).toEqual(["bonjour"]);
  ptt.down();
  expect(ptt.up()).toBe(true);
});

test("the microphone open a second at a time and nothing heard, no error said: given up after three, not begun again forever", () => {
  const { ptt, made, log, tick } = setup();
  ptt.start();
  for (let i = 0; i < 3; i++) {
    tick(1000);
    made[i]!.end();
  }
  expect(made.length).toBe(3);
  expect(log.failed).toEqual(["other:ended-without-results"]);
  expect(log.states).toEqual([true, false]);
  expect(ptt.trail.some((l) => l.includes("end (0 results)"))).toBe(true);
});

// Deepgram's ear (deepgram.ts): its words as they come, its last ones before the end, its failures said
import { downsample, pcm16, readResult } from "../src/ai/deepgram";

test("Deepgram's messages and the audio sent: its words final or interim, 16-bit PCM at 16 kHz", () => {
  expect(readResult(JSON.stringify({ type: "Results", is_final: false, channel: { alternatives: [{ transcript: "emmène" }] } }))).toEqual({
    text: "emmène",
    final: false,
  });
  expect(readResult(JSON.stringify({ type: "Metadata" }))).toBeNull();
  expect(readResult("not json")).toBeNull();
  const x = new Float32Array(4800).fill(0.5);
  const d = downsample(x, 48000, 16000);
  expect(d.length).toBe(1600);
  expect(d[10]).toBeCloseTo(0.5, 6);
  const b = pcm16(new Float32Array([1, -1, 0]));
  expect(new DataView(b.buffer).getInt16(0, true)).toBe(32767);
  expect(new DataView(b.buffer).getInt16(2, true)).toBe(-32767);
});

test("an ear of our own: its words shown as they come, the last ones in before the question; its failure said; none: the browser's", async () => {
  const shown: string[] = [];
  const log = { heard: [] as string[], failed: [] as string[], states: [] as boolean[] };
  let hooks: { interim(t: string): void; final(t: string): void; error(c: string): void } | null = null;
  let ended = false;
  const ear = {
    start: async (h: typeof hooks) => void (hooks = h),
    end: async () => {
      // (its last words come before it resolves)
      hooks!.final("puis vise Mars.");
      ended = true;
    },
  };
  const host = {
    lang: () => "fr" as const,
    hearing: (t: string) => shown.push(t),
    heard: (t: string) => log.heard.push(t),
    failed: (w: string, c?: string) => log.failed.push(`${w}:${c}`),
    state: (on: boolean) => log.states.push(on),
  };
  const ptt = new PushToTalk(
    host,
    () => null,
    () => 0,
    async () => ear,
  );
  ptt.start();
  await Bun.sleep(0);
  hooks!.interim("TARS, emmène-nous");
  hooks!.final("TARS, emmène-nous en orbite autour de la Lune,");
  ptt.stop();
  await Bun.sleep(0);
  expect(ended).toBe(true);
  expect(shown[0]).toBe("TARS, emmène-nous");
  expect(log.heard).toEqual(["TARS, emmène-nous en orbite autour de la Lune, puis vise Mars."]);
  expect(log.states).toEqual([true, false]);
  // (its key refused: said)
  const p2 = new PushToTalk(
    host,
    () => null,
    () => 0,
    async () => ear,
  );
  p2.start();
  await Bun.sleep(0);
  hooks!.error("deepgram-key");
  expect(log.failed).toEqual(["other:deepgram-key"]);
  // (none within reach, no recognition either: said)
  const p3 = new PushToTalk(
    host,
    () => null,
    () => 0,
    async () => null,
  );
  p3.start();
  await Bun.sleep(0);
  expect(log.failed.at(-1)).toBe("other:unsupported");
});
