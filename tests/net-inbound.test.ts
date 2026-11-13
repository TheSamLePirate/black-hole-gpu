import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createRooms, type Rooms } from "../server/rooms";
import { DEFAULT_RULES, type Match } from "../src/game/match";
import { NetClient } from "../src/net/client";
import { READ_KINDS, readEvent } from "../src/net/inbound";
import { type CraftSample, decodeCraft, emptyVisual, encodeCraft, MSG_KEEP } from "../src/net/proto";

// The network's input boundary (PLAN-RESEAU-DURCISSEMENT RD1; audit NET-01, NET-06, NET-07): each kind the game keeps
// and reads every frame read field by field — the shapes the game sends accepted, the malformed refused —; samples
// finite and bounded; a direct link's slot stamped by the receiver; the server neither passing on nor replaying what
// is not one; a listener that throws counted, not thrown. (The image kept drawing: tests/e2e/net-inbound.)

const match = (): Match => ({
  id: "0-12",
  mode: "ffa",
  def: "arena",
  host: 0,
  start: 20,
  rules: { ...DEFAULT_RULES },
  pilots: [0, 1],
  teams: {},
});

/** the game's own shapes (netmatch.ts, netsession.ts, main.ts), and malformed ones of each kind read */
const GOOD: Record<string, Record<string, unknown>[]> = {
  match: [
    { kind: "match", m: match() },
    { kind: "match", m: { ...match(), mode: "teams", teams: { 0: 0, 1: 1 } } },
  ],
  matchEnd: [{ kind: "matchEnd", id: "0-12", ranking: [{ slot: 0, name: "Ana", line: "3 kills" }] }, { kind: "matchEnd" }],
  cs: [
    {
      kind: "cs",
      s: { ms: [[3, "aim120", 1, 2, 3, 4, 5, 6, "s1", 0]], ai: [[1, 0, 0, 0, 1, 1, 1, 0, 0, 1, 0, 1, 0, 1]], o: [0, 0, 100] },
    },
    { kind: "cs", s: { ms: [] } },
  ],
  dock: [
    {
      kind: "dock",
      to: 1,
      port: 0,
      ownPort: 1,
      c: [0, 0, 12.5],
      ax: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    },
  ],
  tel: [{ kind: "tel", v: { fuel: 2500, thr: 0.8, eng: 0.79, gear: 1, flaps: 0.5, brake: 0, tau: 1 } }],
  bump: [{ kind: "bump", to: 1, dv: [0.01, -0.02, 0] }],
  board: [
    { kind: "board", to: 1 },
    { kind: "board", to: 1, gone: true },
  ],
  wingCrash: [
    { kind: "wingCrash", k: 2, p: [1, 2, 3], broke: true },
    { kind: "wingCrash", k: 1 },
  ],
  hit: [
    { kind: "hit", to: 1, dmg: 12.5, by: "aim120" },
    { kind: "hit", to: -2, dmg: 3, by: "gun", ai: true },
    { kind: "hit", dmg: 1 },
  ],
  hitWing: [{ kind: "hitWing", to: 1, k: 2, dmg: 4, by: "gun" }],
  down: [
    { kind: "down", slot: 1, by: null, weapon: "" },
    { kind: "down", slot: 1, by: 0, weapon: "aim9x", with: 0 },
  ],
  crash: [{ kind: "crash", why: "F-35: broke up under 12 g", with: null }],
};
const BAD: Record<string, Record<string, unknown>[]> = {
  match: [
    { kind: "match", m: { id: "x" } },
    { kind: "match", m: { ...match(), rules: { ...DEFAULT_RULES, limit: "300" } } },
  ],
  matchEnd: [
    { kind: "matchEnd", ranking: "first" },
    { kind: "matchEnd", ranking: [{ slot: 999, name: "x", line: "" }] },
  ],
  cs: [
    { kind: "cs", s: {} },
    { kind: "cs", s: { ms: [[3, "aim120", 1, 2, 3, 4, 5, Number.NaN, "s1", 0]] } },
  ],
  dock: [{ kind: "dock", to: 1, port: 0, ownPort: 0 }],
  tel: [
    { kind: "tel", v: { tau: "0" } },
    { kind: "tel", v: { tau: null } },
  ],
  bump: [
    { kind: "bump", to: 1, dv: [Number.NaN, 0, 0] },
    { kind: "bump", to: 1, dv: [1, 2] },
  ],
  board: [{ kind: "board", to: "all" }],
  wingCrash: [{ kind: "wingCrash", k: 1, p: [1, 2] }],
  hit: [{ kind: "hit", to: 1, dmg: "lots" }],
  hitWing: [{ kind: "hitWing", to: 1, dmg: 1e9 }],
  down: [{ kind: "down", slot: "me" }],
  crash: [{ kind: "crash", why: "x".repeat(1000) }],
};

test("every kind read field by field: the game's own shapes taken, the malformed refused", () => {
  expect(Object.keys(GOOD).sort()).toEqual([...READ_KINDS].sort());
  expect(Object.keys(BAD).sort()).toEqual([...READ_KINDS].sort());
  for (const k of READ_KINDS) {
    for (const e of GOOD[k]!) expect([k, readEvent(JSON.parse(JSON.stringify(e)))]).toEqual([k, e as never]);
    for (const e of BAD[k]!) expect([k, readEvent(JSON.parse(JSON.stringify(e)))]).toEqual([k, null]);
  }
});

test("the envelope: an object, a short kind, a `to` that is a slot (or an AI wingman's −index)", () => {
  for (const x of [null, 3, "match", [], { kind: 7 }, { kind: "" }, { kind: "a b" }, { kind: "x".repeat(40) }, { kind: "ping", to: 1e9 }])
    expect(readEvent(x)).toBeNull();
  // (a kind not read field by field: its envelope only — its listener reads it with its own guards)
  expect(readEvent({ kind: "crew-cmd", v: 1, to: 0, cmd: { id: "x" } })).not.toBeNull();
  expect(readEvent({ kind: "radio", role: "lso", text: "Call the ball" })).not.toBeNull();
});

const sample = (o: Partial<CraftSample> = {}): CraftSample => ({
  slot: 1,
  seq: 1,
  t: 100,
  frame: 0,
  body: 0,
  kind: 3,
  flags: 0,
  p: [6.4e6, 0, 0],
  v: [200, 0, 0],
  q: [0, 0, 0, 1],
  w: [0, 0, 0],
  a: [0, 0, 0],
  vis: emptyVisual(),
  ...o,
});

test("a sample: finite and bounded, or none (NaN, infinity, a place beyond 70 AU, a speed past light's, a kind unknown)", () => {
  expect(decodeCraft(encodeCraft(sample()))).not.toBeNull();
  for (const bad of [
    { t: Number.NaN },
    { t: Number.POSITIVE_INFINITY },
    { p: [Number.NaN, 0, 0] as [number, number, number] },
    { p: [1e14, 0, 0] as [number, number, number] },
    { v: [4e8, 0, 0] as [number, number, number] },
    { kind: 99 },
    { frame: 7 },
  ])
    expect(decodeCraft(encodeCraft(sample(bad)))).toBeNull();
  // (a kept sample — MSG_KEEP — read as well by the server's check, not by a client's)
  const k = new Uint8Array(encodeCraft(sample()));
  k[0] = MSG_KEEP;
  expect(decodeCraft(k)).toBeNull();
  expect(decodeCraft(k, true)).not.toBeNull();
});

describe("the client and the server at the boundary", () => {
  let rooms: Rooms;
  let server: ReturnType<typeof Bun.serve>;
  let url = "";
  beforeAll(() => {
    rooms = createRooms({ db: ":memory:", build: "test" });
    server = Bun.serve({ port: 0, fetch: (req, srv) => rooms.upgrade(req, srv as never), websocket: rooms.websocket });
    url = `ws://127.0.0.1:${server.port}/`;
  });
  afterAll(() => {
    rooms.close();
    server.stop(true);
  });
  const client = (name: string) => new NetClient({ url, build: "test", id: { device: `${name}-dev`, name, colour: "#ff8800" } });
  const until = async (f: () => boolean, ms = 3000) => {
    const t0 = Date.now();
    while (!f()) {
      if (Date.now() - t0 > ms) throw new Error("timeout");
      await Bun.sleep(10);
    }
  };

  test("the server: a malformed event neither passed on nor replayed to a newcomer; a good match replayed", async () => {
    const a = client("Ana");
    const b = client("Ben");
    const { code } = await a.create("Boundary", 0);
    await b.join(code);
    const got: string[] = [];
    a.on("event", ({ ev }) => got.push(ev.kind));
    (b as unknown as { link: { send(s: string): void } }).link.send(
      JSON.stringify({ type: "event", ev: { kind: "match", m: { id: "x" } } }),
    );
    b.event({ kind: "tel", v: { fuel: 1 } });
    await until(() => got.includes("tel"));
    expect(got).toEqual(["tel"]);
    const c = client("Cid");
    const late: string[] = [];
    c.on("event", ({ ev }) => late.push(ev.kind));
    await c.join(code, "spectator");
    await Bun.sleep(200);
    expect(late).not.toContain("match");
    expect(rooms.health().rejected).toBeGreaterThanOrEqual(1);
    // (a match as the game says it: passed on, and kept for the next newcomer)
    b.event({ kind: "match", m: { ...match(), host: 1 } });
    await until(() => got.includes("match"));
    const d = client("Dan");
    const later: string[] = [];
    d.on("event", ({ ev }) => later.push(ev.kind));
    await d.join(code, "spectator");
    await until(() => later.includes("match"));
    for (const x of [a, b, c, d]) x.close();
  });

  test("the client: a listener that throws counted, the others still heard; a sample of NaN dropped by the server", async () => {
    const a = client("Eve");
    const b = client("Fay");
    const { code } = await a.create("Listeners", 0);
    await b.join(code);
    await until(() => a.clock.synced && b.clock.synced);
    const heard: string[] = [];
    a.on("event", () => {
      throw new Error("a listener's bug");
    });
    a.on("event", ({ ev }) => heard.push(ev.kind));
    b.event({ kind: "radio", role: "lso", text: "Roger ball" });
    await until(() => heard.length === 1);
    expect(a.inbound.failed).toBe(1);
    expect(a.inbound.lastFailure).toMatch(/radio: a listener's bug/);
    // (b's sample with a NaN place, sent raw: the server drops it — nothing reaches a)
    const raw = new Uint8Array(encodeCraft(sample({ slot: b.room!.slot, t: b.roomNow(), p: [Number.NaN, 0, 0] })));
    (b as unknown as { link: { send(x: ArrayBuffer): void } }).link.send(raw.buffer);
    b.sendCraft({ ...sample(), t: b.roomNow() });
    await until(() => a.remotes.tracks.size === 1);
    const tr = [...a.remotes.tracks.values()][0]!;
    expect(tr.samples.every((s) => s.p.every(Number.isFinite))).toBe(true);
    a.close();
    b.close();
  });

  test("a direct link's sample stamped with the link's slot; a time far from the room's, or a stranger's slot, dropped", async () => {
    const a = client("Gus");
    const b = client("Hal");
    const { code } = await a.create("Links", 0);
    await b.join(code);
    await until(() => a.clock.synced && a.room!.members.length === 2);
    const A = a as unknown as { onPeerData(buf: ArrayBuffer, slot: number): void };
    const bSlot = b.room!.slot;
    // (a peer writing another's slot — 0, Ana's own, or 7, nobody's — in its sample: taken as its own link's)
    A.onPeerData(encodeCraft(sample({ slot: 7, t: a.roomNow() })), bSlot);
    expect([...a.remotes.tracks.values()].map((t) => t.slot)).toEqual([bSlot]);
    // (a time an hour ahead of the room's: dropped — before, it kept every later sample out as "late")
    const n = a.inbound.samplesRejected;
    A.onPeerData(encodeCraft(sample({ t: a.roomNow() + 3600 })), bSlot);
    // (a link from a slot that is not a member)
    A.onPeerData(encodeCraft(sample({ t: a.roomNow() })), 9);
    expect(a.inbound.samplesRejected).toBe(n + 2);
    a.close();
    b.close();
  });
});

test("a page of another protocol version: refused at once, said — not left waiting", async () => {
  const { WsLink } = await import("../src/net/transport");
  const rooms = createRooms({ db: ":memory:", build: "test" });
  const server = Bun.serve({ port: 0, fetch: (req, srv) => rooms.upgrade(req, srv as never), websocket: rooms.websocket });
  // (the hello rewritten as a page of a later protocol would send it)
  const link = (u: string) => {
    const L = new WsLink(u);
    const send = L.send.bind(L);
    L.send = (m) => send(typeof m === "string" && m.includes('"hello"') ? m.replace(/"v":\d+/, '"v":99') : m);
    return L;
  };
  const c = new NetClient({
    url: `ws://127.0.0.1:${server.port}/`,
    build: "test",
    id: { device: "old", name: "Old", colour: "#888888" },
    link,
  });
  const out = await Promise.race([
    c.connect().then(
      () => "welcomed",
      (e: Error & { code?: string }) => `refused: ${e.code}`,
    ),
    Bun.sleep(3000).then(() => "still waiting"),
  ]);
  expect(out).toBe("refused: update");
  c.close();
  rooms.close();
  server.stop(true);
});
