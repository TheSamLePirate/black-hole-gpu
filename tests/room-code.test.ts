import { expect, test } from "bun:test";
import { CODE_ALPHABET, isCode, randomCode } from "../src/net/proto";

// A room's code, each character as likely as any other (audit 2026-11-10, NET-33): `byte % 31` made the alphabet's first eight
// characters an eighth more likely (256 = 8 × 31 + 8). The witness first: the measure sees that bias in the old formula.

/** the first eight characters' share against the others', per character (1: even) */
const skew = (codes: string[]) => {
  const n = new Map<string, number>();
  for (const c of codes) for (const ch of c) n.set(ch, (n.get(ch) ?? 0) + 1);
  const mean = (cs: string[]) => cs.reduce((s, ch) => s + (n.get(ch) ?? 0), 0) / cs.length;
  const A = [...CODE_ALPHABET];
  return mean(A.slice(0, 8)) / mean(A.slice(8));
};
const N = 40_000;

test("the witness: the old byte % 31 is an eighth uneven", () => {
  const old = Array.from({ length: N }, () =>
    [...crypto.getRandomValues(new Uint8Array(6))].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join(""),
  );
  expect(skew(old)).toBeGreaterThan(1.08);
});

test("randomCode: six characters of the alphabet, even", () => {
  const codes = Array.from({ length: N }, () => randomCode());
  expect(codes.every(isCode)).toBe(true);
  expect(Math.abs(skew(codes) - 1)).toBeLessThan(0.03);
  // (bytes past 247 drawn again: a source that gives only them at first is not used)
  let k = 0;
  const c = randomCode((n) => new Uint8Array(n).fill(k++ < 2 ? 255 : 0));
  expect(c).toBe("AAAAAA");
});
