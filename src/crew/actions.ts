// The crew's orders from the console (docs/PLAN-CREW-ACTIONS.md): sent to the pilot followed, each waited for its
// answer (3 s, then "no answer"), every answer heard from that pilot kept in the board's journal (who asked what,
// done or refused) — the same on every crew screen. What can be asked now: the pilot's `caps` (his lock, the
// families open on his craft and mode); a pilot that sends none (an older simulator) takes no orders.
import type { NetClient } from "../net/client";
import { type Act, ACTS, type Family, readCrewAck, sayOf } from "../net/crewcmd";
import type { Args } from "../ai/tool-schema";
import type { CrewModel } from "./model";
import { type Units, unitsOf } from "../ui/unitsys";
import { L, lang, Lp } from "./lang";

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
  private pending = new Map<string, { act: Act; args: Args; resolve: (d: Done) => void; timer: ReturnType<typeof setTimeout> }>();
  private listeners = new Set<() => void>();
  constructor(
    readonly net: NetClient,
    readonly model: CrewModel,
    /** the console's units (its switch): an order's figures said in them */
    readonly units: () => Units = () => unitsOf("metric"),
  ) {
    net.on("event", ({ from, ev }) => {
      if (ev.kind !== "crew-ack") return;
      const a = readCrewAck(ev);
      const room = net.room;
      if (!a || !room) return;
      // (a ground station: the answer the light's time late too — K5)
      const late = this.model.selected !== null ? this.model.linkOf(this.model.selected).delay : 0;
      if (late > 0) setTimeout(() => this.ack(from, a), late * 1000);
      else this.ack(from, a);
    });
    net.on("room", () => {
      this.board.length = 0;
      this.changed();
    });
  }
  private ack(from: number, a: NonNullable<ReturnType<typeof readCrewAck>>) {
    const room = this.net.room;
    if (!room) return;
    {
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
        // (said in the console's language and units: ours from what we asked, another screen's from the arguments its
        // answer carries — an older pilot's none: its words as they came)
        const what = mine
          ? Lp(sayOf(mine.act, mine.args, this.units()))
          : a.args
            ? Lp(sayOf(a.act, a.args, this.units()))
            : a.what || Lp(sayOf(a.act, {}));
        this.board.unshift({ at: Date.now(), who, what, ok: a.ok, msg: a.msg });
        if (this.board.length > 40) this.board.pop();
      }
      this.changed();
    }
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
    if (!this.net.room) return { ok: false, why: L("Rejoignez une salle", "Join a room") };
    if (!own) return { ok: false, why: L("Aucun pilote suivi", "No pilot followed") };
    if (own.age > 3) return { ok: false, why: L("Signal du pilote ancien", "The pilot's signal is old") };
    const caps = own.snapshot?.caps;
    if (!caps) return { ok: false, why: L("Ce simulateur ne reçoit pas d'ordres", "This simulator takes no orders") };
    if (!caps.on)
      return { ok: false, why: L("Le pilote a verrouillé les actions de l'équipage", "The pilot has locked the crew's actions") };
    if (!caps.fam.includes(fam))
      return { ok: false, why: L("Indisponible sur cet appareil ou dans ce mode", "Unavailable on this craft or in this mode") };
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
    if (!can.ok || to === null) return Promise.resolve({ ok: false, msg: can.why || L("Aucun pilote suivi", "No pilot followed") });
    // (a ground station — K5: behind the wormhole no order goes; else it goes the light's time late, its answer too)
    const link = this.model.linkOf(to);
    if (link.cut)
      return Promise.resolve({
        ok: false,
        msg: L("Liaison coupée (trou de ver) : enregistrez un message", "Link cut (wormhole): record a message"),
      });
    const id = newId();
    return new Promise<Done>((resolve) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          resolve({ ok: false, msg: L("Pas de réponse du pilote", "No answer from the pilot") });
          this.changed();
        },
        3000 + 2000 * link.delay,
      );
      this.pending.set(id, { act, args, resolve, timer });
      // (the console's language: the pilot's answer comes back in it)
      const go = () => this.net.event({ kind: "crew-cmd", v: 1, id, to, act, args, lang: lang() });
      // (a pilot who holds the ground's orders himself — AUDIT-CREW priority 6 —: sent at once, he waits the light's
      // time; an older one: delayed here)
      if (link.delay > 0 && !this.model.holds(to)) setTimeout(go, link.delay * 1000);
      else go();
      this.changed();
    });
  }
  /** what an order says, in the console's language and units */
  label(act: Act, args: Args = {}) {
    return Lp(sayOf(act, args, this.units()));
  }
}
