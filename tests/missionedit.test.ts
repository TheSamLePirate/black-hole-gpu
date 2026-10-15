import { expect, test } from "bun:test";
import { AIR_MISSIONS } from "../src/game/airmissions";
import { checkMission } from "../src/game/mission";
import { completeMission, draftToSpec, missionFromHash, missionToHash, newDraft, specToDraft } from "../src/game/missionedit";

// PLAN-AVIATION-AAA P3: a mission as a link and back; the editor's draft — made from nothing (a SAM to destroy, a
// real flight to identify then escort to a place, a unit appearing, a message), or from a given mission edited and
// back unchanged in what it asks —; a mission sketched as TARS would from "an escort of the A320 AFR123 to Nice",
// completed (its place found, its words, its start where we fly, the flight sent there).

const NICE = { lat: 43.6584, lon: 7.2159, name: "Nice Côte d'Azur" };
const resolve = (n: string) => (/nice|lfmn/i.test(n) ? NICE : null);

test("a mission as a link, read back the same; a broken link said", () => {
  for (const m of AIR_MISSIONS) {
    const spec = checkMission(m.make()).spec!;
    const h = missionToHash(spec);
    expect(h).toMatch(/^#mission=[\w-]+$/);
    expect(missionFromHash(`#scene=x&${h.slice(1)}`)).toEqual(spec);
  }
  expect(missionFromHash("#save=abc")).toBeNull();
  expect(() => missionFromHash(`#mission=${btoa(JSON.stringify({ title: "x" }))}`)).toThrow("a start");
});

test("a draft from nothing: a SAM, a real flight identified then escorted, a unit appearing, a message", () => {
  const d = newDraft({ lat: 43, lon: 6, alt: 4000, hdg: 90 });
  d.title = "Test";
  d.units.push(
    { id: "s1", kind: "sam", name: "SA-6", lat: 43.2, lon: 6.5, alt: 0, hdg: 0, side: "hostile", roles: ["destroy"] },
    {
      id: "t1",
      kind: "traffic",
      name: "",
      callsign: "AFR123",
      lat: 43.5,
      lon: 6.2,
      alt: 10000,
      hdg: 90,
      side: "neutral",
      roles: ["identify", "escort"],
    },
    {
      id: "f1",
      kind: "fighter",
      name: "Bandit",
      lat: 43.4,
      lon: 6.8,
      alt: 6000,
      hdg: 270,
      side: "hostile",
      roles: ["destroy"],
      appear: 120,
      optional: true,
    },
  );
  expect(draftToSpec(d).errors).toEqual(["AFR123: an escort's destination (a place)"]);
  d.places.push({ id: "p1", lat: NICE.lat, lon: NICE.lon, radius: 15000, role: "dest", name: "Nice" });
  d.msgs.push({ at: 10, text: "Go" });
  d.chain = true;
  const { spec, errors } = draftToSpec(d);
  expect(errors).toEqual([]);
  expect(spec!.objectives.map((o) => `${o.kind}:${o.text}:${o.after ?? ""}`)).toEqual([
    "destroy:Destroy SA-6:",
    "identify:Identify AFR123:o-s1",
    "escort:Escort AFR123 to Nice:o-t1-identify",
    "destroy:Destroy Bandit:",
  ]);
  expect(spec!.units.find((u) => u.id === "t1")!.match).toEqual({ callsign: "AFR123" });
  expect(spec!.units.find((u) => u.id === "f1")!.later).toBe(true);
  expect(spec!.triggers!.map((t) => t.id)).toEqual(["appear-f1", "say-0", "to-o-t1-escort"]);
  expect(spec!.limit).toBe(1800);
  // (and back: the same draft)
  const d2 = specToDraft(spec!);
  expect(d2.units.map((u) => [u.id, u.roles.join("+"), u.appear ?? 0])).toEqual([
    ["s1", "destroy", 0],
    ["t1", "identify+escort", 0],
    ["f1", "destroy", 120],
  ]);
  expect(d2.msgs).toEqual([{ at: 10, text: "Go" }]);
  expect(d2.chain).toBe(true);
});

test("a given mission edited: back as it was in what it asks", () => {
  for (const m of AIR_MISSIONS) {
    const spec = checkMission(m.make()).spec!;
    const back = draftToSpec(specToDraft(spec)).spec!;
    expect(back.objectives.map((o) => o.kind).sort()).toEqual(spec.objectives.map((o) => o.kind).sort());
    expect(back.objectives.length).toBe(spec.objectives.length);
    expect(back.objectives.map((o) => o.text).sort()).toEqual(spec.objectives.map((o) => o.text).sort());
    expect(back.units.map((u) => [u.id, u.kind, !!u.later])).toEqual(spec.units.map((u) => [u.id, u.kind, !!u.later]));
    // (its own triggers kept: the renegade's deviation, Corsica's bandit at the coast, the drones at 90 s)
    const ids = (s: typeof spec) => (s.triggers ?? []).map((t) => t.id).filter((id) => !id.startsWith("appear-") && !id.startsWith("say-"));
    for (const id of ids(spec)) expect(ids(back)).toContain(id);
  }
});

test("a mission sketched by TARS — an escort of the A320 AFR123 to Nice — completed", async () => {
  const here = { lat: 43.3, lon: 5.4, alt: 6000, hdg: 80, speed: 240 };
  const r = await completeMission(
    {
      units: [{ kind: "traffic", match: { callsign: "AFR123" }, at: { lat: 43.5, lon: 5.9, alt: 10000 } }],
      objectives: [{ kind: "escort", unit: "traffic1", until: { place: "Nice" } }],
    },
    { here, resolve },
  );
  expect(r.errors).toEqual([]);
  const s = r.spec!;
  expect(s.title).toBe("Escort AFR123 to Nice Côte d'Azur");
  expect(s.start).toMatchObject({ lat: 43.3, lon: 5.4, alt: 6000, hdg: 80, loadout: "aa" });
  const o = s.objectives[0]!;
  expect(o.kind === "escort" && o.until).toEqual({ lat: NICE.lat, lon: NICE.lon, radius: 15000 });
  expect(s.triggers).toEqual([
    { id: "to-o1", when: { time: 5 }, do: [{ course: { unit: "traffic1", to: { lat: NICE.lat, lon: NICE.lon, alt: 3000 } } }] },
  ]);
  expect(s.limit).toBeGreaterThanOrEqual(600);
  // (no place by that name; no start known)
  const bad = await completeMission({ objectives: [{ kind: "reach", at: { place: "Atlantis", radius: 0 } }] }, { resolve });
  expect(bad.errors).toEqual(["objective o1: no place called Atlantis", "objective o1: its place"]);
  // (a strike sketched: its start short of the target, air-to-ground)
  const strike = await completeMission(
    { units: [{ kind: "sam", id: "s", at: { lat: 42.5, lon: 8.85 } }], objectives: [{ kind: "destroy", units: ["s"] }] },
    { resolve },
  );
  expect(strike.spec!.start.loadout).toBe("ag");
  expect(strike.spec!.start.lat).toBeCloseTo(42.5 - 0.36, 1);
});
