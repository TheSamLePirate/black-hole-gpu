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

export interface CrewExecDeps {
  camera: CameraController;
  settings: Settings;
  /** the game's tools (main.ts: TARS's — the same functions, called directly) */
  tools(): Tool[];
  toast(s: string): void;
  nameOf(slot: number): string;
  /** the families open now (ui/crew-feed.ts crewFamilies) */
  families(): Family[];
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
};

/** a tool's result as a short line (its own words when it says something) */
function short(r: unknown): string {
  if (r === undefined || r === null) return "";
  if (typeof r === "string") return r.slice(0, 160);
  if (typeof r === "object") {
    const o = r as Record<string, unknown>;
    for (const k of ["said", "result", "message", "msg", "status"]) if (typeof o[k] === "string") return (o[k] as string).slice(0, 160);
  }
  return "";
}
/** the tools' refusals come back as words, not throws: the usual ones read as a refusal */
const REFUSED = /^(no |not |cannot|can't|unknown|only |the jet's systems: in|in the air|nav: no|out of)/i;

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
    const answer = (ok: boolean, msg: string) => {
      const what = p.ok ? sayOf(p.cmd.act, p.cmd.args).fr : act;
      if (id) net.event({ kind: "crew-ack", v: 1, id, to: from, act, ok, msg, what } satisfies CrewAck & { kind: string });
    };
    // (the console's own words for the gates' refusals: it speaks French)
    const sender = room.members.find((m) => m.slot === from);
    if (sender?.role !== "instruments") return answer(false, "Seul un écran d'équipage donne des ordres");
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
      msg = "";
    try {
      msg = short(await RUN[p.cmd.act](p.cmd.args, ctx));
      if (REFUSED.test(msg)) ok = false;
    } catch (e) {
      ok = false;
      msg = (e instanceof Error ? e.message : String(e)).slice(0, 160);
    }
    const who = this.d.nameOf(from);
    const what = tr(sayOf(p.cmd.act, p.cmd.args));
    this.d.toast(ok ? tf("{0} (crew): {1}", who, what) : tf("{0} (crew): {1} — refused: {2}", who, what, msg));
    answer(ok, msg);
  }
}
