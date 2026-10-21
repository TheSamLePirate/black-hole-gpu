import { expect, test } from "bun:test";
import { CrewModel } from "../src/crew/model";
import { EVENT_MAX, NetClient } from "../src/net/client";
import { readInstruments } from "../src/net/instruments";
import { wgs84Inverse } from "../src/system/ellipsoid";
import { fitSnapshot } from "../src/ui/crew-feed";

// PLAN-RADAR-AAA RD1 at the crew (AUDIT-CREW priority 5): the contacts carried on in the room's time (a pause holds
// them, a warp hastens them), a new place taken in without a jump, the fight's missiles and decoys read, the followed
// pilot kept across a reconnection and followed through a handover of the controls, the events kept under the server's
// limit.

/** a room of a pilot (slot 1, then 3) and the console, its clock ours to set */
function room() {
  const L = new Map<string, ((x: unknown) => void)[]>();
  let clock = 100;
  const members = [
    { slot: 1, role: "pilot", name: "Ana", device: "dev-ana", colour: "#fff" },
    { slot: 3, role: "pilot", name: "Ben", device: "dev-ben", colour: "#fff" },
    { slot: 5, role: "instruments", name: "Cy", device: "dev-cy", colour: "#fff" },
  ];
  const net = {
    room: { code: "ABCDEF", slot: 5, members },
    on: (k: string, f: (x: unknown) => void) => L.set(k, [...(L.get(k) ?? []), f]),
    roomNow: () => clock,
    remotes: {
      track: () => ({
        latest: { frame: 2, body: 0, p: [0, 0, 0], v: [0, 0, 0], q: [0, 0, 0, 1], kind: 0, vis: { mach: 0 } },
        at: () => null,
      }),
    },
  };
  const emit = (k: string, x: unknown) => {
    for (const f of L.get(k) ?? []) f(x);
  };
  const model = new CrewModel(net as never);
  return { model, emit, set: (t: number) => (clock = t), net };
}
const snap = (t: number, tracks: unknown[]) => ({
  kind: "instruments",
  data: { v: 1, t, body: "earth", metrics: {}, route: [], ahead: [], tracks },
});
const drone = (lat: number, spd = 100) => ({
  id: "f:7",
  name: "DRONE 1",
  kind: "air",
  side: "hostile",
  lat,
  lon: 6,
  alt: 3000,
  hdg: 0,
  spd,
  type: "drone",
});

test("the fight's contacts carried on in the room's time: still in a pause, four times as far at ×4", () => {
  const R = room();
  R.emit("event", { from: 1, ev: snap(100, [drone(45)]) });
  R.set(102);
  const a = R.model.contacts()[0]!;
  expect(wgs84Inverse(45, 6, a.lat, a.lon).d).toBeCloseTo(200, 0);
  // (paused: the room's clock still — nothing moves however long)
  const b = R.model.contacts()[0]!;
  expect(wgs84Inverse(a.lat, a.lon, b.lat, b.lon).d).toBeLessThan(0.01);
  // (the room's clock running again: a second of it, 100 m more — at ×4 that second is a quarter of ours)
  R.set(103);
  const c = R.model.contacts()[0]!;
  expect(wgs84Inverse(45, 6, c.lat, c.lon).d).toBeCloseTo(300, 0);
});

test("a new place taken in without a jump: the drawn place moves on, the offset fades", () => {
  const R = room();
  R.emit("event", { from: 1, ev: snap(100, [drone(45, 0)]) });
  R.set(100);
  const a = R.model.contacts()[0]!;
  // (the next snapshot says it is 50 m north: drawn where it was, then taken in)
  R.emit("event", { from: 1, ev: snap(101, [drone(45 + 50 / 111_132, 0)]) });
  R.set(101);
  const b = R.model.contacts()[0]!;
  expect(wgs84Inverse(a.lat, a.lon, b.lat, b.lon).d).toBeLessThan(1);
});

test("missiles and decoys read; the followed pilot kept across a reconnection, followed through a handover", () => {
  const s = readInstruments(
    snap(1, [
      { id: "msl:4", name: "AIM-120 AMRAAM", kind: "missile", side: "friend", lat: 45, lon: 6, alt: 3000, hdg: 1, spd: 900, type: "" },
      { id: "cm:2", name: "FLARE", kind: "decoy", side: "friend", lat: 45, lon: 6, alt: 3000, hdg: 1, spd: 150, type: "flare" },
    ]).data,
  )!;
  expect(s.tracks?.map((t) => t.kind)).toEqual(["missile", "decoy"]);
  const R = room();
  R.emit("room", { code: "ABCDEF" });
  R.model.selected = 3;
  // (the pilot followed known by his device; a reconnection to the same room: found again)
  (R.model as unknown as { followDevice: string }).followDevice = "dev-ben";
  R.emit("room", { code: "ABCDEF" });
  expect((R.model as unknown as { followDevice: string }).followDevice).toBe("dev-ben");
  // (Ben hands the controls to Ana: the console follows the craft)
  R.model.selected = 3;
  let told = -1;
  R.model.handedTo = (slot) => (told = slot);
  R.emit("event", { from: 3, ev: { kind: "helm", to: 1, st: {} } });
  expect(R.model.selected).toBe(1);
  expect(told).toBe(1);
});

test("the events under the server's limit: a snapshot lightened, a longer event kept back and counted", () => {
  const big = {
    v: 1 as const,
    t: 1,
    body: "earth",
    metrics: {},
    geo: null,
    radar: null,
    route: [],
    ahead: [],
    traffic: Array.from({ length: 128 }, (_, i) => ({
      id: `t:${i}`.padEnd(30, "x"),
      name: "AIRLINER".padEnd(30, "y"),
      kind: "air" as const,
      side: "traffic",
      lat: 45.12345,
      lon: 6.12345,
      alt: 10000,
      hdg: 1.234,
      spd: 230,
      type: "A320 SOL".padEnd(16, "z"),
    })),
  };
  const f = fitSnapshot(big);
  expect(JSON.stringify({ type: "event", ev: { kind: "instruments", data: f.data } }).length).toBeLessThan(EVENT_MAX);
  expect(f.cut[0]).toBe("traffic/2");
  const n = new NetClient({ url: "ws://localhost:1/net", build: "t", id: { device: "d", name: "n", colour: "#fff" } });
  (n as unknown as { room: unknown }).room = { code: "ABCDEF", slot: 0, members: [] };
  expect(n.event({ kind: "x", data: "a".repeat(20_000) } as never)).toBe(false);
  expect(n.sent.oversize).toBe(1);
  expect(n.sent.lastOversize).toBe("x");
  n.close();
});
