// TARS, offline (PLAN-TARS T5b): what he answers when asked (the key F6, a field), from the flight's own
// state — where we are, the fuel, the speed, how long to what comes next, the target, what to do, how things
// stand, who he is —, his settings said aloud ("honesty 70", "humour 50"), and his rare remarks at the
// flight's moments. Pure, seeded (the same question, the same answer: tests, replays). His lines are this
// game's own, in his dry voice — none quoted.
//
// His personality, as the film's: honesty and humour, 0–100 %. Honesty lower: rounder figures, softer words,
// a "probably" — never on a danger (fuel nearly gone, the ground coming: said as it is whatever the setting).
// Humour higher: a dry quip now and then, a joke when asked; at 0, none.

import { t, tf } from "../i18n";

export interface TarsState {
  /** the body we are by (its name), the height over it [km], how we fly (the status' label) */
  body: string | null;
  altKm: number | null;
  status: string | null;
  /** landed (stopped on a ground), docked */
  landed: boolean;
  docked: boolean;
  /** the speed over the body [m/s] */
  speed: number | null;
  /** the propellant left (0…1) and the Δv it gives [m/s]; null: not counted */
  fuel: number | null;
  dv: number | null;
  /** the target and its distance [km] */
  target: { name: string; distKm: number } | null;
  /** the next event on the path and in how long [s] */
  next: { kind: string; name: string; inS: number } | null;
  /** the flight's stage (game/phase.ts), the autopilot engaged ("none") */
  stage: string | null;
  auto: string;
  /** on Gargantua's side: the ship's clock rate (dτ/dt) */
  dtau: number | null;
}

export interface Personality {
  honesty: number;
  humour: number;
}

export interface Reply {
  text: string;
  /** a setting changed by the question ("honesty 70") */
  set?: Partial<Personality>;
}

/** The moments TARS may remark on, unasked. */
export type TarsMoment = "landed-A" | "landed-F" | "wormhole" | "gargantua" | "miller" | "fuel-low" | "liftoff" | "docked";

const pct = (x: number) => Math.round(x);
const fmtDur = (s: number) =>
  s < 90
    ? tf("{0} seconds", Math.round(s))
    : s < 5400
      ? tf("{0} minutes", Math.round(s / 60))
      : s < 172800
        ? tf("{0} hours", Math.round(s / 3600))
        : tf("{0} days", Math.round(s / 86400));

export class Tars {
  private seed: number;
  /** when each moment was last remarked on, and any remark [ms] */
  private remarkedAt = new Map<string, number>();
  private lastRemark = -Infinity;

  constructor(seed = 1) {
    this.seed = seed >>> 0 || 1;
  }

  /** A number 0…1 (seeded). */
  private rand() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 2 ** 32;
  }
  private pick<T>(a: T[]): T {
    return a[Math.floor(this.rand() * a.length)]!;
  }

  /** A figure as honest as the setting: exact at 80 % and over, rounded below, round and vague under 40 %. */
  private figure(x: number, p: Personality): string {
    if (p.honesty >= 80) return x >= 100 ? Math.round(x).toLocaleString("en-US") : x >= 10 ? x.toFixed(0) : x.toFixed(1);
    const mag = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(Math.abs(x), 1))) - (p.honesty >= 40 ? 1 : 0));
    return (Math.round(x / mag) * mag).toLocaleString("en-US");
  }

  /** A quip after a plain answer, now and then, as the humour has it. */
  private quip(p: Personality): string {
    if (this.rand() * 100 >= p.humour * 0.45) return "";
    return ` ${this.pick([
      t("Not that anyone asked me."),
      t("I checked twice. Once out of habit."),
      t("You're welcome."),
      t("I'd shrug, but I'm a rectangle."),
      t("Write that down. I won't."),
    ])}`;
  }

  /** The answer to a question (French or English). */
  answer(q: string, s: TarsState, p: Personality): Reply {
    const x = q.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
    const num = x.match(/(\d{1,3})\s*%?/);
    // his settings, said aloud
    if (/honest|honnet|sincer/.test(x)) {
      if (num) {
        const v = Math.min(Math.max(Number(num[1]), 0), 100);
        return {
          text:
            v < 50 ? tf("Honesty setting: {0} percent. I'll try to sound sure of everything.", v) : tf("Honesty setting: {0} percent.", v),
          set: { honesty: v },
        };
      }
      return { text: tf("Honesty setting at {0} percent.", p.honesty) };
    }
    if (/humou?r|blague setting/.test(x) && !/joke|blague|drole/.test(x.replace(/humou?r/, ""))) {
      if (num) {
        const v = Math.min(Math.max(Number(num[1]), 0), 100);
        return {
          text: v === 0 ? t("Humour setting: zero. Finally, some peace.") : tf("Humour setting: {0} percent.", v),
          set: { humour: v },
        };
      }
      return { text: tf("Humour setting at {0} percent.", p.humour) };
    }
    // a joke
    if (/joke|blague|funny|drole|rigol/.test(x)) {
      if (p.humour < 10) return { text: t("My humour setting is too low for that.") };
      return {
        text: this.pick([
          t("Why don't black holes ever go hungry? They always find room for more."),
          t("I asked the autopilot for a joke. It said: altitude. I'm still waiting for the punchline."),
          t("A photon checks into a hotel. 'Any luggage?' 'No, I'm travelling light.'"),
          t("Time flies near Gargantua. Well, it crawls. It's complicated."),
        ]),
      };
    }
    // who he is
    if (/who are you|what are you|qui es|t'es qui|tars\s*\?|presente/.test(x))
      return {
        text: t("TARS. Former marine robot, now your copilot. Ask me where we are, the fuel, the speed, the target, or what to do."),
      };
    // the fuel
    if (/fuel|propellant|carbur|ergol|delta|reserv|tank|reservoir/.test(x)) {
      if (s.fuel === null) return { text: t("The propellant isn't counted on this engine. Burn all you like.") };
      // (a danger: said as it is, whatever the setting)
      if (s.fuel < 0.1)
        return {
          text: tf(
            "Fuel at {0} percent: {1} metres per second left. That's not a figure to be modest about.",
            pct(s.fuel * 100),
            Math.round(s.dv ?? 0),
          ),
        };
      // (a relativistic engine's Δv — the Ranger's 0.29 c —: as a share of the light's speed)
      const dv = s.dv ?? 0;
      const base =
        dv >= 1e6
          ? tf(
              "Fuel at {0} percent: delta-v for {1} percent of the speed of light.",
              this.figure(s.fuel * 100, p),
              this.figure((dv / 299_792_458) * 100, p),
            )
          : tf("Fuel at {0} percent: {1} metres per second of delta-v.", this.figure(s.fuel * 100, p), this.figure(dv, p));
      return { text: base + (p.honesty < 50 ? ` ${t("Plenty. Probably.")}` : "") + this.quip(p) };
    }
    // the speed
    if (/speed|fast|vitesse|vite|velocity/.test(x)) {
      if (s.speed === null) return { text: t("Speed relative to what? Out here, that's a real question.") };
      const rel = s.body ?? t("the nearest body");
      if (s.speed >= 1e6)
        return {
          text: tf("{0} percent of the speed of light relative to {1}.", this.figure((s.speed / 299_792_458) * 100, p), rel) + this.quip(p),
        };
      return { text: tf("{0} metres per second relative to {1}.", this.figure(s.speed, p), rel) + this.quip(p) };
    }
    // where, how high
    if (/where|position|altitude|how high|ou sommes|ou est|ou on|hauteur|ou suis|ou en/.test(x)) {
      if (s.landed) return { text: tf("On the ground at {0}. Solid. I checked.", s.body ?? t("somewhere")) };
      if (s.docked) return { text: t("Docked. Going nowhere until you say so.") };
      if (s.altKm === null || !s.body) return { text: t("Far from everything. That's the short answer.") };
      return { text: tf("{0} kilometres above {1}. {2}.", this.figure(s.altKm, p), s.body, s.status ?? "") + this.quip(p) };
    }
    // how long, what's next
    if (/how long|when|next|combien de temps|quand|prochain|eta|arrive/.test(x)) {
      if (!s.next) return { text: t("Nothing on our path for now. Enjoy the quiet.") };
      const kind: Record<string, string> = {
        impact: t("we meet the ground of"),
        exit: t("we leave the sphere of influence of"),
        enter: t("we enter the sphere of influence of"),
        mouth: t("we reach the wormhole by"),
      };
      // (the ground coming: plainly)
      if (s.next.kind === "impact" && s.next.inS < 300)
        return { text: tf("Impact with {0} in {1}. Do something.", s.next.name, fmtDur(s.next.inS)) };
      return { text: tf("In {0}, {1} {2}.", fmtDur(s.next.inS), kind[s.next.kind] ?? s.next.kind, s.next.name) + this.quip(p) };
    }
    // the target
    if (/target|cible|distance|loin|far/.test(x)) {
      if (!s.target) return { text: t("No target selected. Pick one on the map, M.") };
      return { text: tf("{0} is {1} kilometres away.", s.target.name, this.figure(s.target.distKm, p)) + this.quip(p) };
    }
    // time near Gargantua
    if (/time|dilat|miller|gargantua|temps|horloge|clock/.test(x)) {
      if (s.dtau === null) return { text: t("Our clocks run like Earth's here, give or take a few microseconds a day.") };
      const h = 1 / Math.max(s.dtau, 1e-9);
      return {
        text: tf(
          "Every hour aboard is {0} hours far away. Spend them wisely.",
          h < 10 ? h.toFixed(2) : Math.round(h).toLocaleString("en-US"),
        ),
      };
    }
    // what to do
    if (
      /what (should|do|now)|que (dois|faire|fais)|je dois|dois-je|doit-on|on doit|quoi faire|que faire|faire maintenant|help|aide|advice|conseil|next step|on fait quoi|je fais quoi/.test(
        x,
      )
    )
      return { text: this.advice(s) };
    // how are things
    if (/how are|status|situation|ca va|etat|how is|comment va|tout va/.test(x)) {
      const fuel = s.fuel === null ? "" : ` ${tf("Fuel {0} percent.", this.figure(s.fuel * 100, p))}`;
      const where = s.landed
        ? tf("Landed on {0}.", s.body ?? "")
        : s.docked
          ? t("Docked.")
          : s.body
            ? tf("{0} at {1} kilometres.", s.status ?? "", this.figure(s.altKm ?? 0, p))
            : "";
      return { text: `${where}${fuel} ${p.honesty < 50 ? t("Everything's fine.") : t("Nothing alarming.")}`.trim() + this.quip(p) };
    }
    // not understood
    return {
      text:
        p.humour >= 50
          ? t("I'd answer that, but it's outside my parameters. Try the fuel, our position, the speed, the target, or what to do.")
          : t("I don't understand. Ask me about the fuel, our position, the speed, the target, or what to do."),
    };
  }

  /** What to do now, from the flight's stage. */
  private advice(s: TarsState): string {
    if (s.auto !== "none") return t("The autopilot has it. Watch, and keep a hand near the controls.");
    if (s.landed) return t("We're down. Take off with U, or the take-off autopilot on the hub.");
    if (s.docked) return t("Docked. Undock when you're ready, or plan the next leg with the planner.");
    switch (s.stage) {
      case "orbit":
        return s.target
          ? tf("In orbit. For {0}: open the planner (0) and plan the transfer.", s.target.name)
          : t("In orbit. Pick a target on the map (M), then plan the transfer.");
      case "entry":
        return t("We're in the entry. Hold the attitude; the entry autopilot (Shift G) can fly it.");
      case "approach":
        return t("On the approach. Gear down (G), follow the path; the landing autopilot can take it.");
      case "air":
        return t("Flying. Pick a runway, or let the entry autopilot take us down.");
      case "suborbital":
        return t("Suborbital: we're coming back down. Raise the periapsis, or plan the landing.");
      case "escape":
        return t("We're leaving this world for good. Check the trajectory on the map.");
      default:
        return t("Plan the next step on the map (M) or with the planner (0). I'll be here.");
    }
  }

  /** A remark unasked, at a moment: rarely (one a moment in 5 minutes, two minutes between any two), as the
   *  humour has it — at 0 nothing but the useful ones (the fuel). Null: silent. */
  remark(m: TarsMoment, now: number, p: Personality): string | null {
    if (now - (this.remarkedAt.get(m) ?? -Infinity) < 300_000 || now - this.lastRemark < 120_000) return null;
    const useful = m === "fuel-low";
    if (!useful && this.rand() * 100 >= 30 + p.humour * 0.6) return null;
    if (!useful && p.humour < 10 && m !== "wormhole") return null;
    this.remarkedAt.set(m, now);
    this.lastRemark = now;
    const lines: Record<TarsMoment, string[]> = {
      "landed-A": [t("Nice landing. I'd give it a ten, if I had a scale."), t("Smooth. I didn't even need to brace.")],
      "landed-F": [t("We're down. All of us. That counts for something."), t("I've logged that landing under 'learning experiences'.")],
      wormhole: [t("Here we go. Keep your hands inside the spacecraft."), t("A sphere in space. Nobody tell me it's a hole.")],
      gargantua: [t("Gargantua. Mind the clocks; ours are about to fall behind."), t("Big, isn't it. Don't stare too long.")],
      miller: [t("Miller's planet. Every minute here costs. Let's not dawdle."), t("Water world. Nobody look at the horizon too long.")],
      "fuel-low": [t("Fuel's getting low. I'd plan the next burn carefully."), t("We're running low on propellant. Just so it's said.")],
      liftoff: [t("Wheels up. Here we go again."), t("Lift-off. I love this part.")],
      docked: [t("Hard dock. Nicely done."), t("Docked. That one was textbook.")],
    };
    return this.pick(lines[m]);
  }
}
