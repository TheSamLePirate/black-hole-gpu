// The crew's stations (PLAN-VAISSEAUX K5): aboard — the copilot, the navigator, the flight engineer, live — or on the
// ground, at mission control — FLIGHT, FIDO, GUIDO, EECOM, CAPCOM —, the light's time between them and the craft: what
// the ground sees is that late, what it orders arrives that late; behind the wormhole, no live link at all — only
// messages, recorded, delivered when the link comes back. Pure: the station, the link, the delayed queue.

export type StationId = "copilot" | "nav" | "engineer" | "flight" | "fido" | "guido" | "eecom" | "capcom";

export interface Station {
  id: StationId;
  /** its call in the room (the name's suffix) and its title */
  call: string;
  title: string;
  place: "aboard" | "ground";
  /** the spacecraft console's view it opens on */
  view: "sdash" | "orbit" | "system" | "navball" | "dock" | "budget" | "eecom" | "timeline" | "rel" | "ground";
  /** what it is for (the lobby's line) */
  role: string;
}

export const STATIONS: Station[] = [
  {
    id: "copilot",
    call: "CDR-2",
    title: "Copilote",
    place: "aboard",
    view: "sdash",
    role: "à bord : l’ordinateur de vol, les maintiens, le plan",
  },
  { id: "nav", call: "NAV", title: "Navigateur", place: "aboard", view: "system", role: "à bord : la trajectoire, les poussées, la carte" },
  {
    id: "engineer",
    call: "ING",
    title: "Ingénieur de bord",
    place: "aboard",
    view: "eecom",
    role: "à bord : l’énergie, l’air, les pannes",
  },
  {
    id: "flight",
    call: "FLIGHT",
    title: "Directeur de vol",
    place: "ground",
    view: "sdash",
    role: "au sol : la mission entière, la décision",
  },
  { id: "fido", call: "FIDO", title: "Dynamique de vol", place: "ground", view: "orbit", role: "au sol : l’orbite, les poussées, le Δv" },
  {
    id: "guido",
    call: "GUIDO",
    title: "Guidage",
    place: "ground",
    view: "navball",
    role: "au sol : l’attitude, les rendez-vous, l’amarrage",
  },
  {
    id: "eecom",
    call: "EECOM",
    title: "Systèmes",
    place: "ground",
    view: "eecom",
    role: "au sol : électricité, environnement, consommables",
  },
  {
    id: "capcom",
    call: "CAPCOM",
    title: "Communications",
    place: "ground",
    view: "timeline",
    role: "au sol : la voix vers l’équipage (tonalités Quindar)",
  },
];
export const stationOf = (id: string | null | undefined): Station => STATIONS.find((s) => s.id === id) ?? STATIONS[0]!;

/** The link now for a station: its one-way delay [s] (0 aboard), cut (behind the wormhole, for the ground). */
export function linkFor(
  st: Station,
  link: { delay?: number; light: number; cut: boolean } | null | undefined,
): { delay: number; cut: boolean } {
  if (st.place === "aboard" || !link) return { delay: 0, cut: false };
  if (link.cut) return { delay: 0, cut: true };
  return { delay: Math.max(0, link.delay ?? link.light), cut: false };
}

/**
 * A delayed queue: what arrives now is seen `delay` seconds later. Thinned to one an interval when the delay is long
 * (the Moon's 1.3 s keeps every snapshot, Mars's minutes one a second), bounded.
 */
export class DelayLine<T> {
  private q: { at: number; v: T }[] = [];
  constructor(private max = 4000) {}
  push(v: T, at: number, delay: number) {
    const last = this.q.at(-1);
    // (a long delay: one a second is plenty — the memory of minutes of snapshots)
    if (delay > 10 && last && at - last.at < 1) last.v = v;
    else this.q.push({ at, v });
    if (this.q.length > this.max) this.q.splice(0, this.q.length - this.max);
  }
  /** the newest one at least `delay` seconds old (null: none yet — the light still on its way); older ones dropped */
  take(now: number, delay: number): T | null {
    let k = -1;
    for (let i = this.q.length - 1; i >= 0; i--)
      if (now - this.q[i]!.at >= delay) {
        k = i;
        break;
      }
    if (k < 0) return null;
    if (k > 0) this.q.splice(0, k);
    return this.q[0]!.v;
  }
  get size() {
    return this.q.length;
  }
  clear() {
    this.q = [];
  }
}

/** Recorded messages waiting for the link (the ground's behind the wormhole), delivered in order once it is back. */
export class Outbox {
  readonly waiting: { text: string; at: number }[] = [];
  record(text: string, at: number) {
    this.waiting.push({ text: text.slice(0, 280), at });
    if (this.waiting.length > 20) this.waiting.shift();
  }
  /** the messages to send now the link is back (and forgotten here) */
  flush(): { text: string; at: number }[] {
    return this.waiting.splice(0, this.waiting.length);
  }
}
