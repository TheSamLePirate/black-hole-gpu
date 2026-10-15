import { describe, expect, test } from "bun:test";
import { createTraffic, fromAdsbLol, fromOpenSky, fromReadsbTrace, ingestAis, type Ship } from "../server/traffic";
import { TrafficFeed, trafficBase } from "../src/traffic/feed";

// The real traffic's relay and feed (docs/PLAN-AVIATION-AAA.md, T1; server/traffic.ts, traffic/feed.ts): the
// sources' records in SI; a tile asked once for many; OpenSky when adsb.lol fails, its token once; the ships of
// ONE aisstream connection, its subscription following the zones; a page asking too fast slowed; adsb.lol's pace
// kept; an aircraft's recent trace; the page's feed — its pace, its reports' history, the followed one's trace, off
// and offline.

const ADSB = {
  hex: "3949ED",
  flight: "AFR357E ",
  r: "F-GSPN",
  t: "B772",
  alt_baro: 7700,
  alt_geom: 8400,
  gs: 287.0,
  track: 159.61,
  true_heading: 158.2,
  geom_rate: -1600,
  roll: -2.5,
  category: "A5",
  lat: 48.9,
  lon: 2.4,
  seen_pos: 0.5,
};

describe("the records", () => {
  test("adsb.lol: feet, knots, feet a minute → metres, m/s; the callsign trimmed; on the ground", () => {
    const p = fromAdsbLol(ADSB, 1000)!;
    expect(p.id).toBe("3949ed");
    expect(p.cs).toBe("AFR357E");
    expect(p.reg).toBe("F-GSPN");
    expect(p.alt).toBeCloseTo(8400 * 0.3048, 3);
    expect(p.gs).toBeCloseTo(287 * 0.514444, 3);
    expect(p.vs).toBeCloseTo((-1600 * 0.3048) / 60, 3);
    expect(p.t).toBeCloseTo(999.5, 6);
    expect(fromAdsbLol({ ...ADSB, alt_baro: "ground" }, 0)!.gnd).toBe(true);
    expect(fromAdsbLol({ hex: "x" }, 0)).toBeNull();
  });

  test("OpenSky's state vector; AIS's position and static data merged", () => {
    const s = ["4b1814", "SWR1234 ", "Switzerland", 1000, 1001, 7.5, 47.2, 9000, false, 230, 45, -3, null, 9100, "1000", false, 0, 3];
    const p = fromOpenSky(s, 0)!;
    expect(p.cs).toBe("SWR1234");
    expect(p.alt).toBe(9100);
    expect(p.lat).toBe(47.2);
    const ships = new Map<number, Ship>();
    ingestAis(
      ships,
      {
        MessageType: "PositionReport",
        MetaData: { MMSI: 227000001, ShipName: "MORNING COURIER " },
        Message: { PositionReport: { Latitude: 51.0, Longitude: 1.5, Sog: 12, Cog: 45, TrueHeading: 44 } },
      },
      10,
    );
    ingestAis(
      ships,
      {
        MessageType: "ShipStaticData",
        MetaData: { MMSI: 227000001 },
        Message: {
          ShipStaticData: { Name: "MORNING COURIER", Type: 70, Destination: "ROTTERDAM", Dimension: { A: 150, B: 50, C: 15, D: 15 } },
        },
      },
      11,
    );
    const sh = ships.get(227000001)!;
    expect(sh.name).toBe("MORNING COURIER");
    expect(sh.sog).toBeCloseTo(12 * 0.514444, 4);
    expect(sh.len).toBe(200);
    expect(sh.beam).toBe(30);
    expect(sh.dest).toBe("ROTTERDAM");
    expect(sh.hdg).toBe(44);
  });
});

/** A relay over stub sources: adsb.lol up or down, OpenSky, the asks counted. */
function relay(adsbUp = true) {
  const asks: string[] = [];
  let t = 1000;
  const get = (async (url: string) => {
    asks.push(String(url));
    if (String(url).includes("adsb.lol")) {
      if (!adsbUp) return new Response("down", { status: 503 });
      return Response.json({ now: t * 1000, ac: [ADSB, { ...ADSB, hex: "aaaaaa", lat: 52.5, lon: 13.4 }] });
    }
    if (String(url).includes("/token")) return Response.json({ access_token: "tok", expires_in: 1800 });
    return Response.json({ time: t, states: [["4b1814", "SWR1234 ", "CH", t, t, 2.4, 48.9, 9000, false, 230, 45, 0, null, 9100]] });
  }) as unknown as typeof fetch;
  const T = createTraffic({ fetch: get, openskyId: "id", openskySecret: "secret", now: () => t, sleep: async (s) => void (t += s) });
  return { T, asks, tick: (s: number) => (t += s) };
}

describe("the relay", () => {
  test("a tile asked once for many pages; the radius kept; again after its 15 s", async () => {
    const { T, asks, tick } = relay();
    const [a, b] = await Promise.all([T.air(48.85, 2.35, 50), T.air(48.86, 2.36, 50)]);
    expect(asks.filter((u) => u.includes("adsb.lol")).length).toBe(1);
    expect(a.planes.map((p) => p.cs)).toEqual(["AFR357E"]);
    expect(b.src).toBe("adsb.lol");
    tick(16);
    await T.air(48.85, 2.35, 50);
    expect(asks.filter((u) => u.includes("adsb.lol")).length).toBe(2);
    // (adsb.lol's pace: another tile at once waits its 10 s — its clock run on by the wait)
    const t0 = (await T.handle(new Request("http://x/traffic/health")))!;
    expect(t0.status).toBe(200);
    await T.air(40, 2, 50);
    expect(asks.filter((u) => u.includes("adsb.lol")).length).toBe(3);
    T.close();
  });

  test("adsb.lol down: OpenSky, its token asked once", async () => {
    const { T, asks, tick } = relay(false);
    const a = await T.air(48.85, 2.35, 80);
    expect(a.src).toBe("opensky");
    expect(a.planes[0]!.cs).toBe("SWR1234");
    tick(20);
    await T.air(48.85, 2.35, 80);
    expect(asks.filter((u) => u.includes("/token")).length).toBe(1);
    expect(asks.filter((u) => u.includes("/states/all")).every((u) => u.includes("lamin="))).toBe(true);
    T.close();
  });

  test("the pages' answers: CORS, 400 without a place, 429 asked too fast, health", async () => {
    const { T } = relay();
    const r = (await T.handle(new Request("http://x/traffic/air?lat=48.85&lon=2.35&r=50"), "1.2.3.4"))!;
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    const j = (await r.json()) as { planes: unknown[]; attribution: string };
    expect(j.planes.length).toBe(1);
    expect(j.attribution).toContain("adsb.lol");
    expect((await T.handle(new Request("http://x/traffic/air?lat=x"), "1.2.3.5"))!.status).toBe(400);
    let last = 200;
    for (let i = 0; i < 12; i++) last = (await T.handle(new Request("http://x/traffic/sea?lat=51&lon=1.5"), "9.9.9.9"))!.status;
    expect(last).toBe(429);
    expect(await T.handle(new Request("http://x/other"))).toBeNull();
    const h = (await (await T.handle(new Request("http://x/traffic/health")))!.json()) as { opensky: boolean };
    expect(h.opensky).toBe(true);
    T.close();
  });

  test("the ships: ONE aisstream connection, its subscription the zones asked; a second zone resubscribed on it", async () => {
    const sockets: { sent: string[]; s: { onopen?: () => void; onmessage?: (e: { data: string }) => void } }[] = [];
    class WS {
      onopen?: () => void;
      onmessage?: (e: { data: string }) => void;
      onclose?: () => void;
      onerror?: () => void;
      sent: string[] = [];
      constructor(public url: string) {
        sockets.push({ sent: this.sent, s: this });
      }
      send(m: string) {
        this.sent.push(m);
      }
      close() {}
    }
    const T = createTraffic({ aisKey: "k", WebSocket: WS as unknown as typeof WebSocket, now: () => 1000 });
    expect(T.sea(51, 1.5, 60)).toEqual([]);
    expect(sockets.length).toBe(1);
    sockets[0]!.s.onopen!();
    const sub = JSON.parse(sockets[0]!.sent[0]!) as { APIKey: string; BoundingBoxes: number[][][] };
    expect(sub.APIKey).toBe("k");
    expect(sub.BoundingBoxes.length).toBe(1);
    sockets[0]!.s.onmessage!({
      data: JSON.stringify({
        MessageType: "PositionReport",
        MetaData: { MMSI: 1, ShipName: "A" },
        Message: { PositionReport: { Latitude: 51.1, Longitude: 1.6, Sog: 10, Cog: 0, TrueHeading: 511 } },
      }),
    });
    await Bun.sleep(5);
    expect(T.sea(51, 1.5, 60).map((s) => s.name)).toEqual(["A"]);
    // (another page over Marseille: the same connection, two zones)
    T.sea(43.3, 5.4, 60);
    expect(sockets.length).toBe(1);
    const sub2 = JSON.parse(sockets[0]!.sent.at(-1)!) as { BoundingBoxes: number[][][] };
    expect(sub2.BoundingBoxes.length).toBe(2);
    T.close();
  });
});

describe("the page's feed", () => {
  test("asked every 15 s (the air), 10 s (the sea); its reports' history; live; off clears; offline", async () => {
    const asked: string[] = [];
    let n = 0;
    const get = async (url: string) => {
      asked.push(url);
      n++;
      return url.includes("/air")
        ? Response.json({ planes: [{ ...fromAdsbLol(ADSB, 100 + n)! }], attribution: "ADS-B: adsb.lol" })
        : Response.json({ ships: [], attribution: "AIS: aisstream.io" });
    };
    let online = true;
    const F = new TrafficFeed(
      () => "http://relay",
      get,
      () => online,
    );
    F.tick(0, { lat: 48.85, lon: 2.35 }, true);
    await Bun.sleep(5);
    F.tick(2, { lat: 48.85, lon: 2.35 }, true);
    await Bun.sleep(5);
    expect(asked.length).toBe(2);
    F.tick(15.1, { lat: 48.85, lon: 2.35 }, true);
    await Bun.sleep(5);
    expect(asked.filter((u) => u.includes("/air")).length).toBe(2);
    const T = F.planes.get("3949ed")!;
    expect(T.prev).not.toBeNull();
    expect(T.hist.map((q) => q.t)).toEqual([T.prev!.t, T.p.t]);
    expect(F.status).toBe("live");
    // (credited: the air's — it gave aircraft —, not the sea's — no ship)
    expect(F.attribution).toEqual(["ADS-B: adsb.lol"]);
    F.tick(6, null, true);
    expect(F.planes.size).toBe(0);
    online = false;
    F.tick(20, { lat: 48.85, lon: 2.35 }, true);
    expect(F.status).toBe("offline");
    expect(trafficBase({ hostname: "localhost", protocol: "http:", host: "localhost:3000" })).toBe("http://localhost:3000");
    expect(trafficBase({ hostname: "samlepirate.org", protocol: "https:", host: "samlepirate.org" })).toBe(
      "https://stream.samlepirate.org",
    );
  });
});

describe("the aircraft followed", () => {
  test("its recent trace: readsb's points (an absent field not 0); the feed's focus asks it, its points into its history in time's order, its name kept", async () => {
    // (readsb's trace: [s after its timestamp, lat, lon, baro ft | "ground", gs kt, track, flags, baro fpm, details,
    // source, geometric ft, geometric fpm, ias, roll])
    const J = {
      icao: "3949ed",
      r: "F-GSPN",
      t: "B772",
      timestamp: 2000,
      trace: [
        [0, 48.8, 2.3, 7000, 280, 90, 0, -500, { flight: "AFR357E ", category: "A5" }, "adsb_icao", 7700, -600, null, null],
        [10, 48.8, 2.35, 6950, 281, 91, 0, -500, null, "adsb_icao", null, null, null, 2.5],
        [20, 48.8, 2.4, "ground", 20, 90, 0, null, null, "adsb_icao", null, null, null, null],
      ],
    };
    const P = fromReadsbTrace("3949ed", J);
    expect(P.map((q) => q.t)).toEqual([2000, 2010, 2020]);
    expect(P[0]!.cs).toBe("AFR357E");
    expect(P[0]!.alt).toBeCloseTo(7700 * 0.3048, 3);
    // (the second's geometric altitude absent: its barometric and the last difference — not 0)
    expect(P[1]!.alt).toBeCloseTo(7650 * 0.3048, 3);
    expect(P[1]!.vs).toBeCloseTo((-500 * 0.3048) / 60, 3);
    expect(P[2]!.gnd).toBe(true);
    // the relay: gzipped as adsb.lol serves it
    const asks: string[] = [];
    const get = (async (url: string) => {
      asks.push(String(url));
      return new Response(Bun.gzipSync(new TextEncoder().encode(JSON.stringify(J))));
    }) as unknown as typeof fetch;
    const T = createTraffic({ fetch: get, now: () => 2100, sleep: async () => {} });
    const r = (await T.handle(new Request("http://x/traffic/trace?id=3949ED"), "1.2.3.4"))!;
    const j = (await r.json()) as { trace: { t: number }[] };
    expect(j.trace.length).toBe(3);
    expect(asks[0]).toContain("/traces/ed/trace_recent_3949ed.json");
    T.close();
    // the page's feed: a tile's report (its registration), then the focus's trace — older points among them
    const feedGet = async (url: string) => {
      if (url.includes("/trace")) return Response.json({ trace: fromReadsbTrace("3949ed", { ...J, r: "", t: "" }) });
      return Response.json({ planes: [{ ...fromAdsbLol(ADSB, 2015)! }] });
    };
    const F = new TrafficFeed(
      () => "http://relay",
      feedGet,
      () => true,
    );
    F.tick(0, { lat: 48.85, lon: 2.35 }, true);
    await Bun.sleep(5);
    F.focus = "3949ed";
    F.tick(1, { lat: 48.85, lon: 2.35 }, true);
    await Bun.sleep(5);
    const R = F.planes.get("3949ed")!;
    expect(R.hist.map((q) => q.t)).toEqual([2000, 2010, 2014.5, 2020]);
    expect(R.p.t).toBe(2020);
    expect(R.p.reg).toBe("F-GSPN");
  });
});
