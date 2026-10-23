import { expect, test } from "bun:test";
import { PAL, sideFor, symColour } from "../src/radar/symbols";

// The common symbology (PLAN-RADAR-AAA RD3, criterion P5): one palette, every radar screen drawing through
// radar/symbols.ts — none of the old screens' own IFF colours left in them.

test("one palette: each side its colour, a player's own over it, the decoys theirs", () => {
  expect(symColour({ kind: "air", side: "hostile" })).toBe(PAL.hostile);
  expect(symColour({ kind: "air", side: "player", colour: "#abcdef" })).toBe("#abcdef");
  expect(symColour({ kind: "flare", side: "friend" })).toBe(PAL.flare);
  expect(sideFor({ side: "hostile", iff: "unknown" }, false)).toBe("unknown");
  expect(sideFor({ side: "hostile", iff: "unknown" }, true)).toBe("hostile");
  expect(sideFor({ side: "traffic", iff: "neutral" }, false)).toBe("traffic");
});

test("the radar screens draw through the common symbology, their old colours gone", async () => {
  const files = ["src/f35/pcd.ts", "src/ui/hud/symbology.ts", "src/crew/draw/radar.ts", "src/crew/draw/kit.ts"];
  for (const f of files) {
    let src = await Bun.file(`${import.meta.dir}/../${f}`).text();
    // (the HUD's own warnings keep their red: its radar scope alone is the radar's)
    if (f.endsWith("symbology.ts")) {
      const i = src.indexOf("\nfunction drawRadar(");
      src = src.slice(i, src.indexOf("\nfunction ", i + 10));
    }
    // (the crew's radar through its kit's unitSymbol, which draws with drawSym)
    if (!f.endsWith("symbology.ts")) expect(src.includes("radar/symbols") || src.includes("unitSymbol(")).toBe(true);
    else expect(src.includes("drawSym(")).toBe(true);
    // (the six palettes of before: the TSD's and FCR's red, the scope's salmon, the crew's amber unknown)
    for (const old of ["#ff5a46", "rgba(255, 120, 90", 'rgba(255, 70, 60, 1)" : c.seen']) expect(src.includes(old)).toBe(false);
  }
});
