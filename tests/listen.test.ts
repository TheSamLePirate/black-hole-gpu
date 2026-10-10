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
