// The crew's orders carried out aboard (docs/PLAN-CREW-ACTIONS.md): a crew console (crew/) asks, the pilot's game
// does it — never the stick, the throttle or a free key. Heard from a member joined as "instruments" (the roster's
// role, the server's stamp), meant for us, the pilot's lock open (settings.netCrewActions), its family open now, at
// a sender's pace, each order once, its arguments checked against the act's schema and again against the game
// tool's — then done through the very functions TARS's tools are (called directly: no agent, no model), said in a
// toast with who asked, and answered to every screen.
import type { NetClient } from "../net/client";
import { ACTS, type Act, type CrewAck, CrewGate, type Family, readCrewCmd, sayOf } from "../net/crewcmd";
import type { Args } from "../ai/tool-schema";
import { checkArgs } from "../ai/tool-schema";
import type { Tool } from "../ai/agent";
import type { CameraController } from "../controls";
import type { Settings } from "../settings";
import { tf, tr } from "../i18n";
import { CHECKLISTS, type FailureKind } from "../game/systems";
import { M_SECONDS } from "../units";

export interface CrewExecDeps {
  camera: CameraController;
  settings: Settings;
  /** the game's tools (main.ts: TARS's — the same functions, called directly) */
  tools(): Tool[];
  toast(s: string): void;
  nameOf(slot: number): string;
  /** the families open now (ui/crew-feed.ts crewFamilies) */
  families(): Family[];
  /** whether a player rides aboard our craft (PLAN-VAISSEAUX N3: our copilot — his orders as a crew screen's) */
  aboard?(slot: number): boolean;
}

/** what an act does aboard: the game tool and its arguments, or the controller's own call; its words back */
export interface ExecCtx {
  camera: CameraController;
  /** a game tool run with its arguments checked against its own schema; its result (short), or throws */
  tool(name: string, args: Args): Promise<unknown>;
}
type Run = (a: Args, x: ExecCtx) => unknown | Promise<unknown>;

const RUN: Record<Act, Run> = {
  "cfg.ack": (_a, x) => x.tool("flight_action", { action: "acknowledge" }),
  // (the controls tool for its switches alone)
  "cfg.gear": (a, x) => x.tool("controls", { gear: a.down }),
  "cfg.flaps": (a, x) => x.tool("controls", { flaps: a.pos }),
  "cfg.brake": (a, x) => x.tool("controls", { airBrake: a.on }),
  "cfg.sas": (a, x) => x.tool("controls", { sas: a.on }),
  // (the flight plan: its tool's operations; a point changed in place by the controller's own)
  "nav.add": (a, x) =>
    x.tool("flight_plan", {
      action: "add",
      ...(a.query !== undefined ? { query: a.query } : { lat: a.lat, lon: a.lon }),
      ...(a.alt !== undefined ? { altM: a.alt } : {}),
      ...(a.spd !== undefined ? { spdMs: a.spd } : {}),
      ...(a.index !== undefined ? { index: a.index } : {}),
    }),
  "nav.remove": (a, x) => x.tool("flight_plan", { action: "remove", index: a.index }),
  "nav.move": (a, x) => x.camera.routeSetPoint(Number(a.index), { lat: Number(a.lat), lon: Number(a.lon) }),
  "nav.point": (a, x) =>
    x.camera.routeSetPoint(Number(a.index), {
      ...(a.clearAlt ? { alt: null } : a.alt !== undefined ? { alt: Number(a.alt) } : {}),
      ...(a.clearSpd ? { spd: null } : a.spd !== undefined ? { spd: Number(a.spd) } : {}),
    }),
  "nav.clear": (_a, x) => x.tool("flight_plan", { action: "clear" }),
  "nav.cruise": (a, x) =>
    x.tool("flight_plan", {
      action: "cruise",
      ...(a.alt !== undefined ? { altM: a.alt } : {}),
      ...(a.spd !== undefined ? { spdMs: a.spd } : {}),
      ...(a.reserve !== undefined ? { reserveKg: a.reserve } : {}),
    }),
  "nav.direct": (a, x) => x.tool("flight_plan", { action: "direct", index: a.index }),
  "nav.procedures": (_a, x) => x.tool("approach", { action: "procedures" }),
  "nav.target": (a, x) => x.tool("set_target", { name: a.name }),
  // (the aircraft's autopilot: its selectors, its modes, its approaches — never the afterburner or the throttle)
  "ap.set": (a, x) =>
    x.camera.apSet({
      ...(a.alt !== undefined ? { alt: Number(a.alt) } : {}),
      ...(a.hdgDeg !== undefined ? { hdg: (Number(a.hdgDeg) * Math.PI) / 180 } : {}),
      ...(a.spd !== undefined ? { spd: Number(a.spd) } : {}),
    }),
  "ap.engage": (a, x) =>
    x.camera.apSet({ ...(a.ap !== undefined ? { ap: !!a.ap } : {}), ...(a.athr !== undefined ? { athr: !!a.athr } : {}) }),
  "ap.nav": (a, x) =>
    x.camera.navSet({ ...(a.lnav !== undefined ? { l: !!a.lnav } : {}), ...(a.vnav !== undefined ? { v: !!a.vnav } : {}) }),
  "ap.ils": (a, x) => x.tool("approach", { action: "ils", ...(a.field ? { field: a.field } : {}) }),
  "ap.ilsOff": (_a, x) => x.tool("approach", { action: "off" }),
  "ap.mode": (a, x) => {
    const { mode, ...rest } = a;
    return x.tool("jet_mode", { action: mode, ...rest });
  },
  "ap.traffic": (a, x) => x.tool("traffic", { action: a.action, ...(a.name ? { name: a.name } : {}) }),
  "ap.goAround": (_a, x) => x.tool("flight_action", { action: "go_around" }),
  // (the spacecraft's flight computer: its tools, a manoeuvre or a mission previewed (execute: false) or flown)
  "sp.hold": (a, x) => x.tool("hold", { direction: a.direction }),
  "sp.auto": (a, x) => x.tool("autopilot", a),
  "sp.maneuver": (a, x) => x.tool("plan_maneuver", a),
  "sp.mission": (a, x) => x.tool("plan_mission", a),
  "sp.plan": (a, x) => x.tool("manage_plan", { action: a.action }),
  "sp.target": (a, x) => x.tool("set_target", { name: a.name }),
  "sp.release": (_a, x) => x.tool("flight_action", { action: "release" }),
  // (PLAN-VAISSEAUX K6: the controller's own calls — the docking's, the ring's, the plan's burns, the systems')
  "sp.dock": (a, x) => {
    const C = x.camera;
    if (a.action === "undock") return C.docked ? (C.undock(), "Désamarré") : "Not docked";
    if (a.action === "refuel") return C.refuelFromDocked();
    if (a.action === "rcs") return C.rcsModeToggle();
    return C.keepKey();
  },
  "sp.ring": (a, x) => (a.dir === 0 ? "No such direction" : x.camera.ringSet(Number(a.dir) > 0 ? 1 : -1)),
  "sp.node": (a, x) => {
    const C = x.camera;
    const i = Number(a.index);
    if (!C.plan.nodes[i]) return "No such burn";
    if (a.action === "delete") {
      C.deleteNode(i);
      return "Poussée supprimée";
    }
    C.nudgeNode(i, [0, 0, 0], Number(a.dtS ?? 0) / M_SECONDS);
    return "Poussée déplacée";
  },
  // (the refusals said as such, whatever the pilot's language: the console's French)
  "sys.step": (a, x) => {
    const k = a.kind as FailureKind;
    if (!x.camera.systemsInfo()?.failures.some((f) => f.kind === k)) return { ok: false, note: "Cette panne n'est pas en cours" };
    return x.camera.systemsTick(k, Number(a.step), !!a.on);
  },
  "sys.fix": (a, x) => {
    const k = a.kind as FailureKind;
    if (!x.camera.systemsInfo()?.failures.some((f) => f.kind === k)) return { ok: false, note: "Cette panne n'est pas en cours" };
    if ((x.camera.sysTicks.get(`f:${k}`)?.size ?? 0) < CHECKLISTS[k].steps.length)
      return { ok: false, note: "La checklist d'abord : toutes les étapes cochées" };
    return x.camera.systemsFixChecked(k);
  },
  // (the F-35's weapons: the backseater's — the weapons tool's actions)
  "wp.radar": (a, x) => x.tool("weapons", { action: "radar", mode: a.mode }),
  "wp.select": (a, x) => x.tool("weapons", { action: "select", weapon: a.weapon }),
  "wp.lock": (a, x) => x.tool("weapons", { action: "lock", ...(a.target ? { target: a.target } : {}) }),
  "wp.fire": (_a, x) => x.tool("weapons", { action: "fire" }),
  "wp.gun": (a, x) => x.tool("weapons", { action: "gun", seconds: a.seconds ?? 1 }),
  "wp.cm": (_a, x) => x.tool("weapons", { action: "countermeasures" }),
};

/** a tool's result, unwrapped from what the game said meanwhile: its value, the game's lines */
function unwrap(r: unknown): { v: unknown; said: string[] } {
  if (r && typeof r === "object" && "result" in r && "game" in r) {
    const o = r as { result: unknown; game: unknown };
    return { v: o.result, said: Array.isArray(o.game) ? o.game.filter((x): x is string => typeof x === "string") : [] };
  }
  return { v: r, said: [] };
}
/** a result as a short line (its own words when it says something), whether it says no (ok: false), its figures */
function readResult(r: unknown): { line: string; refused: boolean; data: Record<string, string | number | boolean> } {
  const { v, said } = unwrap(r);
  const data: Record<string, string | number | boolean> = {};
  let line = "",
    refused = false;
  if (typeof v === "string") line = v;
  else if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (o.ok === false) refused = true;
    for (const k of ["note", "said", "result", "message", "msg", "status"]) if (!line && typeof o[k] === "string") line = o[k] as string;
    for (const [k, x] of Object.entries(o)) {
      if (Object.keys(data).length >= 10) break;
      if (typeof x === "number" || typeof x === "boolean" || (typeof x === "string" && x.length <= 120)) data[k] = x;
      else if (Array.isArray(x)) {
        data[`${k}N`] = x.length;
        // (a manoeuvre's first burn: when and how much)
        const f = x[0] as Record<string, unknown> | undefined;
        if (f && typeof f.dvMs === "number")
          data[`${k}1`] = `${Math.round(f.dvMs)} m/s${typeof f.inS === "number" ? ` dans ${Math.round(f.inS)} s` : ""}`;
      }
    }
  }
  if (!line && said.length) line = said.at(-1)!;
  return { line: line.slice(0, 160), refused, data };
}
/** the tools' refusals come back as words, not throws: the usual ones read as a refusal */
const REFUSED =
  /^(no |not |nothing to fix|the checklist first|cannot|can't|unknown|only |the jet's systems: in|the autopilot's holds: in|in the air|nav: (no|in the air)|out of|nothing |the radar: in|stt: no)/i;

export class CrewExec {
  private gate = new CrewGate(4);
  constructor(private d: CrewExecDeps) {}

  /** an order heard in the room (from: the server's stamp) */
  async handle(net: NetClient, from: number, raw: unknown) {
    const room = net.room;
    if (room?.role !== "pilot") return;
    const p = readCrewCmd(raw);
    // (meant for another pilot: not ours to answer)
    const to = (raw as { to?: unknown })?.to;
    if (to !== room.slot) return;
    const id = p.ok ? p.cmd.id : (p.id ?? "");
    const act = p.ok ? p.cmd.act : String((raw as { act?: unknown })?.act ?? "").slice(0, 32);
    const answer = (ok: boolean, msg: string, data?: CrewAck["data"]) => {
      const what = p.ok ? sayOf(p.cmd.act, p.cmd.args).fr : act;
      if (id)
        net.event({ kind: "crew-ack", v: 1, id, to: from, act, ok, msg, what, ...(data ? { data } : {}) } satisfies CrewAck & {
          kind: string;
        });
    };
    // (the console's own words for the gates' refusals: it speaks French)
    const sender = room.members.find((m) => m.slot === from);
    if (sender?.role !== "instruments" && !this.d.aboard?.(from)) return answer(false, "Seul un écran d'équipage donne des ordres");
    if (this.d.settings.netCrewActions === false) return answer(false, "Le pilote a verrouillé les actions de l'équipage");
    if (!p.ok) return answer(false, p.error);
    const pace = this.gate.pass(from, p.cmd.id, performance.now());
    if (pace === "again") return;
    if (pace === "rate") return answer(false, "Trop d'ordres — un à la fois");
    const fam = ACTS[p.cmd.act].fam;
    if (!this.d.families().includes(fam)) return answer(false, "Indisponible sur cet appareil ou dans ce mode");
    const ctx: ExecCtx = {
      camera: this.d.camera,
      tool: async (name, args) => {
        const tool = this.d.tools().find((x) => x.name === name);
        if (!tool) throw new Error(`no tool ${name}`);
        const chk = checkArgs(tool, args);
        if (!chk.ok) throw new Error(chk.error);
        return tool.run(chk.args, new AbortController().signal);
      },
    };
    let ok = true,
      msg = "",
      data: CrewAck["data"];
    try {
      const r = readResult(await RUN[p.cmd.act](p.cmd.args, ctx));
      msg = r.line;
      data = r.data;
      if (r.refused || REFUSED.test(msg)) ok = false;
    } catch (e) {
      ok = false;
      msg = (e instanceof Error ? e.message : String(e)).slice(0, 160);
    }
    const who = this.d.nameOf(from);
    const what = tr(sayOf(p.cmd.act, p.cmd.args));
    this.d.toast(ok ? tf("{0} (crew): {1}", who, what) : tf("{0} (crew): {1} — refused: {2}", who, what, msg));
    answer(ok, msg, data);
  }
}
