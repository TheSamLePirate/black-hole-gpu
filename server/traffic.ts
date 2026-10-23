// The traffic relay (docs/PLAN-AVIATION-AAA.md, T1): the real aircraft and ships about a place, for the pages —
// served by the dev server (server.ts) and by the room server in production (server/main.ts,
// stream.samlepirate.org), the keys in the environment, never in a page.
//
// - The aircraft: adsb.lol's live ADS-B (keyless, ODbL), cached a few seconds per tile; OpenSky's states when
//   adsb.lol fails (its OAuth2 client credentials if given: OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET — else
//   anonymous), cached longer (its credits).
// - The ships: aisstream.io's AIS (AISSTREAM_API_KEY) on ONE connection, its subscription following the zones the
//   pages asked about in the last two minutes (none asked: closed); the ships kept as they report.
// - Each answer in SI (m, m/s, degrees), with its sources' attribution; a page asking more than twice a second
//   slowed down. Pure of any page: `fetch` and `WebSocket` given (tests).

export interface Plane {
  /** its ICAO 24-bit address (hex), callsign, registration, type (ICAO: A320, B77W…), category (A1…A7, B…) */
  id: string;
  cs: string;
  reg: string;
  type: string;
  cat: string;
  lat: number;
  lon: number;
  /** its altitude [m] (geometric — over the WGS84 ellipsoid — if known, else barometric: over the sea, `baro`), ground
   *  speed [m/s], track and heading [°], vertical speed [m/s], roll [°] */
  alt: number;
  /** its altitude barometric (over the sea, not the ellipsoid: the page raises it by the geoid — traffic/feed.ts) */
  baro?: boolean;
  gs: number;
  trk: number;
  hdg: number | null;
  vs: number;
  roll: number | null;
  /** its track's rate [°/s] (ADS-B's, when given) */
  rate?: number | null;
  /** on the ground */
  gnd: boolean;
  /** when its position was measured [s since 1970] */
  t: number;
  src: "adsb.lol" | "opensky";
}

export interface Ship {
  mmsi: number;
  name: string;
  /** AIS ship type (70–79 cargo, 80–89 tanker, 60–69 passenger, 30 fishing, 36 sailing…) */
  type: number;
  lat: number;
  lon: number;
  /** speed over ground [m/s], course over ground and true heading [°] (null: not given) */
  sog: number;
  cog: number;
  hdg: number | null;
  /** its length and beam [m] (0: unknown), its destination */
  len: number;
  beam: number;
  dest: string;
  t: number;
}

export interface TrafficOpts {
  aisKey?: string;
  openskyId?: string;
  openskySecret?: string;
  fetch?: typeof fetch;
  /** waits [s] (adsb.lol's pace; tests: none) */
  sleep?: (s: number) => Promise<void>;
  WebSocket?: typeof WebSocket;
  now?: () => number;
  log?: (s: string) => void;
}

const FT = 0.3048;
const KT = 0.514444;
const ATTR_AIR = "ADS-B: adsb.lol (ODbL 1.0) · OpenSky Network";
const ATTR_SEA = "AIS: aisstream.io";
const CORS = { "access-control-allow-origin": "*", "cache-control": "no-store" };
/** the air's tile cache [s] (adsb.lol's, OpenSky's), the largest radius served [km], the ships kept [s] */
const AIR_TTL = 15;
/** adsb.lol's pace: an ask every this [s] at most across the relay (it refuses more); after a refusal, none for this
 *  [s]; a wait longer than this [s]: the other source instead */
const ADSB_GAP = 10;
const ADSB_REST = 60;
const ADSB_WAIT = 16;
/** a trace's cache [s] */
const TRACE_TTL = 15;
const SKY_TTL = 15;
const R_MAX = 250;
const SHIP_KEEP = 15 * 60;
/** the zones kept after their last ask [s]; the zones at most; a zone's half side [°] */
const ZONE_KEEP = 120;
const ZONES_MAX = 12;

/** adsb.lol's aircraft → ours (null: no position). */
export function fromAdsbLol(a: Record<string, unknown>, now: number): Plane | null {
  const lat = Number(a.lat),
    lon = Number(a.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const gnd = a.alt_baro === "ground";
  const altFt = Number.isFinite(Number(a.alt_geom)) ? Number(a.alt_geom) : Number.isFinite(Number(a.alt_baro)) ? Number(a.alt_baro) : 0;
  const rate = Number.isFinite(Number(a.geom_rate)) ? Number(a.geom_rate) : Number(a.baro_rate);
  const seen = Number(a.seen_pos ?? a.seen ?? 0);
  return {
    id: String(a.hex ?? "").toLowerCase(),
    cs: String(a.flight ?? "").trim(),
    reg: String(a.r ?? "").trim(),
    type: String(a.t ?? "").trim(),
    cat: String(a.category ?? ""),
    lat,
    lon,
    alt: gnd ? 0 : altFt * FT,
    ...(!gnd && !Number.isFinite(Number(a.alt_geom)) && Number.isFinite(Number(a.alt_baro)) ? { baro: true } : {}),
    gs: Number(a.gs ?? 0) * KT,
    trk: Number(a.track ?? a.true_heading ?? 0),
    hdg: Number.isFinite(Number(a.true_heading)) ? Number(a.true_heading) : null,
    vs: Number.isFinite(rate) ? (rate * FT) / 60 : 0,
    roll: Number.isFinite(Number(a.roll)) ? Number(a.roll) : null,
    rate: Number.isFinite(Number(a.track_rate)) ? Number(a.track_rate) : null,
    gnd,
    t: now - (Number.isFinite(seen) ? seen : 0),
    src: "adsb.lol",
  };
}

/** OpenSky's state vector → ours (null: no position). */
export function fromOpenSky(s: unknown[], now: number): Plane | null {
  const lat = Number(s[6]),
    lon = Number(s[5]);
  if (s[6] === null || s[5] === null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const alt = s[13] !== null ? Number(s[13]) : s[7] !== null ? Number(s[7]) : 0;
  return {
    id: String(s[0] ?? "").toLowerCase(),
    cs: String(s[1] ?? "").trim(),
    reg: "",
    type: "",
    cat: s[17] !== undefined && s[17] !== null ? `cat${s[17]}` : "",
    lat,
    lon,
    alt: s[8] ? 0 : alt,
    ...(!s[8] && s[13] === null && s[7] !== null ? { baro: true } : {}),
    gs: Number(s[9] ?? 0),
    trk: Number(s[10] ?? 0),
    hdg: null,
    vs: Number(s[11] ?? 0),
    roll: null,
    gnd: !!s[8],
    t: Number(s[3] ?? now),
    src: "opensky",
  };
}

/** A response's JSON, gzip or not (adsb.lol's traces are files kept gzipped, sent so). */
async function readJson(r: Response): Promise<unknown> {
  const b = new Uint8Array(await r.arrayBuffer());
  const txt = b[0] === 0x1f && b[1] === 0x8b ? new TextDecoder().decode(Bun.gunzipSync(b)) : new TextDecoder().decode(b);
  return JSON.parse(txt);
}

/** A field's number; absent (null, as a trace leaves one): NaN, not 0. */
const num = (x: unknown) => (x === null || x === undefined || x === "" ? Number.NaN : Number(x));

/** readsb's recent trace (adsb.lol's) → its points, oldest first. A point: [s after its timestamp, lat, lon, baro alt
 *  ft or "ground", gs kt, track, flags, baro rate fpm, details, source, geometric alt ft, geometric rate fpm, ias, roll]. */
export function fromReadsbTrace(hex: string, j0: unknown): Plane[] {
  const j = j0 as { timestamp?: number; r?: string; t?: string; trace?: unknown[][] };
  const T0 = Number(j.timestamp ?? 0);
  let cs = "";
  let delta = 0;
  const out: Plane[] = [];
  for (const q of j.trace ?? []) {
    const d = q[8] as { flight?: string; category?: string } | null;
    if (d?.flight) cs = d.flight.trim();
    const lat = Number(q[1]),
      lon = Number(q[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const gnd = q[3] === "ground";
    const baro = num(q[3]),
      geom = num(q[10]);
    // (the geometric altitude; where only the barometric is given, it and the last known difference)
    if (Number.isFinite(geom) && Number.isFinite(baro)) delta = geom - baro;
    const altFt = Number.isFinite(geom) ? geom : Number.isFinite(baro) ? baro + delta : 0;
    const rate = Number.isFinite(num(q[11])) ? num(q[11]) : num(q[7]);
    out.push({
      id: hex,
      cs,
      reg: String(j.r ?? ""),
      type: String(j.t ?? ""),
      cat: d?.category ?? "",
      lat,
      lon,
      alt: gnd ? 0 : altFt * FT,
      gs: Number(q[4] ?? 0) * KT,
      trk: Number(q[5] ?? 0),
      hdg: null,
      vs: Number.isFinite(rate) ? (rate * FT) / 60 : 0,
      roll: Number.isFinite(num(q[13])) ? num(q[13]) : null,
      gnd,
      t: T0 + Number(q[0]),
      src: "adsb.lol",
    });
  }
  return out;
}

/** OpenSky's track → its points (its waypoints: [time, lat, lon, baro alt m, track, on ground]; the speeds from
 *  the waypoints themselves). */
export function fromOpenSkyTrack(hex: string, j: { callsign?: string; path?: unknown[][] }): Plane[] {
  const P = (j.path ?? []).map((w) => ({ t: Number(w[0]), lat: Number(w[1]), lon: Number(w[2]), alt: Number(w[3] ?? 0), trk: Number(w[4] ?? 0), gnd: !!w[5] }));
  return P.map((w, i) => {
    const a = P[Math.max(0, i - 1)]!,
      b = P[Math.min(P.length - 1, i + 1)]!;
    const dt = Math.max(b.t - a.t, 1);
    return {
      id: hex,
      cs: String(j.callsign ?? "").trim(),
      reg: "",
      type: "",
      cat: "",
      lat: w.lat,
      lon: w.lon,
      alt: w.gnd ? 0 : w.alt,
      gs: (km(a, b) * 1000) / dt,
      trk: w.trk,
      hdg: null,
      vs: (b.alt - a.alt) / dt,
      roll: null,
      gnd: w.gnd,
      t: w.t,
      src: "opensky" as const,
    };
  });
}

/** An AIS message from aisstream → a ship's update merged into `ships` (its position, or its static data). */
export function ingestAis(ships: Map<number, Ship>, msg: Record<string, unknown>, now: number) {
  const meta = msg.MetaData as Record<string, unknown> | undefined;
  const type = String(msg.MessageType ?? "");
  const body = (msg.Message as Record<string, Record<string, unknown>> | undefined)?.[type];
  const mmsi = Number(meta?.MMSI ?? body?.UserID);
  if (!Number.isFinite(mmsi) || !body) return;
  const s: Ship = ships.get(mmsi) ?? {
    mmsi,
    name: String(meta?.ShipName ?? "").trim(),
    type: 0,
    lat: NaN,
    lon: NaN,
    sog: 0,
    cog: 0,
    hdg: null,
    len: 0,
    beam: 0,
    dest: "",
    t: now,
  };
  if (type === "PositionReport" || type === "StandardClassBPositionReport" || type === "ExtendedClassBPositionReport") {
    const lat = Number(body.Latitude),
      lon = Number(body.Longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
    s.lat = lat;
    s.lon = lon;
    s.sog = Number(body.Sog ?? 0) * KT;
    s.cog = Number(body.Cog ?? 0);
    const h = Number(body.TrueHeading);
    s.hdg = Number.isFinite(h) && h < 360 ? h : null;
    s.t = now;
  } else if (type === "ShipStaticData" || type === "StaticDataReport") {
    s.name = String(body.Name ?? s.name).trim() || s.name;
    s.type = Number(body.Type ?? s.type) || s.type;
    const D = body.Dimension as Record<string, number> | undefined;
    if (D) {
      s.len = (Number(D.A) || 0) + (Number(D.B) || 0);
      s.beam = (Number(D.C) || 0) + (Number(D.D) || 0);
    }
    s.dest = String(body.Destination ?? s.dest).trim();
  } else return;
  if (meta?.ShipName && !s.name) s.name = String(meta.ShipName).trim();
  ships.set(mmsi, s);
}

/** The distance between two places [km] (a sphere). */
export function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const D = Math.PI / 180;
  const s =
    Math.sin(((b.lat - a.lat) * D) / 2) ** 2 + Math.cos(a.lat * D) * Math.cos(b.lat * D) * Math.sin(((b.lon - a.lon) * D) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function createTraffic(o: TrafficOpts = {}) {
  const get = o.fetch ?? fetch;
  const now = o.now ?? (() => Date.now() / 1000);
  const log = o.log ?? (() => {});
  // the aircraft's tiles: their planes, when fetched, the fetch running
  const tiles = new Map<string, { at: number; planes: Plane[]; src: string; run?: Promise<void> }>();
  let token: { value: string; until: number } | null = null;
  const stats = { adsbOk: 0, adsbErr: 0, skyOk: 0, skyErr: 0, aisMsgs: 0, aisOpen: false, aisErr: "" };
  const sleep = o.sleep ?? ((s: number) => Bun.sleep(s * 1000));
  // adsb.lol's pace: the asks spaced across the relay, a refusal a minute's rest
  let adsbNext = 0;
  let adsbRest = 0;
  async function adsb(url: string): Promise<Response> {
    const t = now();
    if (t < adsbRest) throw new Error("adsb.lol resting");
    const wait = Math.max(0, adsbNext - t);
    if (wait > ADSB_WAIT) throw new Error("adsb.lol busy");
    adsbNext = Math.max(t, adsbNext) + ADSB_GAP;
    if (wait > 0) await sleep(wait);
    const r = await get(url, { headers: { "user-agent": "kerr-traffic-relay (samlepirate.org)" } });
    if (r.status === 429) {
      adsbRest = now() + ADSB_REST;
      throw new Error("adsb.lol 429");
    }
    return r;
  }
  // the pages' pace: by address, the last asks
  const pace = new Map<string, number[]>();

  async function openskyToken(): Promise<string | null> {
    if (!o.openskyId || !o.openskySecret) return null;
    if (token && now() < token.until - 60) return token.value;
    const r = await get("https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: o.openskyId, client_secret: o.openskySecret }),
    });
    if (!r.ok) throw new Error(`opensky token ${r.status}`);
    const j = (await r.json()) as { access_token: string; expires_in: number };
    token = { value: j.access_token, until: now() + (j.expires_in || 1800) };
    return token.value;
  }

  async function fetchTile(lat: number, lon: number, rKm: number): Promise<{ planes: Plane[]; src: string }> {
    const nm = Math.min(250, Math.max(5, Math.ceil(rKm / 1.852)));
    try {
      const r = await adsb(`https://api.adsb.lol/v2/lat/${lat.toFixed(3)}/lon/${lon.toFixed(3)}/dist/${nm}`);
      if (!r.ok) throw new Error(`adsb.lol ${r.status}`);
      const j = (await r.json()) as { ac?: Record<string, unknown>[]; now?: number };
      const t = Number.isFinite(Number(j.now)) ? Number(j.now) / 1000 : now();
      stats.adsbOk++;
      return { planes: (j.ac ?? []).map((a) => fromAdsbLol(a, t)).filter((p): p is Plane => !!p), src: "adsb.lol" };
    } catch (e) {
      stats.adsbErr++;
      log(`traffic: ${String(e)} — OpenSky instead`);
    }
    const d = rKm / 111;
    const dl = d / Math.max(Math.cos((lat * Math.PI) / 180), 0.2);
    const tk = await openskyToken().catch(() => null);
    const r = await get(
      `https://opensky-network.org/api/states/all?lamin=${(lat - d).toFixed(3)}&lomin=${(lon - dl).toFixed(3)}&lamax=${(lat + d).toFixed(3)}&lomax=${(lon + dl).toFixed(3)}&extended=1`,
      tk ? { headers: { authorization: `Bearer ${tk}` } } : {},
    );
    if (!r.ok) {
      stats.skyErr++;
      throw new Error(`opensky ${r.status}`);
    }
    const j = (await r.json()) as { time?: number; states?: unknown[][] };
    stats.skyOk++;
    const t = Number(j.time ?? now());
    return { planes: (j.states ?? []).map((s) => fromOpenSky(s, t)).filter((p): p is Plane => !!p), src: "opensky" };
  }

  // one aircraft followed (a formation's lead, a lock): its own record, fresh — a second's cache
  const singles = new Map<string, { at: number; plane: Plane | null; run?: Promise<void> }>();
  async function plane(id: string): Promise<Plane | null> {
    const hex = id.toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 6);
    if (hex.length !== 6) return null;
    let S = singles.get(hex);
    if (!S || now() - S.at > 1) {
      if (!S?.run) {
        const run = (async () => {
          let p: Plane | null = null;
          try {
            const r = await adsb(`https://api.adsb.lol/v2/hex/${hex}`);
            if (!r.ok) throw new Error(`adsb.lol ${r.status}`);
            const j = (await r.json()) as { ac?: Record<string, unknown>[]; now?: number };
            const t = Number.isFinite(Number(j.now)) ? Number(j.now) / 1000 : now();
            p = j.ac?.[0] ? fromAdsbLol(j.ac[0], t) : null;
            stats.adsbOk++;
          } catch (e) {
            stats.adsbErr++;
            log(`traffic: ${String(e)} — OpenSky for ${hex}`);
            const tk = await openskyToken().catch(() => null);
            const r = await get(`https://opensky-network.org/api/states/all?icao24=${hex}`, tk ? { headers: { authorization: `Bearer ${tk}` } } : {});
            if (r.ok) {
              const j = (await r.json()) as { time?: number; states?: unknown[][] };
              p = j.states?.[0] ? fromOpenSky(j.states[0], Number(j.time ?? now())) : null;
              stats.skyOk++;
            } else stats.skyErr++;
          }
          singles.set(hex, { at: now(), plane: p });
        })().catch(() => {
          singles.set(hex, { at: now(), plane: S?.plane ?? null });
        });
        singles.set(hex, { ...(S ?? { at: 0, plane: null }), run });
      }
      await singles.get(hex)!.run;
      S = singles.get(hex)!;
    }
    if (singles.size > 500) for (const [k, v] of singles) if (now() - v.at > 60) singles.delete(k);
    return S.plane;
  }

  // one aircraft's last quarter of an hour: adsb.lol's recent trace (readsb's: a point at each change, a few seconds
  // apart), else OpenSky's track — cached 15 s
  const traces = new Map<string, { at: number; pts: Plane[]; run?: Promise<void> }>();
  async function trace(id: string): Promise<Plane[]> {
    const hex = id.toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 6);
    if (hex.length !== 6) return [];
    let S = traces.get(hex);
    if (!S || now() - S.at > TRACE_TTL) {
      if (!S?.run) {
        const run = (async () => {
          let pts: Plane[] = [];
          try {
            const r = await adsb(`https://adsb.lol/data/traces/${hex.slice(-2)}/trace_recent_${hex}.json`);
            if (!r.ok) throw new Error(`adsb.lol trace ${r.status}`);
            pts = fromReadsbTrace(hex, await readJson(r));
            stats.adsbOk++;
          } catch (e) {
            stats.adsbErr++;
            log(`traffic: ${String(e)} — OpenSky's track for ${hex}`);
            const tk = await openskyToken().catch(() => null);
            const r = await get(`https://opensky-network.org/api/tracks/all?icao24=${hex}&time=0`, tk ? { headers: { authorization: `Bearer ${tk}` } } : {});
            if (r.ok) {
              pts = fromOpenSkyTrack(hex, (await r.json()) as { callsign?: string; path?: unknown[][] });
              stats.skyOk++;
            } else stats.skyErr++;
          }
          traces.set(hex, { at: now(), pts });
        })().catch(() => {
          traces.set(hex, { at: now(), pts: S?.pts ?? [] });
        });
        traces.set(hex, { ...(S ?? { at: 0, pts: [] }), run });
      }
      await traces.get(hex)!.run;
      S = traces.get(hex)!;
    }
    if (traces.size > 300) for (const [k, v] of traces) if (now() - v.at > 300) traces.delete(k);
    return S.pts;
  }

  /** The aircraft within `rKm` of a place: its tile's (half a degree, by radius) from the cache or fetched. */
  async function air(lat: number, lon: number, rKm: number): Promise<{ planes: Plane[]; src: string }> {
    const r = Math.min(R_MAX, Math.max(10, rKm));
    const rc = r <= 50 ? 50 : r <= 100 ? 100 : R_MAX;
    const tl = Math.round(lat * 2) / 2,
      tn = Math.round(lon * 2) / 2;
    const key = `${tl},${tn},${rc}`;
    let T = tiles.get(key);
    const ttl = T?.src === "opensky" ? SKY_TTL : AIR_TTL;
    if (!T || now() - T.at > ttl) {
      if (!T?.run) {
        const run = fetchTile(tl, tn, rc + 40)
          .then((x) => {
            tiles.set(key, { at: now(), planes: x.planes, src: x.src });
          })
          .catch((e) => {
            log(`traffic: ${String(e)}`);
            tiles.set(key, { at: now(), planes: T?.planes ?? [], src: T?.src ?? "none" });
          });
        tiles.set(key, { ...(T ?? { at: 0, planes: [], src: "none" }), run });
      }
      await tiles.get(key)!.run;
      T = tiles.get(key)!;
    }
    // (an old tile's dropped: a few hundred kept)
    if (tiles.size > 400) for (const [k, v] of tiles) if (now() - v.at > 120) tiles.delete(k);
    return { planes: T.planes.filter((p) => km(p, { lat, lon }) <= r), src: T.src };
  }

  // ---- the ships: one aisstream connection, its zones the pages'
  const ships = new Map<number, Ship>();
  const zones = new Map<string, { lat: number; lon: number; d: number; at: number }>();
  let ws: WebSocket | null = null;
  let subscribed = "";
  let retryAt = 0;

  function boxes(): number[][][] {
    const list = [...zones.values()].sort((a, b) => b.at - a.at).slice(0, ZONES_MAX);
    return list.map((z) => [
      [Math.max(-90, z.lat - z.d), Math.max(-180, z.lon - z.d * 1.5)],
      [Math.min(90, z.lat + z.d), Math.min(180, z.lon + z.d * 1.5)],
    ]);
  }

  function aisTick() {
    const t = now();
    for (const [k, z] of zones) if (t - z.at > ZONE_KEEP) zones.delete(k);
    for (const [k, s] of ships) if (t - s.t > SHIP_KEEP) ships.delete(k);
    const WS = o.WebSocket ?? (typeof WebSocket !== "undefined" ? WebSocket : undefined);
    if (!o.aisKey || !WS) return;
    if (!zones.size) {
      if (ws) {
        ws.close();
        ws = null;
        subscribed = "";
      }
      return;
    }
    const sub = JSON.stringify({ APIKey: o.aisKey, BoundingBoxes: boxes(), FilterMessageTypes: ["PositionReport", "ShipStaticData", "StandardClassBPositionReport"] });
    if (!ws && t >= retryAt) {
      const s = new WS("wss://stream.aisstream.io/v0/stream");
      ws = s;
      s.onopen = () => {
        stats.aisOpen = true;
        subscribed = sub;
        s.send(sub);
      };
      s.onmessage = async (ev: MessageEvent) => {
        stats.aisMsgs++;
        try {
          const txt = typeof ev.data === "string" ? ev.data : await new Response(ev.data as Blob).text();
          const m = JSON.parse(txt) as Record<string, unknown>;
          if (m.error) {
            stats.aisErr = String(m.error);
            return;
          }
          ingestAis(ships, m, now());
        } catch {
          /* a message unread: let go */
        }
      };
      s.onclose = () => {
        stats.aisOpen = false;
        if (ws === s) ws = null;
        retryAt = now() + 10;
      };
      s.onerror = () => {
        stats.aisErr = "socket";
      };
    } else if (ws && stats.aisOpen && sub !== subscribed) {
      // (the zones changed: the subscription renewed on the same connection)
      subscribed = sub;
      ws.send(sub);
    }
  }
  const timer = setInterval(aisTick, 5000);

  /** The ships within `rKm` of a place (its zone kept asked for). */
  function sea(lat: number, lon: number, rKm: number): Ship[] {
    const r = Math.min(R_MAX, Math.max(5, rKm));
    const key = `${Math.round(lat)},${Math.round(lon)}`;
    const fresh = !zones.has(key);
    zones.set(key, { lat: Math.round(lat), lon: Math.round(lon), d: Math.max(1, r / 111 + 0.5), at: now() });
    if (fresh) aisTick();
    return [...ships.values()].filter((s) => Number.isFinite(s.lat) && km(s, { lat, lon }) <= r);
  }

  /** Whether an address asks too fast (more than 2 a second over the last 5 s). */
  function tooFast(who: string): boolean {
    const t = now();
    const l = (pace.get(who) ?? []).filter((x) => t - x < 5);
    l.push(t);
    pace.set(who, l);
    if (pace.size > 5000) pace.clear();
    return l.length > 10;
  }

  /** A request under /traffic: its answer (null: not ours). */
  async function handle(req: Request, who = "?"): Promise<Response | null> {
    const u = new URL(req.url);
    if (!u.pathname.startsWith("/traffic")) return null;
    if (req.method === "OPTIONS") return new Response(null, { headers: { ...CORS, "access-control-allow-methods": "GET" } });
    if (u.pathname === "/traffic/trace") {
      if (tooFast(`${who}:trace`)) return Response.json({ error: "slow down" }, { status: 429, headers: CORS });
      return Response.json({ t: now(), trace: await trace(u.searchParams.get("id") ?? ""), attribution: ATTR_AIR }, { headers: CORS });
    }
    if (u.pathname === "/traffic/plane") {
      if (tooFast(`${who}:plane`)) return Response.json({ error: "slow down" }, { status: 429, headers: CORS });
      const p = await plane(u.searchParams.get("id") ?? "");
      return Response.json({ t: now(), plane: p, attribution: ATTR_AIR }, { headers: CORS });
    }
    if (u.pathname === "/traffic/health")
      return Response.json({ ...stats, tiles: tiles.size, ships: ships.size, zones: zones.size, ais: !!o.aisKey, opensky: !!o.openskyId }, { headers: CORS });
    const lat = Number(u.searchParams.get("lat")),
      lon = Number(u.searchParams.get("lon")),
      r = Number(u.searchParams.get("r") ?? 100);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
      return Response.json({ error: "lat, lon" }, { status: 400, headers: CORS });
    if (tooFast(who)) return Response.json({ error: "slow down" }, { status: 429, headers: CORS });
    if (u.pathname === "/traffic/air") {
      try {
        const a = await air(lat, lon, r);
        return Response.json({ t: now(), planes: a.planes, src: a.src, attribution: ATTR_AIR }, { headers: CORS });
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 502, headers: CORS });
      }
    }
    if (u.pathname === "/traffic/sea")
      return Response.json({ t: now(), ships: sea(lat, lon, r), live: stats.aisOpen, ais: !!o.aisKey, attribution: ATTR_SEA }, { headers: CORS });
    return Response.json({ error: "air, sea, health" }, { status: 404, headers: CORS });
  }

  return {
    handle,
    air,
    plane,
    trace,
    sea,
    stats,
    ships,
    close() {
      clearInterval(timer);
      ws?.close();
    },
  };
}

export type Traffic = ReturnType<typeof createTraffic>;
