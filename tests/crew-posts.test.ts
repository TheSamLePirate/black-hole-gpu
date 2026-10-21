import { expect, test } from "bun:test";
import { CrewActions } from "../src/crew/actions";
import { CrewModel } from "../src/crew/model";
import { linkFor, stationOf } from "../src/crew/station";
import { CrewExec } from "../src/ui/crew-exec";

// The crew's stations (AUDIT-CREW priority 6): aboard on the pilot's agreement — before it, or refused, on the ground
// (the light's time, the link cut behind the wormhole) —; the pilot holds the ground's orders himself (a console cannot
// slip the delay); behind the wormhole, refused. Every station may order everything (the user's choice).

/** a room: the pilot Ana (slot 1), this console (slot 5); its events heard, what it sends kept */
function room() {
  const L = new Map<string, ((x: unknown) => void)[]>();
  const sent: { at: number; ev: Record<string, unknown> }[] = [];
  const net = {
    room: {
      code: "ABCDEF",
      slot: 5,
      members: [
        { slot: 1, role: "pilot", name: "Ana", device: "a", colour: "#fff" },
        { slot: 5, role: "instruments", name: "Ben", device: "b", colour: "#fff" },
      ],
    },
    on: (k: string, f: (x: unknown) => void) => L.set(k, [...(L.get(k) ?? []), f]),
    roomNow: () => 100,
    event: (ev: Record<string, unknown>) => (sent.push({ at: performance.now(), ev }), true),
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
  model.selected = 1;
  return { model, emit, sent, net };
}
const snap = (caps: Record<string, unknown>, link = { light: 1.3, delay: 1.3, cut: false }) => ({
  kind: "instruments",
  data: { v: 1, t: 1, body: "moon", metrics: {}, route: [], ahead: [], caps: { on: true, fam: ["space"], ...caps }, link },
});

test("aboard on the pilot's agreement: before it on the ground (the light's time), live once accepted", () => {
  const copilot = stationOf("copilot");
  expect(linkFor(copilot, { light: 1.3, delay: 1.3, cut: false })).toEqual({ delay: 0, cut: false });
  expect(linkFor(copilot, { light: 1.3, delay: 1.3, cut: false }, false)).toEqual({ delay: 1.3, cut: false });
  expect(linkFor(copilot, { light: 0, cut: true }, false)).toEqual({ delay: 0, cut: true });
  const R = room();
  R.model.linkFor = (link, accepted) => linkFor(copilot, link, accepted);
  // (a pilot who asks for the agreement — hold —, this screen not taken aboard yet: on the ground)
  R.emit("event", { from: 1, ev: snap({ hold: true, aboard: [] }) });
  expect(R.model.holds(1)).toBe(true);
  expect(R.model.aboardWith(1)).toBe(false);
  expect(R.model.linkOf(1)).toEqual({ delay: 1.3, cut: false });
  // (accepted: live)
  R.emit("event", { from: 1, ev: snap({ hold: true, aboard: [5] }) });
  expect(R.model.aboardWith(1)).toBe(true);
  expect(R.model.linkOf(1)).toEqual({ delay: 0, cut: false });
  // (an older pilot, who asks for none: aboard as chosen)
  const old = room();
  old.emit("event", { from: 1, ev: snap({}) });
  expect(old.model.aboardWith(1)).toBe(true);
});

test("a pilot who holds the ground's orders: the console sends at once (he waits the light's time himself)", async () => {
  const R = room();
  const fido = stationOf("fido");
  R.model.linkFor = (link, accepted) => linkFor(fido, link, accepted);
  // (the ground sees the pilot's snapshot the light's time late: its caps once it has come)
  R.emit("event", { from: 1, ev: snap({ hold: true, aboard: [] }, { light: 0.3, delay: 0.3, cut: false }) });
  await Bun.sleep(350);
  R.model.crafts();
  const A = new CrewActions(R.net as never, R.model);
  const t0 = performance.now();
  void A.send("sp.hold", { direction: "prograde" });
  await Bun.sleep(20);
  const cmd = R.sent.find((s) => s.ev.kind === "crew-cmd");
  expect(cmd).toBeTruthy();
  expect(cmd!.at - t0).toBeLessThan(15);
  // (an older pilot: delayed here, the light's time)
  const old = room();
  old.model.linkFor = (link, accepted) => linkFor(fido, link, accepted);
  old.emit("event", { from: 1, ev: snap({}, { light: 0.3, delay: 0.3, cut: false }) });
  await Bun.sleep(350);
  old.model.crafts();
  const B = new CrewActions(old.net as never, old.model);
  void B.send("sp.hold", { direction: "prograde" });
  await Bun.sleep(50);
  expect(old.sent.some((s) => s.ev.kind === "crew-cmd")).toBe(false);
  await Bun.sleep(320);
  expect(old.sent.some((s) => s.ev.kind === "crew-cmd")).toBe(true);
});

test("behind the wormhole a ground station's order is refused by the pilot, in the console's language", () => {
  const sent: Record<string, unknown>[] = [];
  const net = { room: { slot: 1, role: "pilot", members: [] }, event: (e: Record<string, unknown>) => sent.push(e) };
  const exec = new CrewExec({
    camera: {} as never,
    settings: {} as never,
    tools: () => [],
    toast: () => {},
    nameOf: () => "Ben",
    families: () => ["space"] as never,
  });
  exec.refuseCut(net as never, 5, { kind: "crew-cmd", v: 1, id: "x", to: 1, act: "sp.hold", args: {}, lang: "en" });
  expect(sent[0]).toMatchObject({ kind: "crew-ack", id: "x", to: 5, ok: false, msg: "Link cut (wormhole): record a message" });
  exec.refuseCut(net as never, 5, { kind: "crew-cmd", v: 1, id: "y", to: 1, act: "sp.hold", args: {} });
  expect(String(sent[1]!.msg)).toMatch(/Liaison coupée/);
});
