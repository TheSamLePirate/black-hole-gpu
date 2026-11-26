// The SIDs and STARs (docs/PLAN-A320-VOL-AAA.md N2): the FAA's CIFP's departures and arrivals (scripts/build-approaches.ts →
// assets/approaches/v1/procs/<field>.json, public domain, not for navigation), an airport's fetched when its MCDU pages ask — US
// airports only (the CIFP's); elsewhere none, the plan's own points and the approaches stand. A SID is flown runway transition →
// common route → en-route transition; a STAR en-route → common → runway. Their legs placed as the flight plan's points, each with its
// altitude constraint (at or above, else at or below; the published one whole in `cstr`) and the procedure's name — its speed
// limits (indicated) not carried: the plan's speeds are true (the MCDU's F-PLN shows it, the ND draws it). Legs with
// no fix (a heading to an altitude, « VA »; vectors) carry no point: the plan goes on from the next fix.

import type { Waypoint } from "../game/flightplan";
import { approachesBase, type Leg, legOf, type TerminalRecord } from "./approaches";

export interface Terminal {
  kind: "SID" | "STAR";
  id: string;
  rwys: { name: string; legs: Leg[] }[];
  common: Leg[];
  enroute: { name: string; legs: Leg[] }[];
}

export interface Terminals {
  cycle: string;
  sid: Terminal[];
  star: Terminal[];
}

const NONE: Terminals = { cycle: "", sid: [], star: [] };
const cache = new Map<string, Terminals>();
const pending = new Map<string, Promise<Terminals>>();

const decode = (kind: Terminal["kind"], r: TerminalRecord): Terminal => ({
  kind,
  id: r.id,
  rwys: r.rw.map(([name, legs]) => ({ name, legs: legs.map(legOf) })),
  common: r.c.map(legOf),
  enroute: r.en.map(([name, legs]) => ({ name, legs: legs.map(legOf) })),
});

/** An airport's SIDs and STARs, fetched once (none: an empty set — an airport outside the CIFP, or the file missing). */
export function terminalsAsync(field: string): Promise<Terminals> {
  const k = field.toUpperCase();
  const c = cache.get(k);
  if (c) return Promise.resolve(c);
  let p = pending.get(k);
  if (!p) {
    p = fetch(`${approachesBase()}procs/${k}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<{ cycle: string; sid: TerminalRecord[]; star: TerminalRecord[] }>) : null))
      .catch(() => null)
      .then((j) => {
        pending.delete(k);
        const T = j ? { cycle: j.cycle, sid: j.sid.map((r) => decode("SID", r)), star: j.star.map((r) => decode("STAR", r)) } : NONE;
        cache.set(k, T);
        return T;
      });
    pending.set(k, p);
  }
  return p;
}

/** From what is in (the MCDU's pages are drawn every frame): null while it is fetched — the fetch asked. */
export function terminalsOf(field: string): Terminals | null {
  const c = cache.get(field.toUpperCase());
  if (c) return c;
  void terminalsAsync(field);
  return null;
}

/** A runway's end name without its leading zero (« 09L » → « 9L »). */
const bare = (s: string) =>
  s
    .replace(/^RW/, "")
    .replace(/^0+(?=\d)/, "")
    .toUpperCase();

/** Does a procedure's runway transition serve that runway's end: « RW10L » 10L, « RW19B » both 19s (L, R, C), « ALL » every one. */
export function rwyServes(name: string, rwy: string): boolean {
  if (name === "ALL") return true;
  const n = bare(name),
    r = bare(rwy);
  if (n === r) return true;
  return n.endsWith("B") && n.slice(0, -1) === r.replace(/[LCR]$/, "");
}

/** The procedures usable from (a SID) or to (a STAR) a runway: those with a transition for it, or with none at all (a runway-free
 *  procedure); a runway not chosen yet: all. */
export function terminalsFor(list: Terminal[], rwy: string | null): Terminal[] {
  if (!rwy) return list;
  return list.filter((t) => !t.rwys.length || t.rwys.some((x) => rwyServes(x.name, rwy)));
}

/** The legs flown, in order, for a runway and an en-route transition (null: none — the common route alone). */
export function terminalLegs(t: Terminal, rwy: string | null, trans: string | null): Leg[] {
  const rw =
    (rwy ? t.rwys.find((x) => rwyServes(x.name, rwy) && x.name !== "ALL") : null) ??
    t.rwys.find((x) => x.name === "ALL") ??
    (t.rwys.length === 1 ? t.rwys[0] : undefined);
  const en = trans ? t.enroute.find((x) => x.name === trans) : undefined;
  const parts = t.kind === "SID" ? [rw?.legs ?? [], t.common, en?.legs ?? []] : [en?.legs ?? [], t.common, rw?.legs ?? []];
  return parts.flat();
}

/** A procedure's points put in the plan: the old ones of that kind taken out, the new ones after the departure (a SID) or before the
 *  approach's points — else the destination — (a STAR). */
export function insertTerminal(wps: Waypoint[], all: Waypoint[], kind: Terminal["kind"]): void {
  // (the airport's own reference point — a STAR ending « … SMO, KLAX » —: the plan's end already)
  const pts = all.filter((p) => p.name !== wps[0]?.name && p.name !== wps.at(-1)?.name);
  for (let i = wps.length - 1; i >= 0; i--) if (kind === "SID" ? wps[i]!.proc?.sid : wps[i]!.proc?.star) wps.splice(i, 1);
  if (kind === "SID") {
    // (the old departure fix on the runway's axis: the SID replaces it)
    while (wps.length > 2 && /^DEP\d\d[LCR]?$/.test(wps[1]!.name)) wps.splice(1, 1);
    // (its last fix already the plan's next — an airway's first point —: kept once, the plan's)
    const P = pts.at(-1)?.name === wps[1]?.name ? pts.slice(0, -1) : pts;
    wps.splice(1, 0, ...P);
    return;
  }
  const app = wps.findIndex((w, i) => i > 0 && w.proc?.kind === "arr" && !w.proc.star);
  const at = app > 0 ? app : Math.max(wps.length - 1, 1);
  // (its first fix already the plan's point before — an airway's last —: kept once, the plan's)
  const P = pts[0]?.name === wps[at - 1]?.name ? pts.slice(1) : pts;
  wps.splice(at, 0, ...P);
}

/** The legs as the flight plan's points: the fixes placed, the same fix once (a transition ends where the common route begins), the
 *  runway itself left out (the plan's ends are the airfields), each with its altitude and the procedure's name. */
export function terminalWaypoints(t: Terminal, rwy: string | null, trans: string | null): Waypoint[] {
  const out: Waypoint[] = [];
  for (const l of terminalLegs(t, rwy, trans)) {
    if (l.lat === undefined || l.lon === undefined || !l.fix || /^RW\d/.test(l.fix)) continue;
    if (out.at(-1)?.name === l.fix) {
      // (the same fix closing a transition and opening the common route: its constraint, when the second carries one)
      const alt = l.alt?.[0] ?? l.alt?.[1];
      if (alt != null) out.at(-1)!.alt = alt;
      continue;
    }
    const alt = l.alt?.[0] ?? l.alt?.[1] ?? undefined;
    out.push({
      name: l.fix,
      lat: l.lat,
      lon: l.lon,
      ...(alt != null ? { alt } : {}),
      ...(l.alt ? { cstr: l.alt } : {}),
      proc: {
        kind: t.kind === "SID" ? "dep" : "arr",
        ...(rwy ? { rwy } : {}),
        [t.kind === "SID" ? "sid" : "star"]: t.id,
        ...(trans ? { trans } : {}),
      },
      nav: { kind: "FIX", via: t.id },
    });
  }
  return out;
}
