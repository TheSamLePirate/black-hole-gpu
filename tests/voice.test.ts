import { expect, test } from "bun:test";
import { readingMs, voiceScore, VoiceQueue, type VoiceLine } from "../src/audio/voice";

// PLAN-TARS T1: the voices' queue — the most urgent first, a more urgent line cutting the one being said, the
// same line not said twice running, a stale one dropped — and the system voice chosen.

const L = (text: string, priority: number, o: Partial<VoiceLine> = {}): VoiceLine => ({ text, priority, speaker: "mission", ...o });

test("the queue: by priority, in order within one; the one being said cut only by a more urgent line", () => {
  const q = new VoiceQueue();
  expect(q.push(L("chatter", 3), 0)).toBe("queued");
  expect(q.push(L("mission", 2), 0)).toBe("queued");
  expect(q.push(L("mission 2", 2), 0)).toBe("queued");
  expect(q.next(0)!.text).toBe("mission");
  // (being said: an equal or lesser line waits, a more urgent one interrupts)
  expect(q.next(0)).toBeNull();
  expect(q.push(L("more chatter", 3), 1)).toBe("queued");
  expect(q.push(L("PULL UP", 0, { speaker: "callout" }), 1)).toBe("interrupt");
  q.done();
  expect(q.next(1)!.text).toBe("PULL UP");
  q.done();
  expect([q.next(2)!.text, (q.done(), q.next(2))!.text, (q.done(), q.next(2))!.text]).toEqual(["mission 2", "chatter", "more chatter"]);
});

test("the same line twice running said once; one gone stale dropped; cleared", () => {
  const q = new VoiceQueue(4000);
  expect(q.push(L("one hundred", 1, { id: "h100" }), 0)).toBe("queued");
  expect(q.push(L("one hundred", 1, { id: "h100" }), 500)).toBe("dropped");
  expect(q.next(500)!.text).toBe("one hundred");
  q.done();
  // (later on, the same callout is a new one)
  expect(q.push(L("one hundred", 1, { id: "h100" }), 6000)).toBe("queued");
  q.next(6000);
  q.done();
  q.push(L("fifty", 1, { ttl: 1500 }), 7000);
  q.push(L("thirty", 1, { ttl: 1500 }), 8000);
  // (fifty's height long passed: dropped; thirty said)
  expect(q.next(8800)!.text).toBe("thirty");
  q.clear();
  expect(q.waiting).toBe(0);
  expect(q.current).toBeNull();
});

test("the system voice: the language, then the better ones; the novelty voices never", () => {
  const vs = [
    { lang: "en-US", name: "Albert", localService: true },
    { lang: "fr-FR", name: "Thomas", localService: true },
    { lang: "fr-CA", name: "Amélie", localService: true },
    { lang: "fr-FR", name: "Google français", localService: false },
    { lang: "en-GB", name: "Daniel (Enhanced)", localService: true },
  ];
  const best = (w: "fr" | "en") => [...vs].sort((a, b) => voiceScore(b, w) - voiceScore(a, w))[0]!.name;
  expect(best("fr")).toBe("Google français");
  expect(best("en")).toBe("Daniel (Enhanced)");
  expect(voiceScore(vs[0]!, "en")).toBeLessThan(0);
  expect(voiceScore(vs[1]!, "en")).toBe(-1);
  expect(readingMs("ok")).toBe(2500);
  expect(readingMs("x".repeat(100))).toBe(6900);
});
