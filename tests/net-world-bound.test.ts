import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createRooms } from "../server/rooms";
import { NetClient } from "../src/net/client";

// A lasting room's world bounded (audit 2026-11-10, NET-17): every device that came — a crew console draws a new one at each load,
// a spectator — stayed in the room's record for ever, the whole record written again every 2 s. Forty consoles come and go; the
// clock moved past the slot's memory; one more comes: the room keeps those whose craft holds, and those seen lately.

const file = `/tmp/kerr-world-${process.pid}.sqlite`;
afterAll(async () => {
  await Bun.$`rm -f ${file} ${file}-wal ${file}-shm`.nothrow();
});

test("forty consoles come and go: the room's world does not keep them", async () => {
  let t = Date.now();
  const rooms = createRooms({ db: file, build: "test", now: () => t });
  const server = Bun.serve({ port: 0, fetch: (req, srv) => rooms.upgrade(req, srv as never), websocket: rooms.websocket });
  const url = `ws://127.0.0.1:${server.port}/`;
  const mk = (device: string) => new NetClient({ url, build: "test", id: { device, name: device.slice(0, 12), colour: "#ff8800" } });
  const owner = mk("pilot-ana");
  const { code } = await owner.create("World", 1000);
  for (let i = 0; i < 40; i++) {
    const c = mk(`console-${i}-${Math.random().toString(36).slice(2)}`);
    await c.join(code, "instruments");
    c.close();
  }
  // (past the slot's memory: ten minutes)
  t += 11 * 60_000;
  const last = mk("console-last");
  await last.join(code, "instruments");
  last.close();
  owner.close();
  await Bun.sleep(100);
  rooms.close();
  server.stop(true);
  const row = new Database(file).query("SELECT world FROM rooms WHERE code = ?").get(code) as { world: string };
  const world = Object.keys(JSON.parse(row.world));
  console.log(`  the room's world: ${world.length} devices kept`);
  expect(world.length).toBeLessThanOrEqual(3);
});
