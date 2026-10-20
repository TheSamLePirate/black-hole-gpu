// The room's board (PLAN-VAISSEAUX N4): each pilot's results — a lesson's, a challenge's, a mission's, a phase's
// report — told to the room, read back checked; the best of each pilot for each thing flown, ranked (a challenge by its
// result, lower is better, else the mark out of 20); its title in the reader's language when it is one of ours. Pure:
// the session sends and hears, the panel draws.

import { SPACE_CHALLENGES } from "../game/spacechallenges";
import { SPACE_LESSONS } from "../game/spacecourse";
import { SPACE_MISSIONS } from "../game/spacemissions";
import { t, tf } from "../i18n";

export interface RoomResult {
  slot: number;
  name: string;
  /** what was flown ("challenge:dock-clock"); none: a phase's report, by its title */
  ref: string | null;
  kind: string;
  title: string;
  score: number;
  letter: string;
  medal: "gold" | "silver" | "bronze" | null;
  metric: { value: number; text: string } | null;
  /** when it came [ms, the reader's clock] */
  at: number;
}

const KINDS = ["landing", "docking", "ascent", "insertion", "rendezvous", "entry", "lesson", "challenge", "mission"];

/** A heard result checked (null: not one); its sender's slot, name and our clock added. */
export function resultOf(x: unknown, slot: number, name: string, at: number): RoomResult | null {
  const o = x as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  if (!KINDS.includes(o.kind as string) || typeof o.title !== "string" || !o.title.trim()) return null;
  if (typeof o.score !== "number" || !Number.isFinite(o.score) || o.score < 0 || o.score > 20) return null;
  if (!["A", "B", "C", "D", "F"].includes(o.letter as string)) return null;
  const ref = typeof o.ref === "string" && /^(challenge|mission|lesson):[\w-]{1,40}$/.test(o.ref) ? o.ref : null;
  const medal = ["gold", "silver", "bronze"].includes(o.medal as string) ? (o.medal as RoomResult["medal"]) : null;
  const m = o.metric as { value?: unknown; text?: unknown } | null | undefined;
  const metric =
    m && typeof m.value === "number" && Number.isFinite(m.value) && m.value >= 0 && typeof m.text === "string"
      ? { value: m.value, text: m.text.slice(0, 24) }
      : null;
  return {
    slot,
    name,
    ref,
    kind: o.kind as string,
    title: o.title.slice(0, 80),
    score: o.score,
    letter: o.letter as string,
    medal,
    metric,
    at,
  };
}

/** What was flown said in the reader's language (one of ours), else as its pilot sent it. */
export function refTitle(r: Pick<RoomResult, "ref" | "title">): string {
  if (!r.ref) return r.title;
  const [kind, id] = r.ref.split(":") as [string, string];
  if (kind === "challenge") {
    const C = SPACE_CHALLENGES.find((x) => x.id === id);
    if (C) return tf("Challenge · {0}", t(C.title));
  } else if (kind === "mission") {
    const M = SPACE_MISSIONS.find((x) => x.id === id);
    if (M) return tf("Mission · {0}", t(M.title));
  } else if (kind === "lesson") {
    const L = SPACE_LESSONS.find((x) => x.id === id);
    if (L) return tf("Lesson · {0}", t(L.title));
  }
  return r.title;
}

/** The better of two results of one thing flown: a challenge's by its result (lower), else by the mark. */
const better = (a: RoomResult, b: RoomResult) =>
  a.metric && b.metric && a.score > 0 && b.score > 0 ? a.metric.value < b.metric.value : a.score > b.score;

export interface BoardSection {
  key: string;
  title: string;
  rows: (RoomResult & { rank: number })[];
}

/** The board: for each thing flown (the latest first), each pilot's best, ranked. */
export function board(results: RoomResult[]): BoardSection[] {
  const groups = new Map<string, { at: number; best: Map<number, RoomResult> }>();
  for (const r of results) {
    const key = r.ref ?? `title:${r.title}`;
    const g = groups.get(key) ?? { at: 0, best: new Map() };
    g.at = Math.max(g.at, r.at);
    const was = g.best.get(r.slot);
    if (!was || better(r, was)) g.best.set(r.slot, r);
    groups.set(key, g);
  }
  return [...groups]
    .sort((a, b) => b[1].at - a[1].at)
    .map(([key, g]) => {
      const rows = [...g.best.values()].sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : a.at - b.at));
      return { key, title: refTitle(rows[0]!), rows: rows.map((r, i) => ({ ...r, rank: i + 1 })) };
    });
}

/** A result said short ("18.0/20 · 🥇 1 min 42"). */
export function resultText(r: RoomResult): string {
  const medal = r.medal === "gold" ? "🥇 " : r.medal === "silver" ? "🥈 " : r.medal === "bronze" ? "🥉 " : "";
  return `${r.score.toFixed(1)}/20${r.metric ? ` · ${medal}${r.metric.text}` : medal ? ` · ${medal.trim()}` : ""}`;
}
