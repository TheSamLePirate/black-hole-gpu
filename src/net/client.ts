// The page's side of the network (docs/PLAN-RESEAU.md): the link to the room server, its clock, the room
// joined and its members, the craft samples sent and the others' read back. Reconnects by itself and takes
// its room (and its slot) back. Nothing of the game in here: the game hands it samples and reads states.

import { NetClock } from "./clock";
import {
  type ClientMsg,
  type CraftSample,
  decodeCraft,
  encodeCraft,
  type Member,
  MSG_CRAFT,
  MSG_KEEP,
  type NetEvent,
  PROTO_VERSION,
  type Role,
  type RoomClock,
  type RoomInfo,
  roomTime,
  type ServerMsg,
} from "./proto";
import { DEFAULT_ICE, p2pAvailable, PeerMesh, type SignalData } from "./p2p";
import { RemoteRegistry } from "./remote";
import { LabLink, type LabSettings, type Link, type Payload, WsLink } from "./transport";

export type NetStatus = "off" | "connecting" | "online" | "offline";

export interface NetIdentity {
  device: string;
  name: string;
  colour: string;
}

export interface NetOptions {
  url: string;
  build: string;
  id: NetIdentity;
  lab?: LabSettings | null;
  /** the local clock [ms] (performance.now) — a test's own */
  now?: () => number;
  /** a link of one's own (tests) */
  link?: (url: string) => Link;
  /** the players' direct links (WebRTC): off, the samples ride the server alone (the network lab turns them off) */
  p2p?: boolean;
  ice?: RTCIceServer[];
}

export interface Room {
  code: string;
  name: string;
  slot: number;
  role: Role;
  clock: RoomClock;
  members: Member[];
  password?: string;
  /** the warp each pilot asks for (×, by slot): the room runs at the slowest (R6) */
  wants: Record<number, number>;
  /** the clock before a change set ahead, until it comes */
  clockPrev?: RoomClock;
}

type Events = {
  status: NetStatus;
  roster: Member[];
  event: { from: number; ev: NetEvent };
  error: { code: string; msg: string };
  room: Room | null;
  voice: { slot: number; stream: MediaStream | null };
  clock: Room["clock"];
  world: NetClient["away"];
};

/** the craft of those away are read as slots from here on (R7) */
export const AWAY_SLOT = 200;

/** the server's limit on a room event, its relayed message (server/rooms.ts) [characters] */
export const EVENT_MAX = 16_384;

export class NetClient {
  status: NetStatus = "off";
  room: Room | null = null;
  readonly clock = new NetClock();
  readonly remotes = new RemoteRegistry();
  /** the server's version once welcomed */
  server = { v: 0, build: "" };
  /** the direct links to the room's others (WebRTC), null: none */
  mesh: PeerMesh | null = null;
  /** the ICE servers the room server gave (STUN, its TURN) */
  iceServers: RTCIceServer[] | null = null;
  /** when a sample last went to the server (the persistent world's: kept a second apart) */
  private keptAt = -1e9;
  /** the persistent world (R7): the craft of those away, as each left it; ours as we left it last time */
  away: { device: string; name: string; colour: string; seen: number; sample: CraftSample }[] = [];
  mine: CraftSample | null = null;
  /** the room's pace said before the room was set (joining) */
  private lastClock: { clock: RoomClock; wants: Record<number, number> } | null = null;
  /** our microphone, sent on every direct link (R2) */
  micTrack: MediaStreamTrack | null = null;
  setMic(track: MediaStreamTrack | null) {
    this.micTrack = track;
    this.mesh?.setMic(track);
  }
  /** samples sent through the server (some peer not reached directly) and straight */
  relayed = 0;
  direct = 0;
  private link: Link | null = null;
  private seq = 0;
  private reqId = 0;
  private pending = new Map<number, { ok: (m: ServerMsg) => void; ko: (e: Error) => void }>();
  private listeners = new Map<keyof Events, ((x: never) => void)[]>();
  private pingTimer: ReturnType<typeof setTimeout> | null = null;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private welcomed: Promise<void> | null = null;
  private welcome: { ok: () => void; ko: (e: Error) => void } | null = null;
  readonly now: () => number;

  constructor(readonly o: NetOptions) {
    this.now = o.now ?? (() => performance.now());
  }

  on<K extends keyof Events>(k: K, f: (x: Events[K]) => void) {
    const fs = this.listeners.get(k) ?? [];
    fs.push(f);
    this.listeners.set(k, fs);
    return () =>
      this.listeners.set(
        k,
        (this.listeners.get(k) ?? []).filter((g) => g !== f),
      );
  }

  private emit<K extends keyof Events>(k: K, x: Events[K]) {
    for (const f of this.listeners.get(k) ?? []) (f as (x: Events[K]) => void)(x);
  }

  private setStatus(s: NetStatus) {
    if (this.status === s) return;
    this.status = s;
    this.emit("status", s);
  }

  /** Opens the link (resolved once the server has welcomed us). */
  connect(): Promise<void> {
    this.closed = false;
    if (this.welcomed && this.link) return this.welcomed;
    this.welcomed = new Promise((ok, ko) => (this.welcome = { ok, ko }));
    this.setStatus("connecting");
    const raw = this.o.link ? this.o.link(this.o.url) : new WsLink(this.o.url);
    const link = this.o.lab ? new LabLink(raw, this.o.lab) : raw;
    this.link = link;
    link.onopen = () =>
      this.sendMsg({
        type: "hello",
        v: PROTO_VERSION,
        build: this.o.build,
        device: this.o.id.device,
        name: this.o.id.name,
        colour: this.o.id.colour,
      });
    link.onmessage = (m) => this.onMessage(m);
    link.onclose = () => this.lost();
    return this.welcomed;
  }

  private lost() {
    if (this.pingTimer) clearTimeout(this.pingTimer);
    this.link = null;
    this.welcomed = null;
    this.welcome?.ko(new Error("offline"));
    this.welcome = null;
    for (const p of this.pending.values()) p.ko(new Error("offline"));
    this.pending.clear();
    // (out of a room there is nothing to take back: the next request opens a link again)
    if (this.closed || !this.room) {
      this.setStatus("off");
      return;
    }
    // (the game flies on: a banner, and the link tried again — 0.5 s, 1 s, 2 s… 10 s)
    this.setStatus("offline");
    const wait = Math.min(10_000, 500 * 2 ** this.retry++);
    this.retryTimer = setTimeout(() => {
      this.connect()
        // (the room taken back, the same slot: the device is the same)
        .then(() => (this.room ? this.join(this.room.code, this.room.role, this.room.password) : null))
        .catch(() => {});
    }, wait);
  }

  /** Leaves the room and closes the link. */
  close() {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.room) this.sendMsg({ type: "leave" });
    this.setRoom(null);
    this.link?.close();
    this.link = null;
    this.welcomed = null;
    this.setStatus("off");
  }

  private sendMsg(m: ClientMsg) {
    this.link?.send(JSON.stringify(m));
  }

  private request<T extends ServerMsg>(m: ClientMsg & { id: number }, timeout = 10_000): Promise<T> {
    return new Promise((ok, ko) => {
      this.pending.set(m.id, { ok: ok as (m: ServerMsg) => void, ko });
      this.sendMsg(m);
      setTimeout(() => {
        if (this.pending.delete(m.id)) ko(new Error("timeout"));
      }, timeout);
    });
  }

  private ping() {
    this.sendMsg({ type: "ping", c: this.now() });
    // (a burst at first — 30 exchanges, settling —, then every 2 s)
    const n = this.clock.count < 30 ? 100 : 2000;
    this.pingTimer = setTimeout(() => this.ping(), n);
  }

  private onMessage(raw: Payload) {
    if (typeof raw !== "string") {
      const u = new Uint8Array(raw);
      if (u[0] === MSG_CRAFT) {
        const s = decodeCraft(u);
        if (s && this.room && s.slot !== this.room.slot) this.remotes.push(s, this.roomNow() - s.t);
      }
      return;
    }
    let m: ServerMsg;
    try {
      m = JSON.parse(raw) as ServerMsg;
    } catch {
      return;
    }
    switch (m.type) {
      case "welcome":
        this.server = { v: m.v, build: m.build };
        this.retry = 0;
        this.setStatus("online");
        this.ping();
        this.welcome?.ok();
        this.welcome = null;
        return;
      case "pong":
        this.clock.onPong(m.c, m.s, this.now());
        return;
      case "roster":
        if (this.room) {
          this.room.members = m.members;
          // (the craft of those away — slots from 200 — stay: the world's)
          for (const tr of [...this.remotes.tracks.values()])
            if (tr.slot < AWAY_SLOT && !m.members.some((x) => x.slot === tr.slot)) this.remotes.drop(tr.slot);
          this.mesh?.sync(m.members.map((x) => x.slot));
        }
        this.emit("roster", m.members);
        return;
      case "event":
        this.emit("event", { from: m.from, ev: m.ev });
        return;
      case "world": {
        const dec = (b64: string) => {
          const b = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          b[0] = MSG_CRAFT;
          return decodeCraft(b);
        };
        this.away = m.away.flatMap((a) => {
          const sample = dec(a.sample);
          return sample ? [{ device: a.device, name: a.name, colour: a.colour, seen: a.seen, sample }] : [];
        });
        if (m.mine) this.mine = dec(m.mine);
        this.emit("world", this.away);
        return;
      }
      case "clock":
        if (this.room) {
          // (a change set ahead: the pace running now kept until it comes)
          if (m.clock.h0 > this.clock.serverNow(this.now())) this.room.clockPrev = this.room.clock;
          this.room.clock = m.clock;
          this.room.wants = m.wants;
        } else this.lastClock = m;
        this.emit("clock", m.clock);
        return;
      case "signal":
        // (come before our links were set — joining, the ICE servers still asked for —: kept for them)
        if (this.mesh) void this.mesh.onSignal(m.from, m.data as SignalData);
        else if (this.earlySignals.length < 64) this.earlySignals.push({ from: m.from, data: m.data as SignalData });
        return;
      case "error":
        if (m.re !== undefined && this.pending.has(m.re)) {
          this.pending.get(m.re)!.ko(Object.assign(new Error(m.msg), { code: m.code }));
          this.pending.delete(m.re);
        } else {
          // (the room deleted under us: out of it)
          if (m.code === "unknown-room") this.setRoom(null);
          this.emit("error", { code: m.code, msg: m.msg });
        }
        return;
      default:
        if ("re" in m && this.pending.has(m.re)) {
          this.pending.get(m.re)!.ok(m);
          this.pending.delete(m.re);
        }
    }
  }

  /** the links' signals come before the links were set (joining) */
  private earlySignals: { from: number; data: SignalData }[] = [];

  private setRoom(r: Room | null) {
    this.room = r;
    if (!r) this.earlySignals = [];
    this.remotes.clear();
    this.mesh?.close();
    this.mesh = null;
    // (the direct links: each other member reached by WebRTC — not under the network lab, not in Bun)
    if (r && this.o.p2p !== false && !this.o.lab && p2pAvailable()) {
      this.mesh = new PeerMesh({
        self: () => this.room?.slot ?? -1,
        signal: (to, data) => this.sendMsg({ type: "signal", to, data }),
        onData: (buf) => this.onMessage(buf),
        ice: this.o.ice ?? this.iceServers ?? DEFAULT_ICE,
        onVoice: (slot, stream) => this.emit("voice", { slot, stream }),
      });
      if (this.micTrack) this.mesh.setMic(this.micTrack);
      this.mesh.sync(r.members.map((x) => x.slot));
      for (const e of this.earlySignals.splice(0)) void this.mesh.onSignal(e.from, e.data);
    }
    this.emit("room", r);
  }

  /** A new room, its clock started at the scene's time `t`; joined at once. */
  async create(name: string, t: number, password?: string): Promise<{ code: string; owner: string; room: Room }> {
    await this.connect();
    const c = await this.request<Extract<ServerMsg, { type: "created" }>>({ type: "create", id: ++this.reqId, name, password, t });
    const room = await this.join(c.code, "pilot", password);
    return { code: c.code, owner: c.owner, room };
  }

  async join(code: string, role: Role = "pilot", password?: string): Promise<Room> {
    await this.connect();
    const j = await this.request<Extract<ServerMsg, { type: "joined" }>>({ type: "join", id: ++this.reqId, code, role, password });
    // (the ICE servers — STUN, the server's TURN with fresh credentials — before the direct links open)
    if (!this.o.ice)
      try {
        const ice = await this.request<Extract<ServerMsg, { type: "ice" }>>({ type: "ice", id: ++this.reqId }, 2000);
        this.iceServers = ice.servers as RTCIceServer[];
      } catch {
        /* an older server: STUN alone */
      }
    // (the room's pace said right after joining — while the ICE servers were asked for —: taken)
    const C = this.lastClock;
    this.lastClock = null;
    const r: Room = {
      code: j.code,
      name: j.name,
      slot: j.slot,
      role,
      clock: C?.clock ?? j.clock,
      members: j.members,
      password,
      wants: C?.wants ?? {},
    };
    this.setRoom(r);
    this.emit("roster", j.members);
    return r;
  }

  leave() {
    if (!this.room) return;
    this.sendMsg({ type: "leave" });
    this.setRoom(null);
  }

  async remove(code: string, owner: string) {
    await this.connect();
    await this.request({ type: "delete", id: ++this.reqId, code, owner });
  }

  async info(codes: string[]): Promise<RoomInfo[]> {
    await this.connect();
    const r = await this.request<Extract<ServerMsg, { type: "info" }>>({ type: "info", id: ++this.reqId, codes });
    return r.rooms;
  }

  profile(name: string, colour: string) {
    this.o.id.name = name;
    this.o.id.colour = colour;
    this.sendMsg({ type: "profile", name, colour });
  }

  /** the reliable events sent, their characters, and those kept back for being too long (RD1: the server drops one
   *  over 16 384 characters as it reaches it — silently: counted here, the last one's kind named) */
  readonly sent = { events: 0, chars: 0, oversize: 0, lastOversize: "" };

  /** a reliable event to the room — false: not sent (no room, or too long for the server once stamped) */
  event(ev: NetEvent): boolean {
    if (!this.room) return false;
    const json = JSON.stringify({ type: "event", ev } satisfies ClientMsg);
    // (the server's relayed message: this one with its sender's slot — some 12 characters more)
    if (json.length + 16 > EVENT_MAX) {
      this.sent.oversize++;
      this.sent.lastOversize = String(ev.kind).slice(0, 24);
      return false;
    }
    this.sent.events++;
    this.sent.chars += json.length;
    this.link?.send(json);
    return true;
  }

  /** The warp we ask for (× real time; 0: paused): the room runs at its pilots' slowest (R6). A slowdown of ours is
   *  ours at once — the room's dated now —; the others ease back onto it. */
  warp(want: number) {
    if (!this.room) return;
    const h = this.clock.serverNow(this.now());
    const cur = this.clockNow(h);
    if (want < cur.warp) {
      this.room.clockPrev = undefined;
      this.room.clock = { t0: roomTime(cur, h), h0: h, warp: want };
    }
    this.sendMsg({ type: "warp", want, at: want < cur.warp ? h : undefined });
  }

  /** the room's time at an instant of our clock (performance.now() [ms]: a frame's) [s] */
  roomAt(localMs: number): number {
    if (!this.room) return Number.NaN;
    const h = this.clock.serverNow(localMs);
    return roomTime(this.clockNow(h), h);
  }

  /** the room's clock running now: a change set ahead not come yet — the one before */
  private clockNow(h: number) {
    const r = this.room!;
    if (r.clockPrev && h < r.clock.h0) return r.clockPrev;
    r.clockPrev = undefined;
    return r.clock;
  }

  /** the room's pace now (× real time) */
  roomWarp(): number {
    return this.room ? this.clockNow(this.clock.serverNow(this.now())).warp : 1;
  }

  /** the room's time now [s] */
  roomNow(): number {
    if (!this.room) return Number.NaN;
    const h = this.clock.serverNow(this.now());
    return roomTime(this.clockNow(h), h);
  }

  /** Our craft's sample, sent to the room (its slot, its sequence and its time stamped here). */
  sendCraft(s: Omit<CraftSample, "slot" | "seq" | "t"> & { t?: number }) {
    if (!this.room || !this.link?.open) return;
    const full: CraftSample = { ...s, slot: this.room.slot, seq: this.seq++ & 0xffff, t: s.t ?? this.roomNow() };
    const buf = encodeCraft(full);
    // (straight to each peer reached; through the server as well while one is not — a duplicate is dropped)
    const reached = this.mesh?.send(buf) ?? new Set<number>();
    const others = this.room.members.filter((m) => m.slot !== this.room!.slot);
    if (reached.size) this.direct++;
    if (others.some((m) => !reached.has(m.slot))) {
      this.link.send(buf);
      this.relayed++;
      this.keptAt = this.now();
    } else if (this.now() - this.keptAt > 1000 && s.kind !== 4) {
      // (all reached directly: the server kept up to date all the same — a second apart —, the world's, R7)
      new Uint8Array(buf)[0] = MSG_KEEP;
      this.link.send(buf);
      this.keptAt = this.now();
    }
  }

  get bytes() {
    return this.link?.bytes ?? { up: 0, down: 0 };
  }
}
