import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { NetClient } from "../../src/net/client";
import { emptyVisual } from "../../src/net/proto";

// PLAN-VAISSEAUX K5: a crew member joins as FIDO, on the ground, in a real room, by real clicks; the pilot (a client of
// the test) is 2 s of light away: the console shows his snapshots 2 s late, its badge says so, a message to him arrives
// 2 s late; behind the wormhole the link is cut — the badge, an order refused, a message recorded — and once he is
// back the recorded message is delivered with its age. ~40 s.

const MU = 398600.4418;
const snap = (t: number, cut: boolean) => ({
  v: 1,
  t,
  body: cut ? "gargantua" : "earth",
  metrics: { alt: 420_000, speed: 7660, tau: 1 },
  geo: null,
  radar: null,
  route: [],
  ahead: [],
  caps: { on: true, fam: ["space"] },
  craft: { id: "ranger", kind: "spacecraft", name: "Ranger", lands: true, ring: false },
  state: cut ? undefined : { body: "earth", r: [6791, 0, 0], v: [0, Math.sqrt(MU / 6791), 0], mu: MU, radius: 6371, soi: 924_000 },
  orbit: cut ? null : { pe: 418, ap: 423, inc: 51.6, ecc: 0.0004, period: 5560, tPe: 1200, tAp: 4000, radius: 6378, a: 6791 },
  time: { warp: 1, room: t, dtau: 1, tau: t, met: t },
  link: cut ? { light: 0, cut: true } : { light: 2, delay: 2, cut: false },
});

describe.skipIf(!E2E)("the crew's stations and the light delay (K5)", () => {
  let app: App;
  let pilot: NetClient;
  let feed: ReturnType<typeof setInterval>;
  let cut = false;
  let t = 0;
  const heard: { text: string; rec: number; at: number }[] = [];
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  beforeAll(async () => {
    app = await App.boot({ entry: "crew", width: 1440, height: 900 });
    pilot = new NetClient({
      url: new URL("net", app.url).href.replace("http", "ws"),
      build: "test",
      id: { device: "crew-station-pilot", name: "Cooper", colour: "#89dce5" },
      p2p: false,
    });
    pilot.on("event", ({ ev }) => {
      const e = ev as { kind?: string; text?: string; rec?: number };
      if (e.kind === "crew-msg") heard.push({ text: e.text ?? "", rec: e.rec ?? 0, at: performance.now() });
    });
    const code = (await pilot.create("Lazarus", 0)).code;
    feed = setInterval(() => {
      t += 0.25;
      pilot.sendCraft({
        frame: 0,
        body: 0,
        kind: 0,
        flags: 0,
        p: [6.791e6, 0, 0],
        v: [0, 7660, 0],
        q: [0, 0, 0, 1],
        w: [0, 0, 0],
        a: [0, 0, 0],
        vis: emptyVisual(),
      });
      pilot.event({ kind: "instruments", data: snap(t, cut) });
    }, 250);
    await app.js(`(document.getElementById("name").value = "", 1)`);
    await app.click("#name");
    await app.type("Brand");
    await app.click("#code");
    await app.type(code);
    // (the station: FIDO, on the ground — chosen in the lobby's list)
    await app.js(
      `(() => { const s = document.getElementById("station"); s.value = "fido"; s.dispatchEvent(new Event("change")); return 1; })()`,
    );
    await shot("1-lobby-poste");
    await app.click("#join");
    await app.waitFor("__crew.net.room?.role === 'instruments'", 20_000);
  }, 120_000);
  afterAll(() => {
    clearInterval(feed);
    pilot?.close();
    app?.close();
    stopServer();
  });

  test("FIDO on the ground: its call in the room, its snapshots 2 s late, its badge; a message arrives 2 s late", async () => {
    await app.waitFor("!!__crew.model.own()?.snapshot", 15_000);
    expect(await app.js<string>("__crew.net.o.id.name")).toBe("Brand · FIDO");
    await app.waitFor(`document.getElementById("profile-badge").textContent.includes("FIDO · SOL +2")`, 5000);
    // (what it shows: the pilot's time of 2 s ago)
    const lag = await app.js<number>(`(${t} + 0) - __crew.model.own().snapshot.t`);
    console.log(`  shown ${lag.toFixed(2)} s behind the pilot`);
    expect(lag).toBeGreaterThan(1.5);
    // (FIDO opens on the orbit)
    expect(await app.js<string>(`document.getElementById("view-title").textContent`)).toBe("Orbite");
    const sent = performance.now();
    await app.js(`(document.getElementById("msg-text").scrollIntoView({ block: "center" }), 1)`);
    await app.click("#msg-text");
    await app.type("Cooper, FIDO : burn nominal");
    await app.click("#msg-send");
    const deadline = performance.now() + 8000;
    while (!heard.length && performance.now() < deadline) await Bun.sleep(100);
    expect(heard.length).toBe(1);
    const late = (heard[0]!.at - sent) / 1000;
    console.log(`  the message heard ${late.toFixed(2)} s after it was sent`);
    expect(late).toBeGreaterThan(1.8);
    expect(heard[0]!.text).toBe("Cooper, FIDO : burn nominal");
    await shot("2-fido-sol");
    expect(app.cdp.errors).toEqual([]);
  }, 60_000);

  test("behind the wormhole: the link cut — the badge, an order refused, a message recorded; delivered with its age once back", async () => {
    cut = true;
    await app.waitFor(`document.getElementById("profile-badge").textContent.includes("LIAISON COUPÉE")`, 8000);
    const refused = await app.js<{ ok: boolean; msg: string }>(`__crew.actions.send("sp.hold", { direction: "prograde" })`);
    expect(refused.ok).toBe(false);
    expect(refused.msg).toMatch(/Liaison coupée/);
    heard.length = 0;
    await app.js(`(document.getElementById("msg-text").scrollIntoView({ block: "center" }), 1)`);
    await app.click("#msg-text");
    await app.type("Message de la Terre");
    await app.click("#msg-send");
    await app.waitFor(`document.getElementById("msg-state").textContent.includes("1 message")`, 3000);
    await shot("3-liaison-coupee");
    await Bun.sleep(1500);
    expect(heard.length).toBe(0);
    cut = false;
    const deadline = performance.now() + 10_000;
    while (!heard.length && performance.now() < deadline) await Bun.sleep(100);
    expect(heard.map((h) => h.text)).toEqual(["Message de la Terre"]);
    expect(heard[0]!.rec).toBeGreaterThanOrEqual(1);
    expect(app.cdp.errors).toEqual([]);
  }, 60_000);
});
