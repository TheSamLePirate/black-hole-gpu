// The Link 16 between the room's F-35s (docs/PLAN-RADAR-AAA.md RD12): each shares the tracks its own radar holds, twice
// a second — their key and the IFF it knows —, and each page marks those things in its own picture as held by the
// datalink (a dashed track on every screen, its IFF known): one thing seen by two pilots stays one track, its id the
// page's own. With whom: the whole room out of a match and in the matches that are not fights (a race, a contest);
// one's own team in a team fight (coop: all against the aggressors); nobody in the free fight nor the free-for-all
// (everyone against everyone). Pure: the keys, the rule, the event read back.

/** One page's id of a thing as the room shares it (each page names some things its own way): a player's craft and its
 *  stand-in in a fight (net:<slot>, cmb:<10000+slot>) are p:<slot>; our own AI wingmen (wng:<k>) are the others'
 *  rwg:<us>:<k>; the airliners, ships, carriers, the others' wingmen and the host's aggressors (a match's world is
 *  the host's — only in a match) keep theirs. Null: a thing not shared (a missile, a decoy, our own craft). */
export function l16Key(id: string, me: number, inMatch = true): string | null {
  const c = id.indexOf(":");
  const src = c > 0 ? id.slice(0, c) : "";
  const rest = id.slice(c + 1);
  if (src === "net") return Number(rest) === me ? null : `p:${rest}`;
  if (src === "cmb") {
    const n = Number(rest);
    if (!Number.isFinite(n)) return null;
    if (n >= 10_000) return n - 10_000 === me ? null : `p:${n - 10_000}`;
    // (an aggressor: the host's world's in a match — the same id on every page —; a page's own fight's out of one)
    return inMatch ? `a:${n}` : null;
  }
  if (src === "wng") return `rwg:${me}:${rest}`;
  if (src === "trf" || src === "ais" || src === "cv" || src === "rwg") return id;
  return null;
}

/** Whether a pilot's tracks are taken from another (`mode` the room's match: null none; `sameTeam` theirs). */
export function l16Shares(mode: string | null, sameTeam: boolean): boolean {
  if (mode === null) return true;
  if (mode === "free" || mode === "ffa") return false;
  if (mode === "teams" || mode === "coop") return sameTeam;
  return true;
}

export const IFF16 = ["unknown", "friend", "neutral", "hostile"] as const;

/** The event read back (untrusted): its keys and their IFF, bounded. */
export function readL16(ev: unknown): { key: string; iff: (typeof IFF16)[number] }[] {
  const tr = (ev as { tr?: unknown })?.tr;
  if (!Array.isArray(tr)) return [];
  const out: { key: string; iff: (typeof IFF16)[number] }[] = [];
  for (const x of tr.slice(0, 120))
    if (Array.isArray(x) && typeof x[0] === "string" && x[0].length <= 40 && typeof x[1] === "number")
      out.push({ key: x[0], iff: IFF16[x[1]] ?? "unknown" });
  return out;
}
