// The crew's stations (PLAN-VAISSEAUX K5): aboard — the copilot, the navigator, the flight engineer, live — or on the
// ground, at mission control — FLIGHT, FIDO, GUIDO, EECOM, CAPCOM —, the light's time between them and the craft: what
// the ground sees is that late, what it orders arrives that late; behind the wormhole, no live link at all — only
// messages, recorded, delivered when the link comes back. Pure: the station, the link, the delayed queue.

export type StationId = "copilot" | "nav" | "engineer" | "flight" | "fido" | "guido" | "eecom" | "capcom";

export interface Station {
  id: StationId;
  /** its call in the room (the name's suffix) and its title */
  call: string;
  title: { fr: string; en: string };
  place: "aboard" | "ground";
  /** the spacecraft console's view it opens on */
  view: "sdash" | "orbit" | "system" | "navball" | "dock" | "budget" | "eecom" | "timeline" | "rel" | "ground";
  /** what it is for (the lobby's line) */
  role: { fr: string; en: string };
}

export const STATIONS: Station[] = [
  {
    id: "copilot",
    call: "CDR-2",
    title: { fr: "Copilote", en: "Copilot" },
    place: "aboard",
    view: "sdash",
    role: { fr: "à bord : l’ordinateur de vol, les maintiens, le plan", en: "aboard: the flight computer, the holds, the plan" },
  },
  {
    id: "nav",
    call: "NAV",
    title: { fr: "Navigateur", en: "Navigator" },
    place: "aboard",
    view: "system",
    role: { fr: "à bord : la trajectoire, les poussées, la carte", en: "aboard: the trajectory, the burns, the map" },
  },
  {
    id: "engineer",
    call: "ING",
    title: { fr: "Ingénieur de bord", en: "Flight engineer" },
    place: "aboard",
    view: "eecom",
    role: { fr: "à bord : l’énergie, l’air, les pannes", en: "aboard: the power, the air, the failures" },
  },
  {
    id: "flight",
    call: "FLIGHT",
    title: { fr: "Directeur de vol", en: "Flight director" },
    place: "ground",
    view: "sdash",
    role: { fr: "au sol : la mission entière, la décision", en: "ground: the whole mission, the decision" },
  },
  {
    id: "fido",
    call: "FIDO",
    title: { fr: "Dynamique de vol", en: "Flight dynamics" },
    place: "ground",
    view: "orbit",
    role: { fr: "au sol : l’orbite, les poussées, le Δv", en: "ground: the orbit, the burns, the Δv" },
  },
  {
    id: "guido",
    call: "GUIDO",
    title: { fr: "Guidage", en: "Guidance" },
    place: "ground",
    view: "navball",
    role: { fr: "au sol : l’attitude, les rendez-vous, l’amarrage", en: "ground: the attitude, the rendezvous, the docking" },
  },
  {
    id: "eecom",
    call: "EECOM",
    title: { fr: "Systèmes", en: "Systems" },
    place: "ground",
    view: "eecom",
    role: { fr: "au sol : électricité, environnement, consommables", en: "ground: electrics, environment, consumables" },
  },
  {
    id: "capcom",
    call: "CAPCOM",
    title: { fr: "Communications", en: "Communications" },
    place: "ground",
    view: "timeline",
    role: { fr: "au sol : la voix vers l’équipage (tonalités Quindar)", en: "ground: the voice to the crew (Quindar tones)" },
  },
];
export const stationOf = (id: string | null | undefined): Station => STATIONS.find((s) => s.id === id) ?? STATIONS[0]!;

/** The link now for a station: its one-way delay [s] (0 aboard, accepted), cut (behind the wormhole, for the ground). */
export function linkFor(
  st: Station,
  link: { delay?: number; light: number; cut: boolean } | null | undefined,
  /** aboard on the pilot's agreement (AUDIT-CREW priority 6): not accepted yet, or refused, a station aboard is on the
   *  ground — its light's time, its link cut behind the wormhole */
  accepted = true,
): { delay: number; cut: boolean } {
  if ((st.place === "aboard" && accepted) || !link) return { delay: 0, cut: false };
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
