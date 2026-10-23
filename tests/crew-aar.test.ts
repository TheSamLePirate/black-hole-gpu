import { expect, test } from "bun:test";
import { readInstruments } from "../src/net/instruments";
import { readCrewCmd, sayOf } from "../src/net/crewcmd";
import { CrewExec } from "../src/ui/crew-exec";

// The air refuelling at the crew (docs/CREW.md): the `aar` block of the instruments, read bounded; the orders that set
// TEXACO, change the way it is flown and let it go — jet_mode's, through the crew's own act.

test("the aar block: read bounded, an older pilot's none, nothing invented", () => {
  const s = readInstruments({
    v: 1,
    t: 1,
    metrics: {},
    route: [],
    ahead: [],
    aar: {
      stage: "hose",
      phase: "FUEL FLOW and a very long word beyond",
      mode: "warp",
      tanker: "TEXACO 11",
      side: "left",
      given: 412.5,
      want: 1500,
      practice: false,
      along: -2.7,
      off: 0.2,
      closure: NaN,
      takeup: 2.4,
      flow: [0.9, 4.6],
      whip: 6.5,
      lights: "green",
      contacts: 1,
      misses: 2,
      dist: 30,
    },
  })!;
  expect(s.aar).toMatchObject({ stage: "hose", side: "left", given: 412.5, takeup: 2.4, lights: "green", misses: 2 });
  expect(s.aar!.phase.length).toBeLessThanOrEqual(16);
  expect(s.aar!.mode).toBe("manual");
  expect(s.aar!.closure).toBeNull();
  expect(readInstruments({ v: 1, t: 1, metrics: {}, route: [], ahead: [] })!.aar).toBeUndefined();
  expect(readInstruments({ v: 1, t: 1, metrics: {}, aar: { given: "x" } })!.aar).toBeNull();
});

test("ap.mode accepts the tanker, its side and the way it is flown; refuses what jet_mode would not", () => {
  const ok = readCrewCmd({
    v: 1,
    id: "a",
    to: 0,
    act: "ap.mode",
    args: { mode: "tanker", side: "left", near: true, refuelMode: "assisted" },
  });
  expect(ok.ok).toBe(true);
  expect(readCrewCmd({ v: 1, id: "b", to: 0, act: "ap.mode", args: { mode: "refuelMode", refuelMode: "auto" } }).ok).toBe(true);
  expect(readCrewCmd({ v: 1, id: "c", to: 0, act: "ap.mode", args: { mode: "tankerOff" } }).ok).toBe(true);
  expect(readCrewCmd({ v: 1, id: "d", to: 0, act: "ap.mode", args: { mode: "tanker", side: "up" } }).ok).toBe(false);
  expect(readCrewCmd({ v: 1, id: "e", to: 0, act: "ap.mode", args: { mode: "refuelMode", refuelMode: "warp" } }).ok).toBe(false);
  expect(sayOf("ap.mode", { mode: "tanker", side: "left", refuelMode: "auto" })).toEqual({
    fr: "ravitailleur TEXACO, tuyau gauche — automatique",
    en: "tanker TEXACO, left hose — automatic",
  });
});

function rig(camera: Record<string, unknown>) {
  const sent: Record<string, unknown>[] = [];
  const ran: { name: string; args: Record<string, unknown> }[] = [];
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
  const tool = {
    name: "jet_mode",
    description: "",
    params: {
      action: { type: "string", enum: ["orbit", "hold", "tf", "tanker", "refuelMode", "off"] },
      near: { type: "boolean" },
      side: { type: "string", enum: ["right", "left"] },
      refuelMode: { type: "string", enum: ["auto", "assisted", "manual"] },
    },
    required: ["action"],
    run: async (a: Record<string, unknown>) => (ran.push({ name: "jet_mode", args: a }), "Tanker: TEXACO 11"),
  };
  const exec = new CrewExec({
    camera: camera as never,
    settings: {} as never,
    tools: () => [tool as never],
    toast: () => {},
    nameOf: () => "Ben",
    families: () => ["jet"] as never,
  });
  return { exec, net: net as never, sent, ran };
}

test("the executor: the tanker always asked with its side (never jet_mode's toggle), let go alone", async () => {
  const cam = { aar: null as unknown, tankerPending: null as number | null, icpt: null, aarOff: () => (cam.aar = null) };
  const r = rig(cam);
  await r.exec.handle(r.net, 2, { kind: "crew-cmd", v: 1, id: "t", to: 0, act: "ap.mode", args: { mode: "tanker" } });
  expect(r.ran[0]).toEqual({ name: "jet_mode", args: { action: "tanker", side: "right" } });
  expect(r.sent[0]).toMatchObject({ ok: true });
  // (let go with none engaged: refused)
  await r.exec.handle(r.net, 2, { kind: "crew-cmd", v: 1, id: "u", to: 0, act: "ap.mode", args: { mode: "tankerOff" } });
  expect(r.sent[1]).toMatchObject({ ok: false });
  // (engaged: let go — the orbit and the terrain following untouched: jet_mode's off never called)
  cam.aar = { mode: "auto" };
  await r.exec.handle(r.net, 2, { kind: "crew-cmd", v: 1, id: "v", to: 0, act: "ap.mode", args: { mode: "tankerOff" } });
  expect(r.sent[2]).toMatchObject({ ok: true });
  expect(cam.aar).toBeNull();
  expect(r.ran).toHaveLength(1);
});
