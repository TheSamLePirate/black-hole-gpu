// A match in a room (docs/PLAN-RESEAU.md, R3 — game/match.ts): started by a pilot for the room's pilots — the
// fights together against the aggressors, everyone against everyone, two teams, a gate race, a landing contest
// —, its rules the same for all, a countdown on the room's clock, each pilot put at his start at its end. In a
// fight: the others in this world (their craft where the network puts them, their team-mates friendly), the
// host's aggressors run on his world and sent to the others (their place, their missiles), every pilot's
// missiles sent to the others (warned of, drawn, their smoke), a hit on another sent to him and applied there,
// his countermeasures drawing our missiles too, shot down: said to all, flown again a few seconds later. Its score
// sheet built from what is said; its end the host's; a bar, a kill feed, the big words and the end screen.

import "./netmatch.css";
import type { CameraController } from "../controls";
import type { MissileKind, V3 } from "../game/combat";
import { LOADOUTS } from "../game/combat";
import { proxyGone } from "../controller/fightproxy";
import { crashView, FALL_CAP, fallStep, startFall } from "../game/wreckfall";
import { geodeticNormal, WGS84_A, WGS84_F } from "../system/ellipsoid";
import { heightOverGround } from "../system/our-surface";
import { M_METRES } from "../units";
import { fleet } from "../fleet";
import type { GameTools } from "../game/tools";
import {
  challengeOf,
  DEFAULT_RULES,
  dealTeams,
  FREE_FIGHT,
  FREE_RULES,
  LANDINGS,
  type Match,
  type MatchMode,
  type MatchRules,
  RACES,
  respawnOf,
  ScoreSheet,
  scenarioOf,
  spawnOf,
} from "../game/match";
import { SCENARIOS } from "../game/scenarios";
import { t, tf, tr } from "../i18n";
import { VESSELS } from "../vessels";
import { button, el as h } from "./kit";
import type { NetPanel } from "./netpanel";
import type { NetSession } from "./netsession";

export interface NetMatchDeps {
  camera: CameraController;
  tools: GameTools;
  panel: NetPanel;
  session: NetSession;
  toast(s: string): void;
  /** a collision another found with our craft (main.ts: ours destroyed too) */
  collide(slot: number, name: string): void;
}

type Client = NonNullable<NetPanel["net"]>;

/** a pilot's combat state as sent (10 times a second): his missiles; the host's: his aggressors and theirs */
interface CombatState {
  /** [id, kind, e, n, u, ve, vn, vu, target ("s<slot>" a pilot, "a<id>" an aggressor, ""), red] */
  ms: [number, MissileKind, number, number, number, number, number, number, string, 0 | 1][];
  /** [id, e, n, u, ve, vn, vu, fe, fn, fu, ue, un, uu, alive] */
  ai?: number[][];
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const fmtClock = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;
const WEAPON: Record<string, string> = {
  aim9x: "AIM-9X",
  aim120: "AIM-120",
  r73: "R-73",
  sam: "SAM",
  gun: "GUN",
  jdam: "JDAM",
  jsm: "JSM",
  collision: "✶",
};

export /** each mode in a line (the room panel's) */
const MODE_ABOUT: Record<MatchMode, () => string> = {
  coop: () => t("Together against drones or aggressors flown by the host"),
  ffa: () => t("Everyone for himself, in F-35s: the most kills wins"),
  teams: () => t("Two teams of two, in F-35s: the team with the most kills"),
  race: () => t("Through the gates, each in his craft: the best time wins"),
  landing: () => t("Each lands on the runway: the best graded landing wins"),
  free: () => t("In a room, in F-35s, no match: every craft a target, friendly fire on"),
};

const MODE_NAMES: Record<MatchMode, () => string> = {
  coop: () => t("Together against the aggressors"),
  ffa: () => t("Everyone for himself"),
  teams: () => t("Two teams"),
  race: () => t("Gate race"),
  landing: () => t("Landing contest"),
  free: () => t("Free fight"),
};

export class NetMatch {
  match: Match | null = null;
  sheet: ScoreSheet | null = null;
  phase: "idle" | "countdown" | "run" | "over" = "idle";
  /** what happened, for the tests and the curious: each downing, when */
  log: string[] = [];
  /** the ranking said at the end */
  final: { slot: number; name: string; line: string }[] | null = null;
  private bound: Client | null = null;
  private unbind: (() => void)[] = [];
  private begun = false;
  private csAt = 0;
  private cs = new Map<number, { at: number; s: CombatState }>();
  /** the slots shot down, hidden until they fly again (the room's time) */
  private down = new Map<number, number>();
  /** the others shot down, their craft falling to its crash: since (the room's time) — seen, not hidden */
  private falling = new Map<number, number>();
  /** our own fall's placing of our craft (the puppet's — controller: ours while it is this one) */
  private fallPuppet: (() => ReturnType<NonNullable<CameraController["puppet"]>>) | null = null;
  private killcamSet = false;
  private lastHitFrom: number | null = null;
  private lastHitAt = -1;
  private lastHitBy = "";
  private collidedWith: number | null = null;
  private prevDamage = 0;
  /** the aggressors whose fall was said (the host's) */
  private announced = new Set<number>();
  private downSent = false;
  private respawns = 0;
  private resultSent = false;
  private feed: { text: string; at: number; colour: string }[] = [];
  private root = h("div", "nm");
  private bar = h("div", "nm-bar");
  private big = h("div", "nm-big");
  private feedEl = h("div", "nm-feed");
  private endEl = h("div", "nm-end");
  private bigUntil = 0;
  /** the match form's choices (kept: the panel is made again every second) */
  form = {
    mode: "ffa" as MatchMode,
    def: "arena",
    infinite: false,
    invulnerable: false,
    friendlyFire: false,
    enemyMissiles: true,
    limit: 300,
    scoreLimit: 5,
  };

  constructor(private d: NetMatchDeps) {
    this.root.dataset.testid = "net-match";
    this.endEl.hidden = true;
    this.root.append(this.bar, this.big, this.feedEl, this.endEl);
    this.root.hidden = true;
    document.body.append(this.root);
    // (one of our AI wingmen's wreck crashed — controller/wingmen.ts —: the room told, its explosion seen there)
    d.camera.onWingCrash = (k, p, broke) => {
      if (this.net?.room) this.net.event({ kind: "wingCrash", k, p: p.map(r1), broke: broke || undefined });
    };
  }

  private get net() {
    return this.d.panel.net;
  }

  private get me() {
    return this.net?.room?.slot ?? -1;
  }

  private nameOf(slot: number | null) {
    if (slot === null || slot < 0) return t("the aggressors");
    return this.net?.room?.members.find((m) => m.slot === slot)?.name ?? `#${slot}`;
  }

  private colourOf(slot: number | null) {
    if (slot === null || slot < 0) return "#ff7a5c";
    const m = this.match;
    if (m?.mode === "teams") return (m.teams[slot] ?? 0) === 0 ? "#6fd2ff" : "#ff6f6f";
    return this.net?.room?.members.find((x) => x.slot === slot)?.colour ?? "#ffffff";
  }

  sameTeam(a: number, b: number) {
    return !!this.sheet?.sameTeam(a, b);
  }

  // ---------------------------------------------------------------------------------- the host's start

  /** A match started by this pilot, for the room's pilots: its countdown 8 s on the room's clock. */
  start(mode: MatchMode, def: string, rules: Partial<MatchRules> = {}) {
    const net = this.net;
    if (!net?.room) return t("Not in a room");
    if (net.room.role !== "pilot") return t("Only a pilot starts a match");
    const pilots = net.room.members
      .filter((m) => m.role === "pilot")
      .map((m) => m.slot)
      .sort((a, b) => a - b);
    const m: Match = {
      id: `${this.me}-${Math.round(net.roomNow())}`,
      mode,
      def: mode === "ffa" || mode === "teams" ? "arena" : def,
      host: this.me,
      start: net.roomNow() + 8,
      rules: { ...DEFAULT_RULES, ...rules },
      pilots,
      teams: mode === "teams" ? dealTeams(pilots) : {},
    };
    if (!scenarioOf(m) && !challengeOf(m)) return t("No such fight or course");
    net.event({ kind: "match", m });
    this.begin(m);
    return tf("{0} — in 8 s", MODE_NAMES[mode]());
  }

  /** The match ended by its host now (its ranking said to all). */
  stop() {
    if (!this.match || this.match.host !== this.me) return;
    this.end();
  }

  private end() {
    const ranking = this.rankingLines();
    this.net?.event({ kind: "matchEnd", id: this.match?.id, ranking });
    this.finish(ranking);
  }

  // ---------------------------------------------------------------------------------- the room's events

  private bind(net: Client | null) {
    for (const u of this.unbind) u();
    this.unbind = [];
    this.bound = net;
    if (!net) return;
    this.unbind.push(net.on("event", ({ from, ev }) => this.onEvent(from, ev as Record<string, unknown>)));
    this.unbind.push(
      net.on("room", (r) => {
        if (!r) this.reset();
      }),
    );
  }

  private reset() {
    const C = this.d.camera;
    this.fallStop();
    if (this.d.session.follow?.why === "killcam") this.d.session.setFollow(null);
    if (this.begun && C.combat?.net) C.combatEnd();
    this.match = null;
    this.sheet = null;
    this.phase = "idle";
    this.begun = false;
    this.cs.clear();
    this.down.clear();
    this.falling.clear();
    this.d.session.hidden.clear();
    this.root.hidden = true;
  }

  private onEvent(from: number, ev: Record<string, unknown>) {
    const kind = ev.kind;
    if (kind === "match") return this.begin(ev.m as Match);
    // (another's craft destroyed out of a match: said, hidden until it is set down again)
    if (kind === "crash") {
      // (a collision with us: our side down too — whoever found it first)
      if (ev.with === this.me) this.d.collide(from, this.nameOf(from));
      this.d.toast(tf("{0}: {1}", this.nameOf(from), String(ev.why ?? t("destroyed"))));
      this.d.session.hidden.set(from, true);
      setTimeout(() => this.d.session.hidden.delete(from), 5000);
      return;
    }
    // (the free fight's outside craft: one destroyed by another — gone here too —; one of our wingmen hit by him)
    if (kind === "tgtDown" && typeof ev.key === "string") {
      proxyGone(this.d.camera, ev.key);
      this.addFeed(`${this.nameOf(from)} ✕ ${String(ev.name ?? ev.key)}`, this.colourOf(from));
      return;
    }
    // (another's AI wingman crashed — its wreck's end —: its explosion, its smoke)
    if (kind === "wingCrash") {
      this.log.push(`${(this.net?.roomNow() ?? 0).toFixed(1)} wing crash ${from}:${String(ev.k)}`);
      const at = Array.isArray(ev.p) && ev.p.length === 3 ? (ev.p as [number, number, number]) : null;
      return this.crashSeen(`w${from}:${String(ev.k)}`, !!ev.broke, at, null);
    }
    if (kind === "hitWing" && ev.to === this.me) {
      this.d.camera.wingHurt(Number(ev.k), Number(ev.dmg) || 0, this.nameOf(from));
      this.addFeed(`${this.nameOf(from)} → ${String(ev.k)}`, this.colourOf(from));
      return;
    }
    if (!this.match) return;
    const W = this.d.camera.combat?.world;
    switch (kind) {
      case "matchEnd":
        if (ev.id === undefined || ev.id === this.match.id) this.finish(ev.ranking as never);
        return;
      case "cs":
        this.cs.set(from, { at: this.net!.roomNow(), s: ev.s as CombatState });
        return;
      case "hit": {
        this.sheet?.apply({ kind: "hit", from: ev.ai ? -1 : from });
        if (ev.to !== this.me || !W || this.d.camera.combat?.downAt !== null) return;
        this.lastHitFrom = ev.ai ? null : from;
        this.lastHitAt = this.net!.roomNow();
        this.lastHitBy = String(ev.by ?? "");
        const out = W.hurt(Number(ev.dmg) || 0, ev.by as MissileKind);
        this.d.camera.combat!.events.push(...out);
        const C = this.d.camera.combat!;
        C.say = tf("Hit by {0} — damage {1} %", this.nameOf(this.lastHitFrom), Math.round(W.damage));
        return;
      }
      case "hitAi": {
        this.sheet?.apply({ kind: "hit", from });
        if (this.match.host !== this.me || !W) return;
        const out = W.hitTarget(Number(ev.id), Number(ev.dmg) || 0, ev.by as MissileKind);
        this.d.camera.combat!.events.push(...out);
        for (const e of out)
          if (e.kind === "kill") {
            this.announced.add(e.target);
            this.net?.event({ kind: "aiDown", id: e.target, by: from, name: e.name });
            this.onAiDown(e.target, from, e.name);
          }
        return;
      }
      case "aiDown":
        return this.onAiDown(Number(ev.id), ev.by as number | null, String(ev.name ?? ""));
      case "down":
        // (a collision with us in the fight: our side down too)
        if (ev.with === this.me) this.collision(from);
        return this.onDown(Number(ev.slot), ev.by as number | null, String(ev.weapon ?? ""));
      case "impact":
        return this.onImpact(from, !!ev.broke, Array.isArray(ev.p) ? (ev.p as [number, number, number]) : null);
      case "cm":
        if (W) W.addDecoys(ev.p as V3, ev.v as V3, ev.up as V3);
        return;
      case "result":
        this.sheet?.apply({ kind: "result", slot: from, value: Number(ev.value), medal: (ev.medal as string) ?? null });
        this.addFeed(tf("{0} — {1}", this.nameOf(from), String(ev.text ?? "")), this.colourOf(from));
        return;
    }
  }

  private onAiDown(id: number, by: number | null, name: string) {
    this.sheet?.apply({ kind: "aiDown", id, by });
    this.addFeed(tf("{0} downed {1}", this.nameOf(by), name || `#${id}`), this.colourOf(by));
    const C = this.d.camera.combat;
    if (C && by === this.me) {
      C.killAt = C.t;
      C.say = tf("Splash — {0}", name);
    }
  }

  private onDown(slot: number, by: number | null, weapon: string) {
    this.log.push(`${(this.net?.roomNow() ?? 0).toFixed(1)} down ${slot} by ${by} ${weapon} (${this.phase})`);
    this.sheet?.apply({ kind: "down", slot, by });
    const net = this.net;
    const C0 = this.d.camera.combat;
    if (net && this.match) {
      const now = net.roomNow();
      // (another's craft out of control: seen falling to its crash — hidden there, his impact said —, not at once;
      // its burst where it was hit)
      if (slot !== this.me) {
        this.falling.set(slot, now);
        this.down.set(slot, now + FALL_CAP + this.match.rules.respawn + 3);
        const q = C0?.world.target(10_000 + slot);
        if (C0 && q) C0.booms.push({ p: [...q.p], t: C0.t, size: 1.5 });
      } else this.down.set(slot, now + this.match.rules.respawn + 1);
    }
    if (slot === this.me) this.d.session.hidden.set(slot, true);
    const w = WEAPON[weapon] ?? weapon.toUpperCase();
    this.addFeed(`${this.nameOf(by)} ✕ ${this.nameOf(slot)}${w ? ` · ${w}` : ""}`, this.colourOf(by));
    const C = this.d.camera.combat;
    if (C && by === this.me && slot !== this.me) {
      C.killAt = C.t;
      C.say = tf("Splash — {0}", this.nameOf(slot));
    }
    // (shot down by another, our craft not falling — not over the Earth —: the kill cam at once, his craft followed
    // until we fly again; falling: after our crash — fallFrame)
    if (slot === this.me && by !== null && by >= 0 && by !== this.me && !C0?.fall) this.d.session.setFollow(by, "killcam");
  }

  /** Another's craft crashed (or broken up in the air): its explosion where it ended (the Earth's coordinates [m], as
   *  he said it — else where the network last put his craft), its smoke rising there; hidden until he flies again. */
  private onImpact(slot: number, broke: boolean, at: [number, number, number] | null = null) {
    const net = this.net;
    if (!net || !this.match) return;
    this.log.push(`${net.roomNow().toFixed(1)} impact ${slot}${broke ? " (broke up)" : ""}`);
    this.falling.delete(slot);
    this.down.set(slot, net.roomNow() + this.match.rules.respawn + 1);
    const q = this.d.camera.combat?.world.target(10_000 + slot);
    // (his end as he said it: his last samples may already be his still eye on it)
    this.crashSeen(`s${slot}`, broke, at, q ? [...q.p] : null);
    this.d.session.hidden.set(slot, true);
  }

  /** A crash said by another (his craft's, one of his AI wingmen's): its explosion where it ended — the Earth's
   *  coordinates [m] from our craft onto the local east, north, up here, as the network's craft are placed; else
   *  `near` (the fight's frame) —, its smoke rising there. */
  private crashSeen(key: string, broke: boolean, at: [number, number, number] | null, near: V3 | null) {
    const c = this.d.camera;
    const C = c.combat;
    const own = at && C?.last ? c.netOwn() : null;
    let w: V3 | null = near;
    if (at && own && C?.last) {
      const U = geodeticNormal(WGS84_A, WGS84_F, own.p);
      const el = Math.hypot(U[0], U[1]) || 1;
      const E = [-U[1] / el, U[0] / el, 0];
      const N = [U[1] * E[2]! - U[2] * E[1]!, U[2] * E[0]! - U[0] * E[2]!, U[0] * E[1]! - U[1] * E[0]!];
      const d = [at[0] - own.p[0], at[1] - own.p[1], at[2] - own.p[2]];
      const dt = (a: number[]) => d[0]! * a[0]! + d[1]! * a[1]! + d[2]! * a[2]!;
      const P = C.last.p;
      w = [P[0] + dt(E), P[1] + dt(N), P[2] + dt(U)];
    }
    if (C && w) {
      const p: V3 = [w[0], w[1], broke ? w[2] : C.world.groundZ(w[0], w[1])];
      C.booms.push({ p, t: C.t, size: 2.5 });
      C.events.push({ kind: "explode", p, size: 2.5 });
      if (!broke) C.crashes = [...(C.crashes ?? []).filter((x) => C.t - x.t < 60), { key, p, t: C.t }];
    }
  }

  private addFeed(text: string, colour: string) {
    this.feed.unshift({ text, at: performance.now(), colour });
    this.feed = this.feed.slice(0, 5);
  }

  /** In a match's fight now (a collision is a shot down there) */
  inFight() {
    return this.phase === "run" && !!this.d.camera.combat?.net;
  }

  /** A mid-air collision in a match's fight: shot down — nobody's kill. */
  collision(slot: number) {
    const C = this.d.camera.combat;
    if (!C?.net || C.downAt !== null) return;
    this.collidedWith = slot;
    this.lastHitFrom = null;
    this.lastHitBy = "collision";
    C.events.push(...C.world.hurt(1000, "gun"));
    C.say = tf("Mid-air collision with {0}", this.nameOf(slot));
  }

  // ---------------------------------------------------------------------------------- its course

  /** A match said: its countdown begun (the place taken at its end). */
  begin(m: Match) {
    if (this.match?.id === m.id) return;
    this.fallStop();
    if (this.begun && this.d.camera.combat?.net) this.d.camera.combatEnd();
    this.match = m;
    this.sheet = new ScoreSheet(m);
    this.phase = "countdown";
    this.begun = false;
    this.final = null;
    this.cs.clear();
    this.down.clear();
    this.falling.clear();
    this.d.session.hidden.clear();
    this.respawns = 0;
    this.resultSent = false;
    this.announced.clear();
    this.prevDamage = 0;
    this.feed = [];
    this.endEl.hidden = true;
    this.root.hidden = false;
    this.d.toast(tf("Match: {0} — {1}", MODE_NAMES[m.mode](), this.titleOf(m)));
  }

  private titleOf(m: Match) {
    const sc = scenarioOf(m);
    const ch = challengeOf(m);
    return sc ? tr(sc.title) : ch ? tr(ch.title) : m.def;
  }

  /** Our part begun: the craft at its start, the fight or the judge running. */
  private beginOwn() {
    const m = this.match!;
    this.begun = true;
    const i = m.pilots.indexOf(this.me);
    if (i < 0 || this.net?.room?.role !== "pilot") return;
    const T = this.d.tools;
    const C = this.d.camera;
    if (fleet.active !== "f35") T.set("vessel", "f35");
    C.nav.on = { l: false, v: false };
    C.challengeAbort();
    if (C.combat) C.combatEnd();
    const sp = spawnOf(m, i);
    const sc = scenarioOf(m);
    const ch = challengeOf(m);
    if (sp && sc) {
      T.flyAt(sp.lat, sp.lon, sp.agl, sp.hdg, sp.speed);
      C.airFlight.cfg.flaps = 0;
      C.pilot.throttle = C.pilot.engineNow = 0.85;
      fleet.fuel.f35 = VESSELS.f35.fuelKg ?? 0;
      C.combatStart(sc, { host: m.host === this.me, rules: m.rules });
    } else if (sp && ch) {
      const s = ch.start;
      if ("field" in s) {
        T.glideTo(s.field, sp.final ?? s.final, ((sp.final ?? s.final) * 1000 * Math.tan((3 * Math.PI) / 180)) / 1000 + 0.02, 78);
        if (C.pilot.auto !== "none") C.pilot.setAuto(C.pilot.auto);
        C.pilot.auto = "none";
        C.gearInit = true;
        C.gearDown = true;
        C.gearExt = 1;
        C.airFlight.cfg.flaps = 1;
        C.pilot.throttle = C.pilot.engineNow = 0.42;
      } else {
        T.flyAt(sp.lat, sp.lon, sp.agl, sp.hdg, sp.speed);
        C.airFlight.cfg.flaps = 0;
        C.pilot.throttle = C.pilot.engineNow = 0.85;
      }
      fleet.fuel.f35 = VESSELS.f35.fuelKg ?? 0;
      C.challengeStart(ch);
    }
    this.flash(t("GO"), 1500);
  }

  /** The end: the fight left, the ranking shown. */
  private finish(ranking?: { slot: number; name: string; line: string }[]) {
    if (!this.match) return;
    this.phase = "over";
    this.final = ranking ?? this.rankingLines();
    const C = this.d.camera;
    this.fallStop();
    if (C.combat?.net) C.combatEnd();
    this.d.session.hidden.clear();
    this.showEnd();
  }

  /** The ranking as lines: the place, the name, what counts in the mode. */
  rankingLines() {
    const S = this.sheet;
    const m = this.match;
    if (!S || !m) return [];
    return S.ranking().map((r) => ({
      slot: r.slot,
      name: this.nameOf(r.slot),
      line:
        m.mode === "race"
          ? r.result === null || !Number.isFinite(r.result)
            ? t("not finished")
            : `${r.result.toFixed(1)} s${r.medal ? ` · ${r.medal}` : ""}`
          : m.mode === "landing"
            ? r.result === null
              ? t("not landed")
              : `${Math.round(r.result)}/100${r.medal ? ` · ${r.medal}` : ""}`
            : m.mode === "coop"
              ? tf("{0} downed · {1} hits", r.ai, r.hits)
              : tf("{0} kills · {1} deaths · {2} hits", r.kills, r.deaths, r.hits),
    }));
  }

  private showEnd() {
    const m = this.match!;
    this.endEl.replaceChildren();
    this.endEl.hidden = false;
    // (the ranking over the view: the room's panel, if open, out of its way)
    this.d.panel.closePanel();
    const list = h("ol", "nm-rank");
    for (const r of this.final ?? []) {
      const li = h("li", r.slot === this.me ? "me" : "");
      const dot = h("i", "nm-dot");
      dot.style.background = this.colourOf(r.slot);
      li.append(dot, h("b", "", r.name), h("span", "", r.line));
      list.append(li);
    }
    const head =
      m.mode === "teams" && this.sheet
        ? tf("Blue {0} — {1} Red", this.sheet.teamScore(0), this.sheet.teamScore(1))
        : `${MODE_NAMES[m.mode]()} — ${this.titleOf(m)}`;
    this.endEl.append(
      h("h3", "nm-end-title", t("Match over")),
      h("p", "nm-end-sub", head),
      list,
      button({
        label: t("Close"),
        testid: "nm-close",
        onClick: () => {
          this.endEl.hidden = true;
          this.reset();
        },
      }),
    );
  }

  private flash(text: string, ms: number) {
    this.big.textContent = text;
    this.bigUntil = performance.now() + ms;
  }

  // ---------------------------------------------------------------------------------- each frame

  frame() {
    const net = this.net;
    if (net !== this.bound) this.bind(net);
    this.freeStep(net);
    const m = this.match;
    if (!net?.room || !m) {
      if (!this.root.hidden && this.phase !== "over") this.root.hidden = true;
      return;
    }
    const now = net.roomNow();
    if (this.phase === "countdown") {
      const left = m.start - now;
      if (left > 0) this.big.textContent = left > 3.5 ? `${MODE_NAMES[m.mode]()} · ${Math.ceil(left)}` : String(Math.ceil(left));
      else {
        this.phase = "run";
        this.beginOwn();
      }
    } else if (this.phase === "run") this.run(net, now);
    // (the slots shot down fly again: shown again)
    for (const [s, until] of this.down) if (now > until) this.down.delete(s), this.d.session.hidden.delete(s);
    this.drawUi(now);
  }

  // ---------------------------------------------------------------------------------- the free fight

  /**
   * The free fight: in a room, in the F-35, no match nor mission, lesson or challenge of one's own — every craft a
   * target (the room's others, their wingmen and ours, the airliners, ships and carriers the radar locks), friendly
   * fire on, no score to reach, no end. A match of its own on this page alone (each pilot's), run as the others are
   * (the peers placed from the network, the hits sent, the shot down flying again); its frame anchored where it
   * began, again 150 km on. A match asked replaces it; it ends when its conditions do.
   */
  private freeStep(net: Client | null) {
    const c = this.d.camera;
    const free = this.match?.mode === "free";
    if (this.match && !free) return;
    const want =
      !!net?.room &&
      net.room.role === "pilot" &&
      fleet.active === "f35" &&
      c.s.netFreeFight !== false &&
      !c.mission &&
      !c.course &&
      c.chal?.status !== "run" &&
      !(c.combat && !c.combat.net) &&
      !!c.geoNow();
    if (!want) {
      if (free) this.freeEnd();
      return;
    }
    const now = net!.roomNow();
    const pilots = net!.room!.members.filter((x) => x.role === "pilot").map((x) => x.slot);
    if (!free) {
      const m: Match = { id: "free", mode: "free", def: "free", host: -1, start: now, rules: FREE_RULES, pilots, teams: {} };
      this.match = m;
      this.sheet = new ScoreSheet(m);
      this.phase = "run";
      this.begun = true;
      this.final = null;
      this.cs.clear();
      this.down.clear();
      this.falling.clear();
      this.respawns = 0;
      this.announced.clear();
      this.prevDamage = 0;
      this.feed = [];
      this.endEl.hidden = true;
      this.freeCombat();
      this.d.toast(t("Free fight: in a room, in the F-35 — every craft a target"));
      return;
    }
    this.match!.pilots = pilots;
    for (const s of pilots) this.sheet?.row(s);
    // (its fight gone — ended by another's —: again; far from its anchor, nothing of ours in flight: anchored here)
    const C = c.combat;
    const g = c.geoNow()!;
    const a = C?.def.anchor;
    const far = a ? Math.hypot((g.lat - a.lat) * 111_195, (g.lon - a.lon) * 111_195 * Math.cos(a.lat * (Math.PI / 180))) > 150_000 : true;
    if (!C || (far && C.downAt === null && !C.world.ownMissiles().length)) this.freeCombat();
  }

  /** The free fight's world, anchored where we are. */
  private freeCombat() {
    const c = this.d.camera;
    const g = c.geoNow()!;
    if (c.combat) c.combatEnd();
    c.combatStart({ ...FREE_FIGHT, anchor: { lat: g.lat, lon: g.lon } }, { host: true, rules: FREE_RULES });
    c.combat!.free = true;
    // (an outside craft destroyed by us: the room told — each page hides it —; another's wingman hit: the hit his)
    c.onProxyDown = (key, name) => {
      this.net?.event({ kind: "tgtDown", key, name });
      this.addFeed(`${this.nameOf(this.me)} ✕ ${name}`, this.colourOf(this.me));
    };
    c.onProxyHit = (key, damage, by) => {
      const m = /^rwg:(\d+):(\d+)$/.exec(key);
      if (m) this.net?.event({ kind: "hitWing", to: Number(m[1]), k: Number(m[2]), dmg: r1(damage), by });
    };
  }

  private freeEnd() {
    const c = this.d.camera;
    this.fallStop();
    if (c.combat?.net) c.combatEnd();
    if (this.d.session.follow?.why === "killcam") this.d.session.setFollow(null);
    this.match = null;
    this.sheet = null;
    this.phase = "idle";
    this.begun = false;
    this.down.clear();
    this.falling.clear();
    this.d.session.hidden.clear();
    this.root.hidden = true;
  }

  /** In the free fight now. */
  get freeFight() {
    return this.match?.mode === "free";
  }

  private run(net: Client, now: number) {
    const m = this.match!;
    const C = this.d.camera.combat;
    const me = this.me;
    if (C?.net && C.last) {
      const W = C.world;
      const P = C.last;
      // the others in this world: where the network puts them (from the flown craft in the local frame)
      W.setPeers(
        this.d.session.ships
          .filter((s) => m.pilots.includes(s.slot))
          .map((s) => ({
            slot: s.slot,
            name: this.nameOf(s.slot),
            p: [P.p[0] + s.enu.r[0], P.p[1] + s.enu.r[1], P.p[2] + s.enu.r[2]] as V3,
            v: s.enu.v as V3,
            fwd: s.enu.fwd as V3,
            up: s.enu.up as V3,
            alive: !this.down.has(s.slot),
            falling: this.falling.has(s.slot),
            friendly: this.sameTeam(me, s.slot),
          })),
      );
      // the host's aggressors (a guest's world), every pilot's missiles
      const hostCs = this.cs.get(m.host);
      if (m.host !== me && hostCs?.s.ai) {
        const age = Math.min(Math.max(now - hostCs.at, 0), 1);
        W.setRemoteTargets(
          hostCs.s.ai.map((a) => ({
            id: a[0]!,
            p: [a[1]! + a[4]! * age, a[2]! + a[5]! * age, a[3]! + a[6]! * age] as V3,
            v: [a[4]!, a[5]!, a[6]!] as V3,
            fwd: [a[7]!, a[8]!, a[9]!] as V3,
            up: [a[10]!, a[11]!, a[12]!] as V3,
            alive: !!a[13],
          })),
        );
      }
      const ms: Parameters<typeof W.setRemoteMissiles>[0] = [];
      for (const [from, { at, s }] of this.cs) {
        if (from === me || now - at > 2) continue;
        const age = Math.min(Math.max(now - at, 0), 0.5);
        for (const x of s.ms)
          ms.push({
            key: `${from}:${x[0]}`,
            kind: x[1],
            p: [x[2] + x[5] * age, x[3] + x[6] * age, x[4] + x[7] * age],
            v: [x[5], x[6], x[7]],
            atMe: x[8] === `s${me}`,
            red: x[9] === 1 || !this.sameTeam(from, me),
            target: x[8].startsWith("a") ? Number(x[8].slice(1)) : null,
          });
      }
      W.setRemoteMissiles(ms);
      // our hits on others: sent to them (the host's aggressors: to the host)
      for (const hh of W.netHits.splice(0)) {
        if (hh.peer !== undefined) {
          net.event({ kind: "hit", to: hh.peer, dmg: r1(hh.damage), by: hh.by, ai: hh.ai || undefined });
          if (!hh.ai) this.sheet?.apply({ kind: "hit", from: me });
        } else if (hh.target !== undefined) {
          net.event({ kind: "hitAi", id: hh.target, dmg: r1(hh.damage), by: hh.by });
          this.sheet?.apply({ kind: "hit", from: me });
        }
      }
      // (the host's aggressors downed by his own shots — those a guest's hit downed are said already): said
      if (m.host === me)
        for (const q of W.targets)
          if (q.peer === undefined && !q.alive && !this.announced.has(q.id)) {
            this.announced.add(q.id);
            net.event({ kind: "aiDown", id: q.id, by: me, name: q.name });
            this.onAiDown(q.id, me, q.name);
          }
      // (damage taken with no player's hit just before: the aggressors')
      if (W.damage > this.prevDamage && now - this.lastHitAt > 0.5) this.lastHitFrom = null;
      this.prevDamage = W.damage;
      // our countermeasures: the others' missiles may chase them
      for (const c of C.cmOut.splice(0)) net.event({ kind: "cm", p: c.p.map(r1), v: c.v.map(r1), up: c.up.map(r3) });
      // our combat state, ten times a second
      if (now - this.csAt > 0.1) {
        this.csAt = now;
        const tgt = (q: number | null) => (q === null ? "" : q === -1 ? `s${me}` : q >= 10_000 ? `s${q - 10_000}` : `a${q}`);
        const s: CombatState = {
          ms: W.ownMissiles().map((x) => [
            x.id,
            x.kind,
            r1(x.p[0]),
            r1(x.p[1]),
            r1(x.p[2]),
            r1(x.v[0]),
            r1(x.v[1]),
            r1(x.v[2]),
            tgt(x.target),
            x.owner === "red" ? 1 : 0,
          ]),
        };
        if (m.host === me)
          s.ai = W.targets
            .filter((q) => q.peer === undefined && (q.alive || W.t - q.diedAt < 20))
            .map((q) => [q.id, ...q.p.map(r1), ...q.v.map(r1), ...q.fwd.map(r3), ...q.up.map(r3), q.alive ? 1 : 0]);
        net.event({ kind: "cs", s });
      }
      // shot down: said to all; out of control to the ground, its explosion (game/wreckfall.ts); flown again after the
      // wait from the crash (not over the Earth: from the hit)
      if (C.downAt !== null && !this.downSent) {
        this.downSent = true;
        net.event({ kind: "down", slot: me, by: this.lastHitFrom, weapon: this.lastHitBy, with: this.collidedWith ?? undefined });
        this.collidedWith = null;
        this.fallBegin();
        this.onDown(me, this.lastHitFrom, this.lastHitBy);
      }
      if (C.downAt !== null) this.fallFrame(net);
      const waitFrom = C.fall ? C.fall.endAt : C.downAt;
      if (C.downAt !== null && waitFrom !== null && C.t - waitFrom > m.rules.respawn) this.respawn();
      // (another's fall whose crash was never said — lost —: ended at the cap)
      for (const [s, at] of this.falling) if (now - at > FALL_CAP + 3) this.onImpact(s, true);
      // the host's call: the end
      if (m.host === me && this.sheet) {
        const aiLeft = W.targets.filter((q) => q.peer === undefined && q.alive).length;
        if (this.sheet.over(now, aiLeft)) this.end();
      }
    }
    // a race's or a landing's result: said once
    const ch = this.d.camera.chal;
    if (ch && challengeOf(m) && ch.status !== "run" && !this.resultSent) {
      this.resultSent = true;
      const value = ch.status === "done" && ch.result ? ch.result.score : m.mode === "race" ? Number.POSITIVE_INFINITY : 0;
      const text = ch.result?.text ?? t("failed");
      const v = Number.isFinite(value) ? value : 99_999;
      net.event({ kind: "result", value: v, medal: ch.result?.medal ?? null, text });
      this.sheet?.apply({ kind: "result", slot: me, value: v, medal: ch.result?.medal ?? null });
    }
    if (!C?.net && m.host === me && this.sheet && challengeOf(m) && this.sheet.over(now)) this.end();
  }

  /** Shot down: our craft out of control — the controls cut (the stick, the throttle, the autopilot: its place is the
   *  fall's) —, falling as the fight's wrecks do; not over the Earth: none (the wait alone). */
  private fallBegin() {
    const c = this.d.camera;
    const C = c.combat;
    if (!C) return;
    const own = c.netOwn();
    if (!own) {
      C.fall = null;
      return;
    }
    C.fall = { wreck: startFall(own), last: C.t, endAt: null, at: null, view: null };
    if (c.pilot.auto !== "none") c.pilot.setAuto(c.pilot.auto);
    c.pilot.auto = "none";
    c.pilot.throttle = c.pilot.engineNow = 0;
    this.killcamSet = false;
    const put = () => {
      const F = c.combat?.fall;
      if (!F) return null;
      const W = F.wreck;
      // (crashed: watched from back along its way, above — a still eye)
      if (F.view) return c.netPlaceEarth(F.view.p, [0, 0, 0], F.view.fwd, F.view.up);
      return c.netPlaceEarth(W.p, W.v, W.fwd, W.up);
    };
    this.fallPuppet = put;
    c.puppet = put;
  }

  /** A frame of our fall: stepped on the fight's clock; at its end the explosion (ours, said to the room), its smoke,
   *  the eye on the crash; shot down by another in a match: his craft followed a while after (the kill cam). */
  private fallFrame(net: Client) {
    const c = this.d.camera;
    const C = c.combat!;
    const F = C.fall;
    if (!F) return;
    const normal = (p: [number, number, number]) => geodeticNormal(WGS84_A, WGS84_F, p);
    const height = (p: [number, number, number]) =>
      heightOverGround("earth", [p[0] / M_METRES, p[1] / M_METRES, p[2] / M_METRES] as [number, number, number]);
    if (F.endAt === null) {
      // (still the controls' cut: nothing flies it)
      c.pilot.throttle = c.pilot.engineNow = 0;
      const dt = C.t - F.last;
      F.last = C.t;
      if (!fallStep(F.wreck, dt, normal, height)) return;
      F.endAt = C.t;
      F.view = crashView(F.wreck, normal, height);
      const P = C.last;
      const broke = F.wreck.broke;
      const p: V3 = P ? [P.p[0], P.p[1], broke ? P.p[2] : Math.min(P.p[2], C.world.groundZ(P.p[0], P.p[1]))] : [0, 0, 0];
      F.at = p;
      C.booms.push({ p, t: C.t, size: 2.5 });
      C.events.push({ kind: "explode", p, size: 2.5 });
      if (!broke) C.crashes = [...(C.crashes ?? []).filter((x) => C.t - x.t < 60), { key: "me", p, t: C.t }];
      net.event({ kind: "impact", p: F.wreck.end?.map(r1), broke: broke || undefined });
      this.log.push(`${net.roomNow().toFixed(1)} impact ${this.me}${broke ? " (broke up)" : ""} after ${F.wreck.t.toFixed(1)} s`);
      return;
    }
    // (the crash seen a while; then, shot down by another in a match, his craft followed until we fly again)
    const by = this.lastHitFrom;
    if (!this.killcamSet && by !== null && by >= 0 && by !== this.me && C.t - F.endAt > 2.5) {
      this.killcamSet = true;
      this.d.session.setFollow(by, "killcam");
    }
  }

  /** Our fall's placing given up (flown again, the fight left). */
  private fallStop() {
    const c = this.d.camera;
    if (this.fallPuppet && c.puppet === this.fallPuppet) c.puppet = null;
    this.fallPuppet = null;
    if (c.combat) c.combat.fall = null;
  }

  private respawn() {
    const m = this.match!;
    this.fallStop();
    if (this.d.session.follow?.why === "killcam") this.d.session.setFollow(null);
    const C = this.d.camera;
    const CB = C.combat!;
    const sc = scenarioOf(m)!;
    const i = Math.max(0, m.pilots.indexOf(this.me));
    // (the free fight: in the air again 15 km south of where we fell, 5 000 m over the ground, heading north)
    const g = C.geoNow();
    const sp =
      m.mode === "free"
        ? g
          ? { lat: g.lat - 0.135, lon: g.lon, agl: 5000, hdg: 0, speed: 250 }
          : null
        : m.mode === "coop"
          ? spawnOf(m, i)
          : respawnOf(m, this.me, ++this.respawns);
    if (sp) {
      this.d.tools.flyAt(sp.lat, sp.lon, sp.agl, sp.hdg, sp.speed);
      C.airFlight.cfg.flaps = 0;
      C.pilot.throttle = C.pilot.engineNow = 0.85;
      fleet.fuel.f35 = VESSELS.f35.fuelKg ?? 0;
    }
    CB.world.respawn(LOADOUTS[sc.loadout]);
    this.prevDamage = 0;
    CB.downAt = null;
    this.downSent = false;
    this.lastHitFrom = null;
    this.flash(t("Back in the fight"), 1500);
  }

  private drawUi(now: number) {
    const m = this.match!;
    if (this.root.hidden) this.root.hidden = false;
    // the bar: the mode, the time, the scores
    const S = this.sheet;
    const T = now - m.start;
    const limit = m.mode === "coop" ? (scenarioOf(m)?.limit ?? 600) : m.rules.limit;
    let score = "";
    if (S && (m.mode === "ffa" || m.mode === "coop")) {
      const R = S.ranking().slice(0, 4);
      score = R.map((r) => `${this.nameOf(r.slot)} ${m.mode === "coop" ? r.ai : r.kills}`).join(" · ");
    } else if (S && m.mode === "teams") score = tf("Blue {0} — {1} Red", S.teamScore(0), S.teamScore(1));
    else if (S) score = tf("{0} of {1} finished", [...S.rows.values()].filter((r) => r.result !== null).length, S.rows.size);
    if (S && m.mode === "free") {
      const R = S.ranking().filter((r) => r.kills || r.deaths);
      score = R.slice(0, 4)
        .map((r) => `${this.nameOf(r.slot)} ${r.kills}`)
        .join(" · ");
    }
    const clock =
      m.mode === "free" ? "" : this.phase === "run" ? fmtClock(limit - T) : this.phase === "countdown" ? fmtClock(m.start - now) : "";
    const txt = `${MODE_NAMES[m.mode]()}${clock ? ` · ${clock}` : ""}${score ? `  |  ${score}` : ""}`;
    if (this.bar.textContent !== txt) this.bar.textContent = txt;
    // the big words: the countdown, shot down, back
    const C = this.d.camera.combat;
    if (this.phase === "run" && C?.downAt != null) {
      const from = C.fall ? C.fall.endAt : C.downAt;
      const left = Math.max(0, m.rules.respawn - (C.t - (from ?? C.t)));
      this.big.textContent =
        from === null
          ? tf("Shot down by {0} — out of control", this.nameOf(this.lastHitFrom))
          : tf("Shot down by {0} — back in {1} s", this.nameOf(this.lastHitFrom), Math.ceil(left));
    } else if (this.phase === "run" && performance.now() > this.bigUntil) this.big.textContent = "";
    // the kill feed: the last five, 8 s each
    const keep = this.feed.filter((f) => performance.now() - f.at < 8000);
    const key = keep.map((f) => f.text).join("|");
    if (this.feedEl.dataset.key !== key) {
      this.feedEl.dataset.key = key;
      this.feedEl.replaceChildren(
        ...keep.map((f) => {
          const e = h("div", "nm-feed-row", f.text);
          e.style.borderLeftColor = f.colour;
          return e;
        }),
      );
    }
  }

  // ---------------------------------------------------------------------------------- the panel's section

  /** The room panel's match section: a pilot starts one (the mode, what is flown, the rules); the host ends it. */
  section(): HTMLElement {
    const box = h("div", "nm-panel");
    const m = this.match;
    if (m && m.mode !== "free" && this.phase !== "over") {
      const run = h("div", "nm-running");
      run.append(h("span", "nm-live", t("Under way")), h("b", "", MODE_NAMES[m.mode]()), h("span", "", this.titleOf(m)));
      box.append(run);
      if (m.host === this.me)
        box.append(button({ label: t("End the match"), kind: "danger", testid: "nm-stop", onClick: () => this.stop() }));
      else box.append(h("p", "netp-hint", t("The one who started it ends it.")));
      return box;
    }
    if (this.net?.room?.role !== "pilot") {
      box.append(h("p", "netp-hint", t("Matches are started by the pilots: spectators and screens follow them.")));
      return box;
    }
    const F = this.form;
    const mode = h("select", "netp-in");
    mode.dataset.testid = "nm-mode";
    for (const k of ["coop", "ffa", "teams", "race", "landing"] as MatchMode[]) {
      const o = h("option", "", MODE_NAMES[k]());
      o.value = k;
      o.selected = k === F.mode;
      mode.append(o);
    }
    const what = h("select", "netp-in");
    what.dataset.testid = "nm-def";
    const fill = () => {
      what.replaceChildren();
      const k = mode.value as MatchMode;
      const list =
        k === "coop"
          ? SCENARIOS.map((s) => [s.id, tr(s.title)])
          : k === "race"
            ? RACES().map((c) => [c.id, tr(c.title)])
            : k === "landing"
              ? LANDINGS().map((c) => [c.id, tr(c.title)])
              : [["arena", t("Arena — Rogers Dry Lake")]];
      for (const [id, name] of list) {
        const o = h("option", "", name);
        o.value = id!;
        o.selected = id === F.def;
        what.append(o);
      }
      F.def = what.value;
    };
    mode.addEventListener("change", () => {
      F.mode = mode.value as MatchMode;
      fill();
    });
    what.addEventListener("change", () => (F.def = what.value));
    fill();
    const check = (label: string, key: "infinite" | "invulnerable" | "friendlyFire" | "enemyMissiles", id: string) => {
      const l = h("label", "nm-check");
      const c = h("input");
      c.type = "checkbox";
      c.checked = F[key];
      c.dataset.testid = id;
      c.addEventListener("change", () => (F[key] = c.checked));
      l.append(c, h("span", "", label));
      return { l, c };
    };
    const inf = check(t("Infinite ammunition"), "infinite", "nm-inf");
    const inv = check(t("Invulnerable"), "invulnerable", "nm-inv");
    const ff = check(t("Friendly fire"), "friendlyFire", "nm-ff");
    const em = check(t("Enemy missiles"), "enemyMissiles", "nm-em");
    const mins = h("select", "netp-in");
    for (const n of [3, 5, 10, 20]) {
      const o = h("option", "", tf("{0} min", n));
      o.value = String(n * 60);
      o.selected = n * 60 === F.limit;
      mins.append(o);
    }
    mins.addEventListener("change", () => (F.limit = Number(mins.value)));
    const kills = h("select", "netp-in");
    for (const n of [3, 5, 10, 0]) {
      const o = h("option", "", n ? tf("{0} kills", n) : t("no kill limit"));
      o.value = String(n);
      o.selected = n === F.scoreLimit;
      kills.append(o);
    }
    kills.addEventListener("change", () => (F.scoreLimit = Number(kills.value)));
    // (labelled fields; the mode said in a line; the weapons' rules only where weapons fly)
    const field = (label: string, ctl: HTMLElement) => {
      const f = h("label", "nm-field");
      f.append(h("span", "netp-lab", label), ctl);
      return f;
    };
    const about = h("p", "netp-hint nm-about", MODE_ABOUT[F.mode]());
    const grid = h("div", "nm-grid");
    grid.append(field(t("Mode"), mode), field(t("Event"), what), field(t("Duration"), mins), field(t("Score"), kills));
    const rules = h("div", "netp-row nm-rules");
    rules.append(inf.l, inv.l, ff.l, em.l);
    const fighting = () => F.mode === "coop" || F.mode === "ffa" || F.mode === "teams";
    const shape = () => {
      about.textContent = MODE_ABOUT[F.mode]();
      rules.hidden = !fighting();
      (kills.closest(".nm-field") as HTMLElement | null)?.toggleAttribute("hidden", F.mode !== "ffa" && F.mode !== "teams");
    };
    mode.addEventListener("change", shape);
    box.append(
      grid,
      about,
      rules,
      button({
        label: t("Start the match"),
        kind: "primary",
        testid: "nm-start",
        onClick: () => {
          const said = this.start(F.mode, F.def, {
            infinite: F.infinite,
            invulnerable: F.invulnerable,
            friendlyFire: F.friendlyFire,
            enemyMissiles: F.enemyMissiles,
            limit: F.limit,
            scoreLimit: F.scoreLimit,
          });
          this.d.toast(said);
          this.d.panel.closePanel();
        },
      }),
    );
    shape();
    return box;
  }
}
