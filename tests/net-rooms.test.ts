import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createRooms, type Rooms } from "../server/rooms";
import { NetClient } from "../src/net/client";
import { emptyVisual } from "../src/net/proto";

// PLAN-RESEAU R0: the room server for real (a Bun server, real WebSockets): rooms created, joined, their
// members and limits, the samples passed on, a reconnection taking its slot back, the owner's delete, the
// rooms kept across a restart.

let rooms: Rooms;
let server: ReturnType<typeof Bun.serve>;
let url = "";
const file = `/tmp/kerr-rooms-${process.pid}.sqlite`;

const start = () => {
  rooms = createRooms({ db: file, build: "test" });
  server = Bun.serve({
    port: 0,
    fetch: (req, srv) => rooms.upgrade(req, srv as never),
    websocket: rooms.websocket,
  });
  url = `ws://127.0.0.1:${server.port}/`;
};
const stop = () => {
  rooms.close();
  server.stop(true);
};
const client = (name: string, device = name) => new NetClient({ url, build: "test", id: { device, name, colour: "#ff8800" } });
/** the message a request failed with ("" if it did not) — (bun:test's rejects dropped another page's link) */
const failure = (p: Promise<unknown>) => p.then(() => "").catch((e: Error) => e.message);
const until = async (f: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await Bun.sleep(10);
  }
};

describe("the room server", () => {
  beforeAll(start);
  afterAll(async () => {
    stop();
    await Bun.$`rm -f ${file} ${file}-wal ${file}-shm`.nothrow();
  });

  test("create, join, the roster on both; the clock synced; leave", async () => {
    const a = client("Ana");
    const b = client("Ben");
    const { code, owner, room } = await a.create("Patrol", 1000);
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(owner.length).toBe(64);
    expect(room.slot).toBe(0);
    const rb = await b.join(code.toLowerCase());
    expect(rb.slot).toBe(1);
    await until(() => a.room?.members.length === 2);
    expect(a.room!.members.map((m) => m.name).sort()).toEqual(["Ana", "Ben"]);
    await until(() => a.clock.synced && b.clock.synced);
    // (one machine: the two pages read the same room time)
    expect(Math.abs(a.roomNow() - b.roomNow())).toBeLessThan(0.005);
    expect(a.roomNow()).toBeGreaterThanOrEqual(1000);
    b.leave();
    await until(() => a.room?.members.length === 1);
    a.close();
    b.close();
  });

  test("the room's warp (R6): a slowdown at once for all, a speed-up only once every pilot asks for it", async () => {
    const a = client("Ana");
    const b = client("Ben");
    const c = client("Cid");
    const { code } = await a.create("Warp", 0);
    await b.join(code);
    await c.join(code, "spectator");
    await until(() => a.clock.synced && b.clock.synced && c.clock.synced);
    expect(a.room!.clock.warp).toBe(1);
    // (Ana asks ×100: Ben still asks ×1 — the room stays at ×1, her ask seen by all)
    a.warp(100);
    await until(() => b.room!.wants[0] === 100);
    expect(b.room!.clock.warp).toBe(1);
    // (Ben accepts: ×100 for all, the clock carried on from where it was — no jump)
    const before = b.roomNow();
    b.warp(100);
    await until(() => a.room!.clock.warp === 100 && c.room!.clock.warp === 100);
    expect(Math.abs(b.roomNow() - before)).toBeLessThan(5);
    await Bun.sleep(200);
    expect(Math.abs(a.roomNow() - b.roomNow())).toBeLessThan(0.5);
    // (Ben slows to ×10: at once for all; a spectator's ask counts for nothing)
    c.warp(1e6);
    b.warp(10);
    await until(() => a.room!.clock.warp === 10);
    // (Ben gone: Ana alone asks ×100 — the room at her pace)
    b.leave();
    await until(() => a.room!.clock.warp === 100);
    // (nobody left: the world runs on at ×1)
    a.leave();
    c.leave();
    await Bun.sleep(50);
    const d = client("Dan");
    const rd = await d.join(code);
    expect(rd.clock.warp).toBe(1);
    for (const x of [a, b, c, d]) x.close();
  });

  test("the persistent world (R7): a craft left where its pilot went, shown to the others; his again when he is back", async () => {
    const a = client("Ana", "dev-ana-world");
    const b = client("Ben", "dev-ben-world");
    const { code } = await a.create("World", 0);
    await b.join(code);
    await until(() => a.clock.synced && b.clock.synced);
    for (let k = 0; k < 5; k++) {
      a.sendCraft({
        frame: 1,
        body: 0,
        kind: 0,
        flags: 16,
        p: [6_771_000 + k, 0, 0],
        v: [0, 7672, 0],
        q: [0, 0, 0, 1],
        w: [0, 0, 0],
        a: [0, 0, 0],
        vis: emptyVisual(),
      });
      await Bun.sleep(30);
    }
    a.leave();
    await until(() => b.away.length === 1);
    expect(b.away[0]!.name).toBe("Ana");
    expect(b.away[0]!.sample.p[0]).toBeCloseTo(6_771_004, 0);
    expect(b.away[0]!.sample.frame).toBe(1);
    // (Ana back: her craft hers again — no longer away)
    await a.join(code);
    await until(() => !!a.mine && b.away.length === 0);
    expect(a.mine!.p[0]).toBeCloseTo(6_771_004, 0);
    a.close();
    b.close();
  });

  test("a craft's sample passed on to the others, its slot stamped; read back", async () => {
    const a = client("Ana");
    const b = client("Ben");
    const { code } = await a.create("Samples", 0);
    await b.join(code);
    await until(() => a.clock.synced && b.clock.synced);
    for (let k = 0; k < 10; k++) {
      a.sendCraft({
        frame: 0,
        body: 0,
        kind: 3,
        flags: 0,
        p: [k * 10, 0, 1000],
        v: [300, 0, 0],
        q: [0, 0, 0, 1],
        w: [0, 0, 0],
        a: [0, 0, 0],
        vis: emptyVisual(),
      });
      await Bun.sleep(33);
    }
    await until(() => (b.remotes.track(0)?.samples.length ?? 0) >= 9);
    expect(b.remotes.track(1)).toBeUndefined();
    const s = b.remotes.states(b.roomNow())[0]!;
    expect(s.slot).toBe(0);
    expect(s.kind).toBe(3);
    // (the sender's own samples never come back)
    expect(a.remotes.tracks.size).toBe(0);
    a.close();
    b.close();
  });

  test("limits: 4 pilots, 8 devices; the password", async () => {
    const owner = client("Own");
    const { code } = await owner.create("Full", 0, "secret");
    expect(await failure(client("X").join(code, "pilot", "nope"))).toMatch(/password/i);
    const pilots = [owner];
    for (let k = 0; k < 3; k++) {
      const c = client(`P${k}`);
      await c.join(code, "pilot", "secret");
      pilots.push(c);
    }
    expect(await failure(client("P4").join(code, "pilot", "secret"))).toMatch(/pilots/i);
    const spect: NetClient[] = [];
    for (let k = 0; k < 4; k++) {
      const c = client(`S${k}`);
      await c.join(code, "spectator", "secret");
      spect.push(c);
    }
    expect(await failure(client("S5").join(code, "spectator", "secret"))).toMatch(/full/i);
    for (const c of [...pilots, ...spect]) c.close();
  });

  test("the same device back takes its slot; the owner alone deletes", async () => {
    const a = client("Ana");
    const { code, owner } = await a.create("Back", 0);
    const b = client("Ben", "dev-ben");
    await b.join(code);
    const b2 = client("Ben again", "dev-ben");
    const r = await b2.join(code);
    expect(r.slot).toBe(1);
    await until(() => a.room?.members.length === 2 && a.room.members.some((m) => m.name === "Ben again"));
    expect(await failure(b2.remove(code, "0".repeat(64)))).toMatch(/owner/i);
    await a.remove(code, owner);
    await until(() => b2.room === null);
    expect(await failure(client("Late").join(code))).toMatch(/no such room/i);
    a.close();
    b.close();
    b2.close();
  });

  test("the room's light delay (AUDIT-CREW priority 6): its owner's alone, his token never passed on, told to newcomers", async () => {
    const a = client("Ana");
    const b = client("Ben");
    const { code, owner } = await a.create("Delay", 0);
    await b.join(code);
    await until(() => a.server.f.includes("room-delay") && b.room?.members.length === 2);
    const heard: Record<string, unknown>[] = [];
    b.on("event", ({ ev }) => heard.push(ev as never));
    const errors: string[] = [];
    b.on("error", ({ code: c }) => errors.push(c));
    // (Ben, not its owner: refused)
    b.event({ kind: "room-delay", value: "off", owner: "nope" } as never);
    await until(() => errors.length === 1);
    expect(errors).toEqual(["owner"]);
    // (Ana, its owner: passed on without her token)
    a.event({ kind: "room-delay", value: "tenth", owner } as never);
    await until(() => heard.some((e) => e.kind === "room-delay"));
    expect(heard.find((e) => e.kind === "room-delay")).toEqual({ kind: "room-delay", value: "tenth" });
    // (a newcomer told at once)
    const c = client("Cid");
    const late: Record<string, unknown>[] = [];
    c.on("event", ({ ev }) => late.push(ev as never));
    await c.join(code, "instruments");
    await until(() => late.some((e) => e.kind === "room-delay"));
    expect(late.find((e) => e.kind === "room-delay")).toEqual({ kind: "room-delay", value: "tenth" });
    a.close();
    b.close();
    c.close();
  });

  test("rooms kept across a restart, their clock carried on", async () => {
    const a = client("Ana");
    const { code } = await a.create("Persistent", 5000);
    a.close();
    await Bun.sleep(50);
    stop();
    start();
    const c = client("Cy");
    const r = await c.join(code);
    expect(r.name).toBe("Persistent");
    await until(() => c.clock.synced);
    expect(c.roomNow()).toBeGreaterThan(5000);
    const info = await c.info([code, "ZZZZZZ"]);
    expect(info.map((i) => i.code)).toEqual([code]);
    expect(rooms.health().peers).toBe(1);
    c.close();
  });
});

describe("the TURN relay's credentials", () => {
  test("STUN alone without a secret; with one, a username of an expiry and the device, its HMAC-SHA1", async () => {
    const r = createRooms({ db: ":memory:", turn: { secret: "s3cret", urls: ["turn:example.org:3478"] } });
    const srv = Bun.serve({ port: 0, fetch: (req, s) => r.upgrade(req, s as never), websocket: r.websocket });
    const c = new NetClient({ url: `ws://127.0.0.1:${srv.port}/`, build: "t", id: { device: "dev-1", name: "T", colour: "#ffffff" } });
    const { code } = await c.create("Ice", 0);
    expect(code.length).toBe(6);
    const S = c.iceServers!;
    expect(S[0]!.urls).toContain("stun:");
    const T = S.find((x) => String(x.urls).includes("turn:"))!;
    expect(T.username).toMatch(/^\d+:dev-1$/);
    const want = new Bun.CryptoHasher("sha1", "s3cret").update(T.username!).digest("base64");
    expect(T.credential).toBe(want);
    expect(Number(T.username!.split(":")[0]) * 1000 - Date.now()).toBeGreaterThan(5 * 3600 * 1000);
    c.close();
    r.close();
    srv.stop(true);
  });
});
