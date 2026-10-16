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
import { fleet } from "../fleet";
import type { GameTools } from "../game/tools";
import {
  challengeOf,
  DEFAULT_RULES,
  dealTeams,
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
};

const MODE_NAMES: Record<MatchMode, () => string> = {
  coop: () => t("Together against the aggressors"),
  ffa: () => t("Everyone for himself"),
  teams: () => t("Two teams"),
  race: () => t("Gate race"),
  landing: () => t("Landing contest"),
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
    if (this.d.session.follow?.why === "killcam") this.d.session.setFollow(null);
    if (this.begun && C.combat?.net) C.combatEnd();
    this.match = null;
    this.sheet = null;
    this.phase = "idle";
    this.begun = false;
    this.cs.clear();
    this.down.clear();
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
    if (net && this.match) this.down.set(slot, net.roomNow() + this.match.rules.respawn + 1);
    this.d.session.hidden.set(slot, true);
    const w = WEAPON[weapon] ?? weapon.toUpperCase();
    this.addFeed(`${this.nameOf(by)} ✕ ${this.nameOf(slot)}${w ? ` · ${w}` : ""}`, this.colourOf(by));
    const C = this.d.camera.combat;
    if (C && by === this.me && slot !== this.me) {
      C.killAt = C.t;
      C.say = tf("Splash — {0}", this.nameOf(slot));
    }
    // (shot down by another: the kill cam — his craft followed until we fly again)
    if (slot === this.me && by !== null && by >= 0 && by !== this.me) this.d.session.setFollow(by, "killcam");
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
    if (this.begun && this.d.camera.combat?.net) this.d.camera.combatEnd();
    this.match = m;
    this.sheet = new ScoreSheet(m);
    this.phase = "countdown";
    this.begun = false;
    this.final = null;
    this.cs.clear();
    this.down.clear();
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
      // shot down: said to all; flown again after the wait
      if (C.downAt !== null && !this.downSent) {
        this.downSent = true;
        net.event({ kind: "down", slot: me, by: this.lastHitFrom, weapon: this.lastHitBy, with: this.collidedWith ?? undefined });
        this.collidedWith = null;
        this.onDown(me, this.lastHitFrom, this.lastHitBy);
      }
      if (C.downAt !== null && C.t - C.downAt > m.rules.respawn) this.respawn();
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

  private respawn() {
    const m = this.match!;
    if (this.d.session.follow?.why === "killcam") this.d.session.setFollow(null);
    const C = this.d.camera;
    const CB = C.combat!;
    const sc = scenarioOf(m)!;
    const i = Math.max(0, m.pilots.indexOf(this.me));
    const sp = m.mode === "coop" ? spawnOf(m, i) : respawnOf(m, this.me, ++this.respawns);
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
    const clock = this.phase === "run" ? fmtClock(limit - T) : this.phase === "countdown" ? fmtClock(m.start - now) : "";
    const txt = `${MODE_NAMES[m.mode]()} · ${clock}${score ? `  |  ${score}` : ""}`;
    if (this.bar.textContent !== txt) this.bar.textContent = txt;
    // the big words: the countdown, shot down, back
    const C = this.d.camera.combat;
    if (this.phase === "run" && C?.downAt != null) {
      const left = Math.max(0, m.rules.respawn - (C.t - C.downAt));
      this.big.textContent = tf("Shot down by {0} — back in {1} s", this.nameOf(this.lastHitFrom), Math.ceil(left));
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
    if (m && this.phase !== "over") {
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
