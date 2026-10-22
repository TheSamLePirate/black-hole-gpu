// The A320's displays' SVG reader (src/a320/du/svg.ts — docs/PLAN-A320.md, A7): FlightGear's SVGs read into their
// elements by id, their styles and transforms, an element clipped by its X_clip's bounds, the centres the drivers turn
// about; FlightGear's canvas calls kept on the elements; and every SVG the displays use read whole.
import { describe, expect, test } from "bun:test";
import { parseXml, SvgDoc } from "../src/a320/du/svg";

describe("A320 displays' SVG", () => {
  test("XML: elements, attributes, entities, text; comments and Inkscape's metadata dropped", () => {
    const x = parseXml(`<?xml version="1.0"?><!-- c --><svg a="1"><text id="t">A &amp; B</text><g/></svg>`);
    const svg = x.kids[0]!;
    expect(svg.tag).toBe("svg");
    expect(svg.attrs.a).toBe("1");
    expect(svg.kids.map((k) => k.tag)).toEqual(["text", "g"]);
    expect(svg.kids[0]!.text).toBe("A & B");
  });

  test("a document: ids, styles, transforms, the clip, centres, canvas calls", () => {
    const d = new SvgDoc(`<svg width="1024" height="1024" viewBox="0 0 1024 1024">
      <g id="tape" transform="translate(10,20)">
        <rect id="box" x="0" y="0" width="100" height="50" style="fill:#00ff00;stroke:none"/>
        <text id="spd" x="5" y="40" style="font-size:30px;text-anchor:middle;fill:#fff"><tspan x="5" y="40">250</tspan></text>
      </g>
      <rect id="tape_clip" x="0" y="0" width="200" height="300"/>
      <path id="needle" d="M 100,100 L 200,100 L 200,140 Z" style="stroke:#ff9900;stroke-width:3;fill:none"/>
    </svg>`);
    expect(d.byId.get("box")!.style.fill).toBe("#00ff00");
    expect(d.byId.get("needle")!.style.stroke).toBe("#ff9900");
    expect(d.get("spd").getText()).toBe("250");
    d.get("spd").setText(251);
    expect(d.get("spd").getText()).toBe("251");
    // (the tape clipped by its _clip's bounds, the _clip hidden)
    expect(d.get("tape").clip).toEqual([0, 0, 200, 300]);
    expect(d.get("tape_clip").visible).toBeFalse();
    // (a path's centre: its box's)
    expect(d.get("needle").getCenter()).toEqual([150, 120]);
    // (the group's box through its translation: its centred text's left edge — 3 glyphs of 0.6 em — the leftmost)
    expect(d.get("tape").transformedBounds()![0]).toBeCloseTo(10 + 5 - 27, 3);
    // (an id the SVG lacks: a stand-in, no throw)
    expect(() => d.get("missing").hide().setTranslation(1, 2)).not.toThrow();
  });

  test("FlightGear's SVGs read whole: the ids their drivers use", async () => {
    const read = async (f: string) => new SvgDoc(await Bun.file(`assets/a320/du/${f}`).text());
    const pfd = await read("pfd.svg");
    for (const id of ["AI_horizon", "AI_center", "ASI_scale", "ALT_scale", "HDG_scale", "FMA_athr"]) expect(pfd.byId.has(id)).toBeTrue();
    expect(pfd.byId.size).toBeGreaterThan(300);
    const ewd = await read("ewd-cfm.svg");
    expect(ewd.byId.size).toBeGreaterThan(50);
    for (const f of ["sd-eng.svg", "sd-wheel.svg", "sd-fctl.svg", "sd-fuel.svg", "isis.svg", "dcdu.svg"])
      expect((await read(f)).byId.size).toBeGreaterThan(5);
  });
});
