import { expect, test } from "bun:test";
import { frames, synthesize, TARGETS } from "../src/audio/formant";
import { isVowel, normalize, numberWords, phonemes } from "../src/audio/g2p";

// PLAN-TARS T5a: TARS's robot voice — English text to phonemes (the dictionary, the letter rules, the numbers),
// and the formant synthesizer saying them (a real signal, its length, its pauses, fast).

const P = (t: string) =>
  phonemes(t)
    .filter((p) => p !== "|")
    .join(" ");

test("the numbers and units written out", () => {
  expect(numberWords("90")).toBe("ninety");
  expect(numberWords("7.67")).toBe("seven point six seven");
  expect(numberWords("-12")).toBe("minus twelve");
  expect(numberWords("410")).toBe("four hundred ten");
  expect(numberWords("1500000")).toBe("one million five hundred thousand");
  expect(normalize("410 km at 7,670 m/s, 90%")).toContain(
    "four hundred ten  kilometres at  seven thousand six hundred seventy  metres per second,  ninety  percent",
  );
});

test("the words: the dictionary's, the rules' (silent e, magic e, ch, th, -tion, -ed), the pauses", () => {
  expect(P("the")).toBe("D @");
  expect(P("honesty")).toBe("A' n @ s t i");
  expect(P("time")).toBe("t aI' m");
  expect(P("make")).toBe("m eI' k");
  expect(P("church")).toBe("tS 3' tS");
  expect(P("station")).toBe("s t eI' S @ n");
  expect(P("landed")).toBe("l ae' n d I d");
  expect(P("thin")).toBe("T I' n");
  expect(P("slowly")).toBe("s l oU' l i");
  expect(phonemes("Yes. No, never!")).toEqual(["j E' s", "|", ".", "n oU'", "|", ",", "n E' v 3", "|", "."].flatMap((x) => x.split(" ")));
  // (every phoneme said has its target)
  for (const t of ["Gravity is the only thing that crosses time.", "Cooper, the runway is straight ahead. 300 metres."])
    for (const p of phonemes(t)) if (!["|", ",", "."].includes(p)) expect(TARGETS[p.replace("'", "")]).toBeDefined();
});

test("the voice: a signal, its length from its phonemes, its pauses silent, its peak −3 dBFS, a few ms", () => {
  const ph = phonemes("Honesty setting at ninety percent.");
  const t0 = performance.now();
  const x = synthesize(ph, 22050);
  const ms = performance.now() - t0;
  expect(ms).toBeLessThan(200);
  const n = frames(ph).length;
  expect(x.length).toBe(n * Math.round((22050 * 5) / 1000) + Math.round(22050 * 0.05));
  let pk = 0,
    nan = 0,
    e = 0;
  for (const s of x) {
    if (!Number.isFinite(s)) nan++;
    pk = Math.max(pk, Math.abs(s));
    e += s * s;
  }
  expect(nan).toBe(0);
  expect(pk).toBeCloseTo(0.7, 3);
  expect(Math.sqrt(e / x.length)).toBeGreaterThan(0.05);
  // (a full stop: 340 ms of silence between two sentences)
  const two = frames(phonemes("Yes. No."));
  const quiet = two.filter((f) => f.av === 0 && f.af === 0 && f.ah === 0).length;
  expect(quiet * 5).toBeGreaterThanOrEqual(340);
  // (the robot's pitch: in steps — a stressed vowel a step above, the phrase's end below)
  const f0s = new Set(frames(phonemes("Cooper, this is no time for caution.")).map((f) => Math.round(f.f0)));
  expect(f0s.size).toBeGreaterThan(2);
  expect(isVowel("aI'")).toBe(true);
});
