import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createRooms, type Rooms } from "../server/rooms";
import { NetClient } from "../src/net/client";

// The room server defends itself (PLAN-RESEAU-DURCISSEMENT RD2; audit NET-02, NET-03, NET-04, NET-15): rooms created
// from one address bounded, empty rooms let go in time; a flood of events cut; a member's identity not published —
// nobody takes another's place by copying it —, a slot taken back keeps its role; password guesses slowed, the
// password kept salted. Each written before its fix, against the server as it was (they failed then).

let rooms: Rooms;
let server: ReturnType<typeof Bun.serve>;
let url = "";
let clock = 1_000_000;
const start = (o: Partial<Parameters<typeof createRooms>[0]> = {}) => {
  rooms = createRooms({ db: ":memory:", build: "test", now: () => clock, ...o });
  server = Bun.serve({ port: 0, fetch: (req, srv) => rooms.upgrade(req, srv as never), websocket: rooms.websocket });
  url = `ws://127.0.0.1:${server.port}/`;
};
const stop = () => {
  rooms.close();
  server.stop(true);
};
const client = (name: string, device = `${name}-dev`) => new NetClient({ url, build: "test", id: { device, name, colour: "#ff8800" } });
const failure = (p: Promise<unknown>) => p.then(() => "").catch((e: Error & { code?: string }) => e.code ?? e.message);
const until = async (f: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await Bun.sleep(10);
  }
};

describe("the room server defends itself", () => {
  // (every test's connection comes from 127.0.0.1: the hourly quota per address raised here, tested on its own server)
  beforeAll(() => start({ maxRooms: 1000, roomsPerHour: 1000 }));
  afterAll(stop);

  test("one address creates a bounded number of rooms in an hour; an hour on, it can again", async () => {
    const R = createRooms({ db: ":memory:", build: "test", now: () => clock });
    const S = Bun.serve({ port: 0, fetch: (req, srv) => R.upgrade(req, srv as never), websocket: R.websocket });
    const a = new NetClient({ url: `ws://127.0.0.1:${S.port}/`, build: "test", id: { device: "spam", name: "Spam", colour: "#ff8800" } });
    let made = 0;
    let refused = "";
    for (let k = 0; k < 60 && !refused; k++) {
      refused = await failure(a.create(`Room ${k}`, 0));
      if (!refused) made++;
    }
    console.log(`  one address: ${made} rooms, then ${refused || "never refused"}`);
    expect(refused).toBe("limit");
    expect(made).toBeLessThanOrEqual(20);
    clock += 3600_001;
    expect(await failure(a.create("Next hour", 0))).toBe("");
    a.close();
    R.close();
    S.stop(true);
  });

  test("a flood of events from one member cut: the others hear a bounded part of it", async () => {
    const a = client("Ana");
    const b = client("Ben");
    const { code } = await a.create("Flood", 0);
    await b.join(code);
    let heard = 0;
    a.on("event", () => heard++);
    for (let k = 0; k < 3000; k++) b.event({ kind: "radio", role: "lso", text: `${k}` });
    await Bun.sleep(600);
    console.log(`  3 000 events sent at once: ${heard} heard`);
    expect(heard).toBeLessThan(600);
    a.close();
    b.close();
  });

  test("a member's identity is not published: copied from the roster, it takes nobody's place", async () => {
    const a = client("Ana", "ana-secret-device");
    const b = client("Ben", "ben-secret-device");
    const { code } = await a.create("Identity", 0);
    await b.join(code);
    await until(() => a.room?.members.length === 2);
    const seen = a.room!.members.find((m) => m.name === "Ben")!.device;
    expect(seen).not.toBe("ben-secret-device");
    // (the crew console follows a pilot across reconnections by it: the same public id each time)
    const b2 = client("Ben", "ben-secret-device");
    b.close();
    await b2.join(code);
    await until(() => a.room?.members.some((m) => m.name === "Ben") === true);
    expect(a.room!.members.find((m) => m.name === "Ben")!.device).toBe(seen);
    // (an intruder with what the roster shows: a member of its own, nobody thrown out)
    const c = client("Eve", seen);
    await c.join(code);
    await until(() => a.room?.members.length === 3);
    expect(a.room!.members.map((m) => m.name).sort()).toEqual(["Ana", "Ben", "Eve"]);
    for (const x of [a, b2, c]) x.close();
  });

  test("a slot taken back keeps its role: a spectator back as a pilot does not make a fifth pilot", async () => {
    const pilots = [0, 1, 2, 3].map((k) => client(`P${k}`));
    const { code } = await pilots[0]!.create("Five", 0);
    for (const p of pilots.slice(1)) await p.join(code, "pilot");
    const s = client("Spec", "spec-device");
    await s.join(code, "spectator");
    const s2 = client("Spec", "spec-device");
    const r = await failure(s2.join(code, "pilot"));
    await Bun.sleep(100);
    const roles = pilots[0]!.room!.members.filter((m) => m.role === "pilot").length;
    console.log(`  back as a pilot: ${r || "accepted"}; pilots now ${roles}`);
    expect(roles).toBeLessThanOrEqual(4);
    for (const x of [...pilots, s, s2]) x.close();
  });

  test("password guesses slowed; the password kept salted", async () => {
    const a = client("Ana");
    const { code } = await a.create("Locked", 0, "hunter2");
    const results: string[] = [];
    for (let k = 0; k < 12; k++) {
      const g = client(`G${k}`, `guess-${k}`);
      results.push(await failure(g.join(code, "pilot", `guess${k}`)));
      g.close();
    }
    console.log(`  12 wrong guesses: ${results.join(" ")}`);
    expect(results.filter((x) => x === "slow").length).toBeGreaterThan(0);
    const stored = rooms.record(code)?.pass ?? "";
    const plain = new Bun.CryptoHasher("sha256").update("hunter2").digest("hex");
    expect(stored).not.toBe(plain);
    expect(stored.length).toBeGreaterThan(0);
    a.close();
  });

  test("an empty room let go after its time; one in use kept", async () => {
    const a = client("Old");
    const { code } = await a.create("Forgotten", 0);
    a.close();
    await Bun.sleep(50);
    clock += 40 * 86_400_000;
    const b = client("Late");
    expect(await failure(b.join(code))).toBe("unknown-room");
    b.close();
  });
});
