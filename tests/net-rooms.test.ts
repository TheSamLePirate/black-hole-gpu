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
    await until(() => (b.remotes.tracks.get(0)?.samples.length ?? 0) >= 9);
    expect(b.remotes.tracks.has(1)).toBe(false);
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
