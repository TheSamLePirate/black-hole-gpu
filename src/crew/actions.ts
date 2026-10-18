// The crew's orders from the console (docs/PLAN-CREW-ACTIONS.md): sent to the pilot followed, each waited for its
// answer (3 s, then "no answer"), every answer heard from that pilot kept in the board's journal (who asked what,
// done or refused) — the same on every crew screen. What can be asked now: the pilot's `caps` (his lock, the
// families open on his craft and mode); a pilot that sends none (an older simulator) takes no orders.
import type { NetClient } from "../net/client";
import { type Act, ACTS, type Family, readCrewAck, sayOf } from "../net/crewcmd";
import type { Args } from "../ai/tool-schema";
import type { CrewModel } from "./model";

export interface Done {
  ok: boolean;
  msg: string;
  /** the figures the pilot's game sent back (a manoeuvre previewed: its Δv, its burns) */
  data?: Record<string, string | number | boolean>;
}
export interface BoardLine {
  at: number;
  who: string;
  what: string;
  ok: boolean;
  msg: string;
}

let seq = 0;
const newId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export class CrewActions {
  /** the board's journal: the followed pilot's answers, newest first */
  readonly board: BoardLine[] = [];
  private pending = new Map<string, { act: Act; resolve: (d: Done) => void; timer: ReturnType<typeof setTimeout> }>();
  private listeners = new Set<() => void>();
  constructor(
    readonly net: NetClient,
    readonly model: CrewModel,
  ) {
    net.on("event", ({ from, ev }) => {
      if (ev.kind !== "crew-ack") return;
      const a = readCrewAck(ev);
      const room = net.room;
      if (!a || !room) return;
      // (an answer to ours: its promise settled)
      const mine = a.to === room.slot ? this.pending.get(a.id) : undefined;
      if (mine) {
        clearTimeout(mine.timer);
        this.pending.delete(a.id);
        mine.resolve({ ok: a.ok, msg: a.msg, data: a.data });
      }
      // (any answer of the pilot followed: the board's journal)
      if (from === this.model.selected && Object.hasOwn(ACTS, a.act)) {
        const who = room.members.find((m) => m.slot === a.to)?.name ?? "?";
        this.board.unshift({ at: Date.now(), who, what: a.what || sayOf(a.act, {}).fr, ok: a.ok, msg: a.msg });
        if (this.board.length > 40) this.board.pop();
      }
      this.changed();
    });
    net.on("room", () => {
      this.board.length = 0;
      this.changed();
    });
  }
  onChange(f: () => void) {
    this.listeners.add(f);
  }
  private changed() {
    for (const f of this.listeners) f();
  }
  /** whether an act's family can be asked of the pilot followed now — or why not */
  can(fam: Family): { ok: boolean; why: string } {
    const own = this.model.own();
    if (!this.net.room) return { ok: false, why: "Rejoignez une salle" };
    if (!own) return { ok: false, why: "Aucun pilote suivi" };
    if (own.age > 3) return { ok: false, why: "Signal du pilote ancien" };
    const caps = own.snapshot?.caps;
    if (!caps) return { ok: false, why: "Ce simulateur ne reçoit pas d'ordres" };
    if (!caps.on) return { ok: false, why: "Le pilote a verrouillé les actions de l'équipage" };
    if (!caps.fam.includes(fam)) return { ok: false, why: "Indisponible sur cet appareil ou dans ce mode" };
    return { ok: true, why: "" };
  }
  /** whether any order is waiting for its answer */
  get busy() {
    return this.pending.size > 0;
  }
  /** an order to the pilot followed: its answer (or a refusal said here when it cannot be sent) */
  send(act: Act, args: Args = {}): Promise<Done> {
    const fam = ACTS[act].fam;
    const can = this.can(fam);
    const to = this.model.selected;
    if (!can.ok || to === null) return Promise.resolve({ ok: false, msg: can.why || "Aucun pilote suivi" });
    const id = newId();
    return new Promise<Done>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, msg: "Pas de réponse du pilote" });
        this.changed();
      }, 3000);
      this.pending.set(id, { act, resolve, timer });
      this.net.event({ kind: "crew-cmd", v: 1, id, to, act, args });
      this.changed();
    });
  }
  /** what an order says (French: the console's language) */
  label(act: Act, args: Args = {}) {
    return sayOf(act, args).fr;
  }
}
