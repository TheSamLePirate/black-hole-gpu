import { expect, test } from "bun:test";
import { craftTiles, craftViews } from "../src/crew/profile";
import { readInstruments } from "../src/net/instruments";
import { readCrewCmd, sayOf } from "../src/net/crewcmd";
import { CrewExec } from "../src/ui/crew-exec";

// A console for each craft (AUDIT-CREW priority 4): the Lander's descent, the Endurance's ring and fleet, the state
// landed, Gargantua's side; the landing point redesignated from the crew, the fleet's orders.

test("each craft its views and tiles: the Lander's descent first, the Ranger's after the ground, the Endurance none", () => {
  const lander = craftViews("space", { id: "lander", lands: true });
  expect(lander.slice(0, 3)).toEqual(["sdash", "descent", "ground"]);
  expect(new Set(lander).size).toBe(lander.length);
  const ranger = craftViews("space", { id: "ranger", lands: true });
  expect(ranger.indexOf("descent")).toBe(ranger.indexOf("ground") + 1);
  expect(craftViews("space", { id: "endurance", lands: false, ring: true })).not.toContain("descent");
  expect(craftViews("jet", { id: "f35", lands: true })).not.toContain("descent");
  expect(craftTiles("space", { id: "lander", lands: true })).toEqual(expect.arrayContaining(["agl", "vz", "hs"]));
  expect(craftTiles("space", { id: "endurance", ring: true })).toContain("ring");
});

test("the space blocks grow: the craft's state and place, the descent, the clocks since the start, a station's place", () => {
  const s = readInstruments({
    v: 1,
    t: 1,
    metrics: {},
    craft: { id: "lander", kind: "spacecraft", name: "Lander", lands: true, ring: false, status: "flight", where: "moon" },
    desc: { agl: 812.4, vz: -6.2, vh: 1.5, hover: false, auto: "land", ttg: 131, lpd: { dist: 220, reach: 812 } },
    time: { warp: 1, room: 5000, dtau: 0.9999, tau: 1200, since: 1200, lag: 0.04 },
    target: { id: "iss", name: "ISS", dist: 900, r: [10, 20, 30] },
  })!;
  expect(s.craft).toMatchObject({ status: "flight", where: "moon" });
  expect(s.desc).toMatchObject({ agl: 812.4, auto: "land", lpd: { dist: 220, reach: 812 } });
  expect(s.time).toMatchObject({ since: 1200, lag: 0.04 });
  expect(s.target?.r).toEqual([10, 20, 30]);
  const old = readInstruments({ v: 1, t: 1, metrics: {}, craft: { id: "lander", kind: "spacecraft", name: "L", lands: true } })!;
  expect(old.craft?.status).toBeUndefined();
  expect(old.desc).toBeUndefined();
});

test("sp.lpd: a place or a step, bounded; sp.fleet: an order to a slot", () => {
  expect(readCrewCmd({ v: 1, id: "a", to: 0, act: "sp.lpd", args: { fwd: 100, right: 0 } }).ok).toBe(true);
  expect(readCrewCmd({ v: 1, id: "b", to: 0, act: "sp.lpd", args: { lat: 0.67, lon: 23.47 } }).ok).toBe(true);
  expect(readCrewCmd({ v: 1, id: "c", to: 0, act: "sp.lpd", args: { fwd: 1e6 } }).ok).toBe(false);
  expect(readCrewCmd({ v: 1, id: "d", to: 0, act: "sp.fleet", args: { order: "dock", slot: 3, name: "Ben" } }).ok).toBe(true);
  expect(readCrewCmd({ v: 1, id: "e", to: 0, act: "sp.fleet", args: { order: "ram", slot: 3 } }).ok).toBe(false);
  expect(sayOf("sp.fleet", { order: "come", slot: 3, name: "Ben" }).en).toBe("fleet order — Ben: come to me");
});

function rig(camera: Record<string, unknown>, spaceOrder?: (slot: number, o: string) => string) {
  const sent: Record<string, unknown>[] = [];
  const net = {
    room: {
      role: "pilot",
      slot: 0,
      members: [
        { slot: 0, role: "pilot", name: "P" },
        { slot: 2, role: "instruments", name: "Ben" },
      ],
    },
    event: (e: Record<string, unknown>) => sent.push(e),
  };
  const exec = new CrewExec({
    camera: camera as never,
    settings: {} as never,
    tools: () => [],
    toast: () => {},
    nameOf: () => "Ben",
    families: () => ["space"] as never,
    ...(spaceOrder ? { spaceOrder: spaceOrder as never } : {}),
  });
  return { exec, net: net as never, sent };
}
const cmd = (id: string, act: string, args: Record<string, unknown>) => ({ kind: "crew-cmd", v: 1, id, to: 0, act, args, lang: "en" });

test("the executor: the landing point asked of a powered landing under 5 km — else refused, said why", async () => {
  const cam: Record<string, unknown> = { pilot: { auto: "hover" }, landRun: null, lpdOrder: null, surfaceInfo: () => ({ alt: 800 }) };
  const r = rig(cam);
  await r.exec.handle(r.net, 2, cmd("a", "sp.lpd", { fwd: 100 }));
  expect(r.sent[0]).toMatchObject({ ok: false, msg: "The landing point: the powered landing first" });
  cam.pilot = { auto: "land" };
  cam.landRun = { body: "moon", q: [0, 0, 0], site: null };
  await r.exec.handle(r.net, 2, cmd("b", "sp.lpd", { fwd: 100, right: -50 }));
  expect(r.sent[1]).toMatchObject({ ok: true });
  expect(cam.lpdOrder).toEqual({ fwd: 100, right: -50 });
  cam.surfaceInfo = () => ({ alt: 9000 });
  await r.exec.handle(r.net, 2, cmd("c", "sp.lpd", { lat: 1, lon: 2 }));
  expect(r.sent[2]).toMatchObject({ ok: false, msg: "The landing point: below 5 km" });
});

test("the executor: a fleet order said by the pilot's session — refused when it says so", async () => {
  const asked: [number, string][] = [];
  const r = rig({}, (slot, o) => (asked.push([slot, o]), "Order sent to Cy"));
  await r.exec.handle(r.net, 2, cmd("a", "sp.fleet", { order: "hold", slot: 3, name: "Cy" }));
  expect(asked).toEqual([[3, "hold"]]);
  expect(r.sent[0]).toMatchObject({ ok: true });
  const no = rig({}, () => "Orders to the fleet: from a spacecraft");
  await no.exec.handle(no.net, 2, cmd("b", "sp.fleet", { order: "come", slot: 3 }));
  expect(no.sent[0]).toMatchObject({ ok: false });
});

test("Gargantua's side: a Kerr orbit's state in words", async () => {
  const { setLang } = await import("../src/crew/lang");
  const { kerrState } = await import("../src/crew/draw/kerr");
  setLang("en");
  expect(kerrState(0.95, "").text).toBe("BOUND ORBIT");
  expect(kerrState(1.02, "").text).toBe("UNBOUND");
  expect(kerrState(0.9, "horizon").text).toBe("PLUNGING");
  setLang("fr");
  expect(kerrState(0.95, "").text).toBe("ORBITE LIÉE");
});

test("the time gone by on the Earth: since the flight's start, its proper time's restart and a date set forward aside", async () => {
  const { clocksStep } = await import("../src/ui/crew-space");
  // (a flight begun at the room's 1 000 s; an hour near Gargantua at dτ/dt 0.5: the Earth 1 800 s ahead)
  let K = clocksStep(null, 1000, 0, 1);
  for (let k = 1; k <= 3600; k++) K = clocksStep(K, 1000 + k, k * 0.5, 0.5);
  expect(3600 - (K.lastTau - K.tau)).toBeCloseTo(1800, 6);
  // (the old figure — the room's time less the proper time — was the scene's age: 4 600 − 1 800 = 2 800)
  expect(4600 - 1800).not.toBe(1800);
  // (a date set ten days forward: not counted)
  const before = K.t;
  K = clocksStep(K, 4600 + 864_000, 1800.5, 0.5);
  expect(K.t - before).toBeCloseTo(864_000 - 1, 0);
  // (a new flight: the proper time back at 0 — both clocks taken together again)
  K = clocksStep(K, 900_000, 0, 1);
  expect(K).toEqual({ t: 900_000, tau: 0, lastT: 900_000, lastTau: 0 });
});
