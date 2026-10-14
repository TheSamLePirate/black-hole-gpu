// The room server (docs/PLAN-RESEAU.md, « Transport », « Salles et sessions »): the rooms and their members,
// the clock every page reads, the room's events relayed, the craft samples passed on to the others, the
// rooms kept in SQLite until their owner deletes them. Mounted on its own (server/main.ts, the image at
// stream.samlepirate.org) and on the dev server (server.ts, /net).

import { Database } from "bun:sqlite";
import type { Server, ServerWebSocket } from "bun";
import {
  CODE_ALPHABET,
  type ClientMsg,
  CRAFT_BYTES,
  type ErrorCode,
  isCode,
  MAX_DEVICES,
  MAX_PILOTS,
  type Member,
  MSG_CRAFT,
  normCode,
  PROTO_MIN,
  PROTO_VERSION,
  roomTime,
  type Role,
  type RoomClock,
  type RoomInfo,
  type ServerMsg,
} from "../src/net/proto";

export interface Peer {
  kind: "rooms";
  hello: boolean;
  device: string;
  name: string;
  colour: string;
  role: Role;
  slot: number;
  room: string | null;
  /** binary frames this second (a page gone mad is cut off) */
  rate: { at: number; n: number };
  /** the warp this pilot asks for (×, docs/PLAN-RESEAU.md R6): the room runs at the slowest asked */
  want: number;
}

interface RoomRec {
  code: string;
  name: string;
  owner: string;
  pass: string | null;
  clock: RoomClock;
  created: number;
  used: number;
  /** the devices seen in it: their last name and colour (R1: their craft) */
  world: Record<string, { name: string; colour: string; seen: number }>;
}

interface Live {
  rec: RoomRec;
  peers: Map<number, ServerWebSocket<Peer>>;
  /** the match running, as its last start or end was said (docs/PLAN-RESEAU.md R3): a newcomer told at once */
  match?: { from: number; ev: Record<string, unknown> };
}

export interface RoomsOptions {
  /** the SQLite file (":memory:" in tests) */
  db: string;
  build?: string;
  /** the pages allowed to connect (their Origin); none given: any */
  origin?: (o: string) => boolean;
  /** the server's clock [ms] */
  now?: () => number;
  /** rooms at most */
  maxRooms?: number;
  /** the TURN relay (coturn, its REST API's shared secret): credentials of a few hours made for each page */
  turn?: { secret: string; urls: string[] } | null;
}

const sha256 = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");
const clean = (s: unknown, n: number) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f<>]/g, "")
    .trim()
    .slice(0, n);
const colour = (s: unknown) => (/^#[0-9a-f]{6}$/i.test(String(s)) ? String(s) : "#7fd4ff");

/** The default origins: the site, its GitHub Pages, and any localhost. */
export const defaultOrigin = (o: string) => {
  try {
    const u = new URL(o);
    return (
      u.origin === "https://samlepirate.org" ||
      u.origin === "https://www.samlepirate.org" ||
      u.origin === "https://thesamlepirate.github.io" ||
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1"
    );
  } catch {
    return false;
  }
};

/** a change of the room's pace takes effect this long after it is decided [ms] */
const WARP_LEAD = 150;

export function createRooms(o: RoomsOptions) {
  const now = o.now ?? (() => performance.timeOrigin + performance.now());
  const build = o.build ?? "dev";
  const db = new Database(o.db, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run(`CREATE TABLE IF NOT EXISTS rooms (
    code TEXT PRIMARY KEY, name TEXT, owner TEXT, pass TEXT, clock TEXT, world TEXT, created INTEGER, used INTEGER)`);
  const live = new Map<string, Live>();
  const dirty = new Set<string>();
  let closed = false;

  const load = (code: string): RoomRec | null => {
    const r = db.query("SELECT * FROM rooms WHERE code = ?").get(code) as Record<string, unknown> | null;
    if (!r) return null;
    return {
      code: r.code as string,
      name: r.name as string,
      owner: r.owner as string,
      pass: (r.pass as string | null) ?? null,
      clock: JSON.parse(r.clock as string),
      world: JSON.parse((r.world as string) || "{}"),
      created: r.created as number,
      used: r.used as number,
    };
  };
  const save = (r: RoomRec) =>
    !closed &&
    db
      .query("INSERT OR REPLACE INTO rooms (code, name, owner, pass, clock, world, created, used) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(r.code, r.name, r.owner, r.pass, JSON.stringify(r.clock), JSON.stringify(r.world), r.created, r.used);
  // (written every 2 s at most, and when the server stops)
  const flush = () => {
    for (const code of dirty) {
      const l = live.get(code);
      if (l) save(l.rec);
    }
    dirty.clear();
  };
  const timer = setInterval(flush, 2000);

  const newCode = () => {
    for (;;) {
      const bytes = crypto.getRandomValues(new Uint8Array(6));
      const c = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
      if (!live.has(c) && !load(c)) return c;
    }
  };

  const send = (ws: ServerWebSocket<Peer>, m: ServerMsg) => ws.send(JSON.stringify(m));
  const fail = (ws: ServerWebSocket<Peer>, code: ErrorCode, msg: string, re?: number) => send(ws, { type: "error", re, code, msg });
  const members = (l: Live): Member[] =>
    [...l.peers.values()].map((w) => ({ slot: w.data.slot, name: w.data.name, colour: w.data.colour, role: w.data.role, device: w.data.device }));
  const roster = (l: Live) => {
    const m: ServerMsg = { type: "roster", members: members(l) };
    for (const w of l.peers.values()) send(w, m);
  };

  /** the warp each pilot asks for, by slot */
  const wants = (l: Live): Record<number, number> => {
    const out: Record<number, number> = {};
    for (const w of l.peers.values()) if (w.data.role === "pilot") out[w.data.slot] = w.data.want;
    return out;
  };
  /**
   * The room's warp (docs/PLAN-RESEAU.md R6): the slowest any pilot asks for — one slowing down slows everyone at
   * once; a faster one waits until every pilot asks for it too (the vote). Its clock carried on from now at the new
   * pace; everyone told (with each one's ask: the votes). `say`: told even unchanged (an ask changed).
   */
  const rewarp = (l: Live, say: boolean, slowedAt?: number) => {
    const asks = Object.values(wants(l));
    const w = asks.length ? Math.min(...asks) : l.rec.clock.warp;
    const c = l.rec.clock;
    if (w !== c.warp) {
      // (a slowdown dated when its pilot slowed — his page did at once: the others, a little ahead, ease back —;
      // a speed-up set a little ahead — every page told before it comes —: all at one instant of the server's clock)
      const t = now();
      const h = w < c.warp && Number.isFinite(slowedAt) ? Math.max(Math.min(slowedAt!, t), t - 1000, c.h0) : t + WARP_LEAD;
      l.rec.clock = { t0: roomTime(c, h), h0: h, warp: w };
      dirty.add(l.rec.code);
      say = true;
    }
    if (!say) return;
    const m: ServerMsg = { type: "clock", clock: l.rec.clock, wants: wants(l) };
    for (const p of l.peers.values()) send(p, m);
  };

  const leave = (ws: ServerWebSocket<Peer>) => {
    const code = ws.data.room;
    if (!code) return;
    const l = live.get(code);
    ws.data.room = null;
    ws.unsubscribe(`room:${code}`);
    if (!l) return;
    if (l.peers.get(ws.data.slot) === ws) l.peers.delete(ws.data.slot);
    l.rec.used = now();
    dirty.add(code);
    if (l.peers.size) {
      roster(l);
      rewarp(l, true);
    } else {
      // (nobody left: the world runs on at ×1 until someone comes back)
      if (l.rec.clock.warp !== 1) {
        const h = now();
        l.rec.clock = { t0: roomTime(l.rec.clock, h), h0: h, warp: 1 };
      }
      save(l.rec);
      dirty.delete(code);
      live.delete(code);
    }
  };

  const handle = (ws: ServerWebSocket<Peer>, m: ClientMsg) => {
    const P = ws.data;
    if (m.type === "hello") {
      if (!(m.v >= PROTO_MIN && m.v <= PROTO_VERSION)) return fail(ws, "update", "This page is too old for the room server: reload it.");
      P.hello = true;
      P.device = clean(m.device, 64) || crypto.randomUUID();
      P.name = clean(m.name, 24) || "Pilot";
      P.colour = colour(m.colour);
      return send(ws, { type: "welcome", v: PROTO_VERSION, build, s: now() });
    }
    if (m.type === "ping") return send(ws, { type: "pong", c: m.c, s: now() });
    if (!P.hello) return fail(ws, "bad", "hello first");
    switch (m.type) {
      case "profile": {
        P.name = clean(m.name, 24) || P.name;
        P.colour = colour(m.colour);
        const l = P.room ? live.get(P.room) : null;
        if (l) roster(l);
        return;
      }
      case "create": {
        const count = (db.query("SELECT COUNT(*) AS n FROM rooms").get() as { n: number }).n;
        if (count >= (o.maxRooms ?? 1000)) return fail(ws, "limit", "Too many rooms on this server", m.id);
        const owner = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
        const t = Number.isFinite(m.t) ? m.t : 0;
        const rec: RoomRec = {
          code: newCode(),
          name: clean(m.name, 40) || `${P.name}'s room`,
          owner: sha256(owner),
          pass: m.password ? sha256(String(m.password)) : null,
          clock: { t0: t, h0: now(), warp: 1 },
          created: now(),
          used: now(),
          world: {},
        };
        save(rec);
        return send(ws, { type: "created", re: m.id, code: rec.code, owner });
      }
      case "join": {
        const code = normCode(m.code);
        const l = live.get(code) ?? (() => {
          const rec = isCode(code) ? load(code) : null;
          if (!rec) return null;
          // (a room woken up: its clock carried on as it ran while nobody was in it)
          const fresh: Live = { rec, peers: new Map() };
          live.set(code, fresh);
          return fresh;
        })();
        if (!l) return fail(ws, "unknown-room", "No such room", m.id);
        if (l.rec.pass && sha256(String(m.password ?? "")) !== l.rec.pass) {
          if (!l.peers.size) live.delete(code);
          return fail(ws, "password", "Wrong password", m.id);
        }
        if (P.room) leave(ws);
        // (the same device back — a reconnection —: its slot taken back, the stale socket dropped)
        let slot = -1;
        for (const [s, w] of l.peers) if (w.data.device === P.device) slot = s;
        if (slot >= 0) {
          const old = l.peers.get(slot)!;
          old.data.room = null;
          old.close(4000, "replaced");
        } else {
          if (l.peers.size >= MAX_DEVICES) return fail(ws, "full", "The room is full", m.id);
          const role: Role = m.role === "spectator" || m.role === "instruments" ? m.role : "pilot";
          if (role === "pilot" && [...l.peers.values()].filter((w) => w.data.role === "pilot").length >= MAX_PILOTS)
            return fail(ws, "pilots-full", "Four pilots already fly in this room", m.id);
          slot = 0;
          while (l.peers.has(slot)) slot++;
        }
        P.role = m.role === "spectator" || m.role === "instruments" ? m.role : "pilot";
        // (a newcomer asks for the room's pace: his page takes it — his own ask comes after)
        P.want = l.rec.clock.warp;
        P.slot = slot;
        P.room = code;
        l.peers.set(slot, ws);
        ws.subscribe(`room:${code}`);
        l.rec.used = now();
        l.rec.world[P.device] = { name: P.name, colour: P.colour, seen: now() };
        dirty.add(code);
        send(ws, { type: "joined", re: m.id, code, name: l.rec.name, slot, clock: l.rec.clock, members: members(l) });
        roster(l);
        if (l.match) send(ws, { type: "event", from: l.match.from, ev: l.match.ev as never });
        rewarp(l, true);
        return;
      }
      case "warp": {
        if (!P.room) return fail(ws, "not-in-room", "Not in a room");
        const l = live.get(P.room);
        const w = Number(m.want);
        if (!l || !Number.isFinite(w)) return;
        P.want = Math.max(0, Math.min(1e7, w));
        rewarp(l, true, Number(m.at));
        return;
      }
      case "leave":
        return leave(ws);
      case "delete": {
        const code = normCode(m.code);
        const rec = live.get(code)?.rec ?? load(code);
        if (!rec) return fail(ws, "unknown-room", "No such room", m.id);
        if (sha256(String(m.owner)) !== rec.owner) return fail(ws, "owner", "Only its owner can delete a room", m.id);
        const l = live.get(code);
        if (l) {
          for (const w of l.peers.values()) {
            fail(w, "unknown-room", "The room was deleted");
            w.data.room = null;
            w.unsubscribe(`room:${code}`);
          }
          live.delete(code);
          dirty.delete(code);
        }
        db.query("DELETE FROM rooms WHERE code = ?").run(code);
        return send(ws, { type: "deleted", re: m.id, code });
      }
      case "info": {
        const rooms: RoomInfo[] = [];
        for (const c of (m.codes ?? []).slice(0, 50)) {
          const code = normCode(String(c));
          const l = live.get(code);
          const rec = l?.rec ?? (isCode(code) ? load(code) : null);
          if (rec) rooms.push({ code, name: rec.name, members: l?.peers.size ?? 0, hasPassword: !!rec.pass, used: rec.used });
        }
        return send(ws, { type: "info", re: m.id, rooms });
      }
      case "signal": {
        // (a WebRTC offer, answer or candidate: to the member named, nobody else)
        if (!P.room) return fail(ws, "not-in-room", "Not in a room");
        const l = live.get(P.room);
        const to = l?.peers.get(Number(m.to));
        const msg = JSON.stringify({ type: "signal", from: P.slot, data: m.data } satisfies ServerMsg);
        if (to && to !== ws && msg.length <= 16_384) to.send(msg);
        return;
      }
      case "ice": {
        // (STUN for all; the server's TURN — coturn's "use-auth-secret" — with a username of an expiry and the
        // device, its password that username's HMAC-SHA1 under the shared secret: valid 6 hours)
        const servers: { urls: string | string[]; username?: string; credential?: string }[] = [{ urls: "stun:stun.cloudflare.com:3478" }];
        if (o.turn?.secret && o.turn.urls.length) {
          const username = `${Math.floor(now() / 1000) + 6 * 3600}:${P.device.slice(0, 32)}`;
          const credential = new Bun.CryptoHasher("sha1", o.turn.secret).update(username).digest("base64");
          servers.push({ urls: o.turn.urls, username, credential });
        }
        return send(ws, { type: "ice", re: m.id, servers });
      }
      case "event": {
        if (!P.room) return fail(ws, "not-in-room", "Not in a room");
        const ev = m.ev && typeof m.ev === "object" ? m.ev : null;
        if (!ev || typeof ev.kind !== "string") return;
        const msg = JSON.stringify({ type: "event", from: P.slot, ev } satisfies ServerMsg);
        if (msg.length > 16_384) return;
        // (a match's start or end: kept for those who come in later)
        if (ev.kind === "match" || ev.kind === "matchEnd") {
          const l = live.get(P.room);
          if (l) l.match = ev.kind === "match" ? { from: P.slot, ev } : undefined;
        }
        ws.publish(`room:${P.room}`, msg);
        return;
      }
    }
  };

  return {
    /** the WebSocket upgrade of a request (undefined: upgraded), or its refusal */
    upgrade(req: Request, server: Server<Peer>): Response | undefined {
      const origin = req.headers.get("origin");
      if (origin && !(o.origin ?? (() => true))(origin)) return new Response("forbidden", { status: 403 });
      const data: Peer = { kind: "rooms", hello: false, device: "", name: "", colour: "", role: "pilot", slot: -1, room: null, rate: { at: 0, n: 0 }, want: 1 };
      return server.upgrade(req, { data }) ? undefined : new Response("expected a WebSocket", { status: 426 });
    },
    websocket: {
      open(_ws: ServerWebSocket<Peer>) {},
      message(ws: ServerWebSocket<Peer>, raw: string | Buffer) {
        if (typeof raw === "string") {
          if (raw.length > 65_536) return;
          let m: ClientMsg;
          try {
            m = JSON.parse(raw) as ClientMsg;
          } catch {
            return;
          }
          if (m && typeof m === "object") handle(ws, m);
          return;
        }
        // a craft's sample: its slot stamped, passed on to the room's others
        const P = ws.data;
        if (!P.room || raw.byteLength !== CRAFT_BYTES || raw[0] !== MSG_CRAFT) return;
        const t = now();
        if (t - P.rate.at > 1000) P.rate = { at: t, n: 0 };
        if (++P.rate.n > 150) return;
        raw[1] = P.slot;
        ws.publish(`room:${P.room}`, raw);
      },
      close(ws: ServerWebSocket<Peer>) {
        leave(ws);
      },
    },
    health() {
      let peers = 0;
      for (const l of live.values()) peers += l.peers.size;
      const rooms = (db.query("SELECT COUNT(*) AS n FROM rooms").get() as { n: number }).n;
      return { ok: true, v: PROTO_VERSION, build, rooms, live: live.size, peers };
    },
    close() {
      clearInterval(timer);
      flush();
      for (const l of live.values()) save(l.rec);
      closed = true;
      live.clear();
      db.close();
    },
  };
}

export type Rooms = ReturnType<typeof createRooms>;
