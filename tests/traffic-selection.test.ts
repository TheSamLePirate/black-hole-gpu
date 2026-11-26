import { expect, test } from "bun:test";
import { nearest } from "../src/controller/traffic";

test("airport subject keeps a bounded mesh/light slot despite a crowded apron and long distance", () => {
  const parked = Array.from({ length: 30 }, (_, i) => ({ p: [i + 1, 0, 0] }));
  const filmed = { p: [30_000, 0, 0] };
  const list = [...parked, filmed];
  for (const [range, max] of [
    [25_000, 12],
    [80_000, 24],
  ]) {
    const selected = nearest(list, [0, 0, 0], range!, max!, filmed);
    expect(selected).toEqual([filmed, ...parked.slice(0, max! - 1)]);
    expect(nearest(list, [0, 0, 0], range!, max!)).toEqual(parked.slice(0, max));
  }
  expect(nearest(list, [0, 0, 0], 25_000, 0, filmed)).toEqual([]);
  expect(nearest(parked, [0, 0, 0], 25_000, 12, filmed)).toEqual(parked.slice(0, 12));
});

test("effects follow each mesh's wing, wheels and rear or underwing engines", async () => {
  const { ATTACHMENTS, attachmentScale, effectPoint } = await import("../src/traffic/attachments");
  for (const model of ["a320", "a320t", "crj900"] as const) {
    const m = ATTACHMENTS[model];
    for (const side of [1, -1]) {
      effectPoint(model, `a320t${side}`, [17 * side, 2.95, -2]).forEach((v, i) =>
        expect(v).toBeCloseTo(i === 0 ? m.tip[i] * side : m.tip[i]!, 6),
      );
    }
    const wheel = effectPoint(model, "a320s1", [4.326, -1.43, 1.139]);
    wheel.forEach((v, i) => expect(v).toBeCloseTo(m.main[i]!, 5));
    expect(m.exhaust[2]).toBeLessThan(m.inlet[2]);
  }
  expect(ATTACHMENTS.crj900.inlet[2]).toBeLessThan(-7);
  expect(ATTACHMENTS.a320t.inlet[2]).toBeGreaterThan(0);
  // The same wheel plane after changing from the static mesh to the articulated A320.
  const rig = attachmentScale("a320t", 44.5, true);
  expect(-1.59 * rig.scale - rig.down).toBeCloseTo((-3.22 * 44.5) / 37.7, 6);
});

test("articulated A320 light anchors match the shipped rig's own lamps", async () => {
  const { inflated } = await import("../src/util/inflate");
  const { parseA320 } = await import("../src/a320/rig");
  const { ATTACHMENTS } = await import("../src/traffic/attachments");
  const mesh = parseA320(await inflated(new Response(Bun.file("assets/a320/a320.bin"))));
  for (const [key, kind] of [
    ["nav", "nav"],
    ["beacon", "beacon"],
    ["landing", "landing"],
  ] as const) {
    const lamp = mesh.lamps.find((l) => l.kind === kind)!;
    ATTACHMENTS.a320[key].forEach((v, i) => expect(v).toBeCloseTo(lamp.p[i]!, i === 0 ? 2 : 5));
  }
});
