// The crew's orders (docs/PLAN-CREW-ACTIONS.md): the contract read as untrusted, the pace, nothing that flies, and the
// executor's gates — the sender a crew screen, the order ours, the pilot's lock, the family open, the answer said.
import { expect, test } from "bun:test";
import { ACTS, CrewGate, FAMILIES, NEVER, readCrewAck, readCrewCmd } from "../src/net/crewcmd";
import { CrewExec } from "../src/ui/crew-exec";
import type { Tool } from "../src/ai/agent";

test("an order is read as untrusted: its shape, its act, its arguments against the act's schema", () => {
  expect(readCrewCmd(null).ok).toBe(false);
  expect(readCrewCmd({ v: 2, id: "a", to: 1, act: "cfg.ack" }).ok).toBe(false);
  expect(readCrewCmd({ v: 1, id: "x".repeat(41), to: 1, act: "cfg.ack" }).ok).toBe(false);
  const unknown = readCrewCmd({ v: 1, id: "a", to: 1, act: "press_key", args: {} });
  expect(unknown.ok).toBe(false);
  expect(!unknown.ok && unknown.id).toBe("a");
  expect(readCrewCmd({ v: 1, id: "a", to: 1, act: "cfg.ack", args: { throttle: 1 } }).ok).toBe(false);
  expect(readCrewCmd({ v: 1, id: "a", to: 1.5, act: "cfg.ack" }).ok).toBe(false);
  const ok = readCrewCmd({ v: 1, id: "a", to: 1, act: "cfg.ack", args: {} });
  expect(ok.ok && ok.cmd.act).toBe("cfg.ack");
  expect(readCrewAck({ v: 1, id: "a", to: 2, ok: true, act: "cfg.ack", msg: "x".repeat(500), what: "y" })?.msg.length).toBe(200);
  expect(readCrewAck({ v: 1, id: "a", to: "2", ok: true })).toBeNull();
});

test("a sender's pace: a burst, then four a second; each order once", () => {
  const g = new CrewGate(4);
  const r = Array.from({ length: 10 }, (_, i) => g.pass(3, `o${i}`, 1000));
  expect(r.filter((x) => x === "ok")).toHaveLength(8);
  expect(r.at(-1)).toBe("rate");
  expect(g.pass(3, "o0", 5000)).toBe("again");
  expect(g.pass(3, "n1", 5000)).toBe("ok");
  // (another sender: his own pace)
  expect(g.pass(4, "o0", 1000)).toBe("ok");
});

test("nothing in the catalogue nor the executor flies the craft", async () => {
  for (const [act, spec] of Object.entries(ACTS)) {
    expect(FAMILIES).toContain(spec.fam);
    for (const bad of NEVER) {
      expect(act.toLowerCase()).not.toContain(bad.toLowerCase());
      expect(Object.keys((spec as { params?: object }).params ?? {})).not.toContain(bad);
    }
  }
  const src = await Bun.file("src/ui/crew-exec.ts").text();
  const tools = [...src.matchAll(/x\.tool\("([a-z_]+)"/g)].map((m) => m[1]!);
  for (const t of [
    "press_key",
    "set_craft",
    "place_ship",
    "set_mode",
    "time",
    "set_date",
    "saves",
    "start_scene",
    "set_settings",
    "character",
    "carrier",
    "mission",
  ])
    expect(tools).not.toContain(t);
  // (the controls tool reached for its switches only — never the throttle, the flight mode, the assistance)
  expect(src).not.toMatch(/throttle\s*:/);
  expect(src).not.toMatch(/flightMode\s*:/);
});

/** a pilot's room, an executor and what it said */
function rig(o: { lock?: boolean; fams?: string[]; role?: string } = {}) {
  const sent: Record<string, unknown>[] = [];
  const toasts: string[] = [];
  const ran: { name: string; args: unknown }[] = [];
  const net = {
    room: {
      slot: 0,
      role: "pilot",
      members: [
        { slot: 0, name: "Ana", role: "pilot" },
        { slot: 2, name: "Ben", role: o.role ?? "instruments" },
        { slot: 3, name: "Cy", role: "pilot" },
      ],
    },
    event: (ev: Record<string, unknown>) => sent.push(ev),
  };
  const tool = (name: string): Tool => ({
    name,
    description: "",
    params: { action: { type: "string" } },
    run: (args) => {
      ran.push({ name, args });
      return "Master caution silenced";
    },
  });
  const exec = new CrewExec({
    camera: {} as never,
    settings: { netCrewActions: o.lock !== true } as never,
    tools: () => [tool("flight_action")],
    toast: (s) => toasts.push(s),
    nameOf: (s) => net.room.members.find((m) => m.slot === s)?.name ?? "?",
    families: () => (o.fams ?? ["config"]) as never,
  });
  return { exec, net: net as never, sent, toasts, ran };
}
const order = (id: string, to = 0) => ({ kind: "crew-cmd", v: 1, id, to, act: "cfg.ack", args: {} });

test("the executor: a crew screen's order for us, done through the game's tool, said and answered", async () => {
  const r = rig();
  await r.exec.handle(r.net, 2, order("a"));
  expect(r.ran).toEqual([{ name: "flight_action", args: { action: "acknowledge" } }]);
  expect(r.toasts[0]).toContain("Ben");
  expect(r.sent[0]).toMatchObject({ kind: "crew-ack", id: "a", to: 2, ok: true, act: "cfg.ack" });
  // (the same order again: ignored)
  await r.exec.handle(r.net, 2, order("a"));
  expect(r.ran).toHaveLength(1);
  // (meant for another pilot: not answered)
  await r.exec.handle(r.net, 2, order("b", 3));
  expect(r.sent).toHaveLength(1);
});

test("the executor's refusals: another pilot, the pilot's lock, a family closed, a malformed order", async () => {
  const fromPilot = rig();
  await fromPilot.exec.handle(fromPilot.net, 3, order("a"));
  expect(fromPilot.sent[0]).toMatchObject({ ok: false });
  expect(fromPilot.ran).toHaveLength(0);
  const locked = rig({ lock: true });
  await locked.exec.handle(locked.net, 2, order("a"));
  expect(locked.sent[0]).toMatchObject({ ok: false });
  expect(String(locked.sent[0]!.msg)).toMatch(/verrouill/i);
  expect(locked.ran).toHaveLength(0);
  const closed = rig({ fams: ["nav"] });
  await closed.exec.handle(closed.net, 2, order("a"));
  expect(closed.sent[0]).toMatchObject({ ok: false });
  const bad = rig();
  await bad.exec.handle(bad.net, 2, { ...order("z"), args: { nope: 1 } });
  expect(bad.sent[0]).toMatchObject({ ok: false, id: "z" });
  expect(bad.ran).toHaveLength(0);
});

test("the ND's touch back to the Earth: WGS84's direct problem, the inverse's own answer within centimetres", async () => {
  const { wgs84Direct, wgs84Inverse } = await import("../src/system/ellipsoid");
  for (const [lat, lon, azDeg, d] of [
    [48.85, 2.35, 135, 50_000],
    [45.8, 6.75, 10, 300_000],
    [-33.9, 151.2, 270, 1_200_000],
    [70, -20, 45, 80_000],
  ] as const) {
    const q = wgs84Direct(lat, lon, (azDeg * Math.PI) / 180, d);
    const back = wgs84Inverse(lat, lon, q.lat, q.lon);
    expect(Math.abs(back.d - d)).toBeLessThan(0.05);
    const dAz = back.az - (azDeg * Math.PI) / 180;
    expect(Math.abs(Math.atan2(Math.sin(dAz), Math.cos(dAz)))).toBeLessThan(1e-7);
  }
});

test("the flight plan's acts map to the plan's tool or the controller's point editing, never the autopilot's engage", async () => {
  const src = await Bun.file("src/ui/crew-exec.ts").text();
  for (const a of ["nav.add", "nav.remove", "nav.clear", "nav.cruise", "nav.direct"]) expect(src).toContain(`"${a}": `);
  expect(src).toContain("routeSetPoint");
  // (LNAV/VNAV engaged belongs to the autopilot's family, not the plan's)
  const navLines = src.split("\n").filter((l) => l.includes('"nav.'));
  for (const l of navLines) expect(l).not.toMatch(/lnav|vnav/);
});

test("station keeping from the crew: engaged, kept, never an undocking — docked, refused and said why", async () => {
  const { installStationKeep } = await import("../src/controller/stationkeep");
  const P = {} as { keepHold(this: unknown): string | null };
  installStationKeep({ prototype: P as never });
  const pilot = {
    auto: "none",
    setAuto(a: string) {
      pilot.auto = pilot.auto === a ? "none" : a;
    },
  };
  let undocked = 0;
  const craft = { docked: false, netDocked: false, keepRun: null, pilot, undock: () => undocked++, keepKey: () => undocked++ };
  expect(P.keepHold.call(craft)).toBeTruthy();
  expect(pilot.auto).toBe("keep");
  // (asked again: kept, not toggled off as ⇧8 would)
  P.keepHold.call(craft);
  expect(pilot.auto).toBe("keep");
  craft.docked = true;
  expect(P.keepHold.call(craft)).toBeNull();
  // (through the executor: refused with its reason, nothing undocked)
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
    camera: { ...craft, keepHold: () => P.keepHold.call(craft) } as never,
    settings: {} as never,
    tools: () => [],
    toast: () => {},
    nameOf: () => "Ben",
    families: () => ["space"] as never,
  });
  await exec.handle(net as never, 2, { kind: "crew-cmd", v: 1, id: "k", to: 0, act: "sp.dock", args: { action: "keep" } });
  expect(sent[0]).toMatchObject({ ok: false, act: "sp.dock" });
  expect(String(sent[0]!.msg)).toMatch(/Désamarrer d'abord/);
  expect(undocked).toBe(0);
});

test("an order's words in the reader's units: the MCP's selections in metres or feet", async () => {
  const { sayOf } = await import("../src/net/crewcmd");
  const { unitsOf } = await import("../src/ui/unitsys");
  expect(sayOf("ap.set", { alt: 3000, spd: 200 }).fr).toBe("consigne ALT 3000 m · VIT 200 m/s");
  expect(sayOf("ap.set", { alt: 3048, spd: 100 }, unitsOf("imperial")).fr).toBe("consigne ALT 10000 ft · VIT 194 kt");
});
