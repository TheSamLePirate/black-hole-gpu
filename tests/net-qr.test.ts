import { expect, test } from "bun:test";
import { qr, qrSvg } from "../src/net/qr";

// PLAN-RESEAU R4: the room link's QR code — byte mode, error correction M, versions 1–10. Its matrices were
// checked module by module against Python's qrcode (versions 1, 2, 3, 4, 5, 7, 10; masks 0–7): these digests
// keep them so.

const digest = (X: boolean[][]) => {
  let h = 2166136261;
  for (const row of X) for (const d of row) h = Math.imul(h ^ (d ? 1 : 0), 16777619) >>> 0;
  return `${X.length}:${h.toString(16)}`;
};

test("the matrices as checked against the reference", () => {
  const cases: [string, number, number][] = [
    ["hello wörld", 1, 0],
    ["https://samlepirate.org/#join=Q2W3E4", 4, 1],
    ["https://thesamlepirate.github.io/black-hole-gpu/#join=XQ7MPK&role=spectator", 5, 5],
    ["y".repeat(190), 10, 6],
  ];
  const got = cases.map(([t, v, m]) => digest(qr(t, { version: v, mask: m })));
  expect(got).toMatchSnapshot();
});

test("the version picked by the length; an SVG with its quiet zone", () => {
  expect(qr("https://samlepirate.org/#join=ABC234").length).toBe(29);
  expect(qr("x".repeat(100)).length).toBe(41);
  const svg = qrSvg("https://samlepirate.org/#join=ABC234", 4);
  expect(svg).toContain('width="148"');
  expect(() => qr("z".repeat(300))).toThrow();
});
