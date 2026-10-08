import { expect, test } from "bun:test";
import { inflated } from "../src/util/inflate";

// The meshes gzip'd at build time (PLAN-MONDE M3): inflated by the page; a file stored plain still loads.

test("a gzip'd file inflated, a plain one passed through; the shipped meshes gzip'd with their magic inside", async () => {
  const body = new Uint8Array([0x52, 0x4e, 0x47, 0x52, 1, 2, 3, 4, 5, 6, 7, 8]);
  expect(new Uint8Array(await inflated(new Response(Bun.gzipSync(body))))).toEqual(body);
  expect(new Uint8Array(await inflated(new Response(body)))).toEqual(body);
  for (const [f, magic] of [
    ["assets/ranger/ranger.bin", "RNGR"],
    ["assets/lander/lander.bin", "LNDR"],
    ["assets/endurance/endurance.bin", "ENDR"],
    ["assets/endurance/endurance-full.bin", "ENDR"],
  ] as const) {
    const raw = new Uint8Array(await Bun.file(`${import.meta.dir}/../${f}`).arrayBuffer());
    expect([raw[0], raw[1]]).toEqual([0x1f, 0x8b]);
    const buf = await inflated(new Response(raw));
    expect(new TextDecoder().decode(new Uint8Array(buf, 0, 4))).toBe(magic);
  }
});
