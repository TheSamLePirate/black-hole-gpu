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
  type NetEvent,
  PROTO_VERSION,
  type Role,
  type RoomClock,
  type RoomInfo,
  roomTime,
  type ServerMsg,
} from "./proto";
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
}

export interface Room {
  code: string;
  name: string;
  slot: number;
  role: Role;
  clock: RoomClock;
  members: Member[];
  password?: string;
}

type Events = {
  status: NetStatus;
  roster: Member[];
  event: { from: number; ev: NetEvent };
  error: { code: string; msg: string };
  room: Room | null;
};

export class NetClient {
  status: NetStatus = "off";
  room: Room | null = null;
  readonly clock = new NetClock();
  readonly remotes = new RemoteRegistry();
  /** the server's version once welcomed */
  server = { v: 0, build: "" };
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

  private request<T extends ServerMsg>(m: ClientMsg & { id: number }): Promise<T> {
    return new Promise((ok, ko) => {
      this.pending.set(m.id, { ok: ok as (m: ServerMsg) => void, ko });
      this.sendMsg(m);
      setTimeout(() => {
        if (this.pending.delete(m.id)) ko(new Error("timeout"));
      }, 10_000);
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
          for (const slot of this.remotes.tracks.keys()) if (!m.members.some((x) => x.slot === slot)) this.remotes.drop(slot);
        }
        this.emit("roster", m.members);
        return;
      case "event":
        this.emit("event", { from: m.from, ev: m.ev });
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

  private setRoom(r: Room | null) {
    this.room = r;
    this.remotes.clear();
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
    const r: Room = { code: j.code, name: j.name, slot: j.slot, role, clock: j.clock, members: j.members, password };
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

  /** a reliable event to the room */
  event(ev: NetEvent) {
    if (this.room) this.sendMsg({ type: "event", ev });
  }

  /** the room's time now [s] */
  roomNow(): number {
    return this.room ? roomTime(this.room.clock, this.clock.serverNow(this.now())) : Number.NaN;
  }

  /** Our craft's sample, sent to the room (its slot, its sequence and its time stamped here). */
  sendCraft(s: Omit<CraftSample, "slot" | "seq" | "t"> & { t?: number }) {
    if (!this.room || !this.link?.open) return;
    const full: CraftSample = { ...s, slot: this.room.slot, seq: this.seq++ & 0xffff, t: s.t ?? this.roomNow() };
    this.link.send(encodeCraft(full));
  }

  get bytes() {
    return this.link?.bytes ?? { up: 0, down: 0 };
  }
}
