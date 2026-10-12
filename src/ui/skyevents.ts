// The sky's events from here (PLAN-MODES-AAA M7): on the Earth, from where one stands (walking, on the tripod, the
// free camera over the ground) and the way one looks — the star trails (toward the pole when it is up, else along
// the view), the analemma, the Moon's path tonight, the ISS's next pass and its closest approach to the Moon and the
// Sun (a transit when it crosses their disc), the next solar and lunar eclipses seen here, the next selenelion, the
// next transits of Mercury and Venus. Each with its date, its framing (where to look, the lens), and three ways:
// go there (the tripod set, the time, the aim), live it (the exposures taken and stacked in the game —
// ui/livecapture.ts), render it at full quality (the multiple exposure's dialog).

import "./skyevents.css";
import type { EclipseEvent } from "../eclipse/search";
import type { IssPass } from "../photo/iss-pass";
import { frame } from "../photo/plans";
import { angSep, closestApproach, DISC_RADIUS, lensMm, selenelionAt, shotTimes, trailsAim, type AzAlt } from "../photo/skyevents";
import { fmtLatLon } from "../game/geo";
import { t, tf, tr, type Text } from "../i18n";
import { TYPES } from "./eclipses";
import type { MxKind, MxRequest } from "./multiexposure";
import { button, el, h, modal } from "./kit";

export interface SkyPlace {
  lat: number;
  lon: number;
  /** where the view looks */
  view: AzAlt;
}

export interface SkyEventsHost {
  /** where one stands on the Earth, the view (null: not on the Earth's ground) */
  place(): SkyPlace | null;
  /** the game's date [ms UTC] */
  now(): number;
  /** the Sun's or the Moon's direction from a place [°] at a time */
  azAlt(id: "sun" | "moon", lat: number, lon: number, ms: number): AzAlt;
  /** the ISS from a place at a time (null: its orbit unknown) */
  iss(lat: number, lon: number, ms: number): AzAlt | null;
  issPasses(lat: number, lon: number, from: number, days: number): IssPass[];
  /** the eclipse calculator's search (the planner's worker) */
  search(q: {
    from: number;
    to: number;
    kinds: ("solar" | "lunar" | "transit")[];
    place: { lat: number; lon: number };
  }): Promise<{ events: EclipseEvent[] }>;
  /** the tripod set at the place, the time and the aim (where, the field [°]) */
  aim(o: { ms: number; az: number; alt: number; fov: number }): void;
  /** the exposures lived in the game, aimed first (`iss`: the station's streak drawn on them — lit, or its
   *  silhouette across a disc) */
  live(o: {
    title: string;
    times: number[];
    az: number;
    alt: number;
    fov: number;
    stem: string;
    render?: () => void;
    iss?: "lit" | "dark";
  }): void;
  /** the multiple exposure's dialog, filled */
  render(kind: MxKind, fill: Partial<MxRequest>): void;
}

/** An event of the list: its card's figures and its ways. */
export interface Ev {
  id: string;
  title: Text;
  when: number | null;
  detail: string;
  view: { az: number; alt: number; fov: number };
  times: number[];
  render?: { kind: MxKind; fill: Partial<MxRequest> };
  /** an ISS transit, a selenelion: marked */
  highlight?: boolean;
  /** the ISS in it: its streak drawn on the lived exposures (the scene does not draw it from the ground) */
  iss?: "lit" | "dark";
}

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const TOWARD: Record<"north" | "east" | "south" | "west", Text> = {
  north: { fr: "le nord", en: "the north" },
  east: { fr: "l'est", en: "the east" },
  south: { fr: "le sud", en: "the south" },
  west: { fr: "l'ouest", en: "the west" },
};
const fmtDate = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

/** The ways to an event: the tripod set there, its exposures lived in the game, rendered at full quality. */
export type SkyWay = "go" | "live" | "render";

export class SkyEventsPage {
  private close: (() => void) | null = null;
  private list = el("div", "se-list");
  /** the events last computed (TARS's ways to them) */
  private last: Ev[] = [];
  /** the page's reading (a reopened page's cards are its own) */
  private run = 0;

  constructor(private d: SkyEventsHost) {}

  get isOpen() {
    return !!this.close;
  }

  /** Opened from where one stands; why not, or null. */
  open(): string | null {
    const p = this.d.place();
    if (!p) return t("The sky's events: stand on the Earth first — walking, on the tripod, or the free camera over the ground");
    if (this.close) this.hide();
    const now = this.d.now();
    const head = h(
      "div",
      { class: "se-head" },
      el("b", "", fmtLatLon(p.lat, p.lon, 4, [t("N"), t("S"), t("E"), t("W")])),
      el("span", "", tf("looking {0}° · {1}° up · {2} UTC", Math.round(p.view.az), Math.round(p.view.alt), fmtDate(now))),
    );
    this.list.replaceChildren(el("p", "se-wait", t("Reading the sky…")));
    const m = modal({
      title: t("The sky's events from here"),
      body: [head, this.list],
      cls: "se-frame",
      testid: "sky-events",
      onClose: () => (this.close = null),
    });
    this.close = m.close;
    // (the cards as they come: the page not held while the sky is read)
    const run = ++this.run;
    void this.compute(p, now, (evs, done) => {
      if (this.close && run === this.run) this.fill(evs, done);
    });
    return null;
  }

  hide() {
    this.close?.();
  }

  /** The events from where one stands, all of them (TARS's sky_events); null: not on the Earth's ground. */
  async events(): Promise<Ev[] | null> {
    const p = this.d.place();
    return p ? this.compute(p, this.d.now()) : null;
  }

  /** One of the events last listed taken a way: why not, or null. */
  take(id: string, way: SkyWay): string | null {
    const e = this.last.find((x) => x.id === id);
    if (!e) return `no event "${id}" — list them first (${this.last.map((x) => x.id).join(", ") || "none"})`;
    if (way === "render" && !e.render) return `"${id}" has no full-quality render — go there or live it`;
    this.hide();
    if (way === "go") this.d.aim({ ms: e.when ?? this.d.now(), ...e.view });
    else if (way === "render") this.d.render(e.render!.kind, e.render!.fill);
    else this.liveOf(e);
    return null;
  }

  private liveOf(e: Ev) {
    const at = e.when ?? this.d.now();
    const r = e.render;
    this.d.live({
      title: tr(e.title),
      times: e.times,
      ...e.view,
      stem: `kerr-${e.id}-${fmtDate(at).slice(0, 10)}`,
      render: r ? () => this.d.render(r.kind, r.fill) : undefined,
      iss: e.iss,
    });
  }

  /**
   * All the events from a place, by groups — a frame given back between them (the ISS's are a few hundred
   * milliseconds each), the eclipses searched meanwhile by the worker; `part`: the list so far, sorted by date.
   */
  private async compute(p: SkyPlace, now: number, part?: (evs: Ev[], done: boolean) => void): Promise<Ev[]> {
    const eclipses = this.eclipseEvents(p, now);
    const out: Ev[] = [];
    const groups: (() => Ev[] | Promise<Ev[]>)[] = [
      () => [this.trails(p, now)],
      () => this.analemma(p, now),
      () => this.moonPath(p, now),
      () => this.issPass(p, now),
      () => this.issNear(p, now),
      () => eclipses,
    ];
    for (const [i, g] of groups.entries()) {
      await new Promise((r) => setTimeout(r, 0));
      out.push(...(await g()));
      this.last = [...out].sort((a, b) => (a.when ?? now) - (b.when ?? now));
      part?.(this.last, i === groups.length - 1);
    }
    return this.last;
  }

  /** The star trails: four hours of night from the next dark sky — around the pole when it is up, else along the view. */
  private trails(p: SkyPlace, now: number): Ev {
    const { lat, lon } = p;
    const tr0 = trailsAim(lat, p.view);
    const dusk = this.darkFrom(lat, lon, now);
    return {
      id: "trails",
      title:
        tr0.toward === "pole"
          ? { fr: "Filé d'étoiles circumpolaire", en: "Circumpolar star trails" }
          : { fr: "Filé d'étoiles", en: "Star trails" },
      when: dusk,
      detail:
        tr0.toward === "pole"
          ? tf("Around the pole, {0}° up — four hours", Math.round(tr0.aim.alt))
          : tf("Along the view, toward {0} — four hours", tr(TOWARD[tr0.toward])),
      view: { ...tr0.aim, fov: 60 },
      times: shotTimes(dusk, dusk + 4 * HOUR, 48),
      render: { kind: "trails", fill: { lat, lon, hours: 4, toward: tr0.toward, date: dusk } },
    };
  }

  /**
   * The analemma: the Sun at one time of day, every fortnight for a year — at the time it is now if the whole figure
   * stands above the horizon then, else at the first of the local mean solar times that keeps it up (noon, 10:00,
   * 14:00, 9:00, 15:00). None in the polar circles (the winter Sun never up).
   */
  private analemma(p: SkyPlace, now: number): Ev[] {
    const { lat, lon } = p;
    const day0 = Math.floor(now / DAY) * DAY;
    const nowMin = (now - day0) / 60e3;
    const solar = (h: number) => (((h * 60 - lon * 4) % 1440) + 1440) % 1440;
    for (const minutes of [nowMin, solar(12), solar(10), solar(14), solar(9), solar(15)]) {
      const first = day0 + minutes * 60e3 + (day0 + minutes * 60e3 < now ? DAY : 0);
      const times = shotTimes(first, first + 364 * DAY, 27);
      const suns = times.map((ms) => this.d.azAlt("sun", lat, lon, ms));
      if (suns.some((x) => x.alt < 3)) continue;
      const m = Math.round(minutes);
      const hhmm = `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      return [
        {
          id: "analemma",
          title: { fr: "Analemme", en: "Analemma" },
          when: first,
          detail: tf("The Sun at {0} UTC, every fortnight for a year", hhmm),
          view: frame(suns, 16 / 9),
          times,
          render: { kind: "analemma", fill: { lat, lon, minutesUtc: m % 1440 } },
        },
      ];
    }
    return [];
  }

  /** The Moon tonight: its path every 20 minutes while it is up, through the next twelve hours. */
  private moonPath(p: SkyPlace, now: number): Ev[] {
    const { lat, lon } = p;
    const up = shotTimes(now, now + 12 * HOUR, 37)
      .map((ms) => ({ ms, at: this.d.azAlt("moon", lat, lon, ms) }))
      .filter((x) => x.at.alt > 0);
    if (up.length < 3) return [];
    return [
      {
        id: "moon",
        title: { fr: "La course de la Lune", en: "The Moon's path" },
        when: up[0]!.ms,
        detail: tf("{0} exposures while it is up", up.length),
        view: frame(
          up.map((x) => x.at),
          16 / 9,
        ),
        times: up.map((x) => x.ms),
        render: { kind: "moon", fill: { lat, lon, mode: "night", date: up[0]!.ms } },
      },
    ];
  }

  /** The ISS's next pass seen from here (lit, the sky dark) within a week: its track, framed. */
  private issPass(p: SkyPlace, now: number): Ev[] {
    const { lat, lon } = p;
    const pass = this.d.issPasses(lat, lon, now, 2)[0] ?? this.d.issPasses(lat, lon, now + 2 * DAY, 5)[0];
    if (!pass) return [];
    const track = shotTimes(pass.seenFrom, pass.seenTo, Math.max(8, Math.round((pass.seenTo - pass.seenFrom) / 3000)));
    const pts = track.map((ms) => this.d.iss(lat, lon, ms)).filter((x): x is AzAlt => !!x && x.alt > 0);
    if (pts.length < 2) return [];
    return [
      {
        id: "iss",
        title: { fr: "Passage de l'ISS", en: "ISS pass" },
        when: pass.seenFrom,
        detail: tf("Up to {0}° · magnitude {1}", Math.round(pass.maxAlt), pass.mag.toFixed(1)),
        view: frame(pts, 16 / 9),
        times: track,
        render: { kind: "iss", fill: { lat, lon, date: pass.top } },
        iss: "lit",
      },
    ];
  }

  /** The next dark sky: the Sun 12° under the horizon, from now (within a day; now if it already is). */
  private darkFrom(lat: number, lon: number, now: number) {
    if (this.d.azAlt("sun", lat, lon, now).alt < -12) return now;
    for (let ms = now; ms < now + DAY; ms += 10 * 60e3) if (this.d.azAlt("sun", lat, lon, ms).alt < -12) return ms;
    return now;
  }

  /**
   * The ISS's closest approach to the Moon and to the Sun over three days: its passes over 5° found every 30 s, the
   * nearest moment of each refined every half second around it (a transit lasts a second: the closest is what the
   * place sees — a few kilometres aside, it crosses the disc). A frame given back each day.
   */
  private async issNear(p: SkyPlace, now: number): Promise<Ev[]> {
    const { lat, lon } = p;
    const out: Ev[] = [];
    type Near = ReturnType<typeof closestApproach>;
    const BODIES = ["moon", "sun"] as const;
    const best: Record<(typeof BODIES)[number], Near> = { moon: null, sun: null };
    const coarse: Record<(typeof BODIES)[number], { t: number; sep: number } | null> = { moon: null, sun: null };
    const refine = (body: (typeof BODIES)[number]) => {
      const c = coarse[body];
      if (!c) return;
      const fine = closestApproach(
        shotTimes(c.t - 30e3, c.t + 30e3, 121),
        (x) => this.d.iss(lat, lon, x),
        (x) => this.d.azAlt(body, lat, lon, x),
      );
      const b = best[body];
      if (fine && (!b || fine.sep < b.sep)) best[body] = fine;
      coarse[body] = null;
    };
    for (let ms = now; ms < now + 3 * DAY; ms += 30e3) {
      if (ms > now && (ms - now) % (6 * HOUR) === 0) await new Promise((r) => setTimeout(r, 0));
      const s = this.d.iss(lat, lon, ms);
      for (const body of BODIES) {
        if (!s || s.alt < 5) {
          refine(body);
          continue;
        }
        const b = this.d.azAlt(body, lat, lon, ms);
        if (b.alt < 5) continue;
        const sep = angSep(s, b);
        const c = coarse[body];
        if (sep < 25 && (!c || sep < c.sep)) coarse[body] = { t: ms, sep };
      }
    }
    for (const body of BODIES) {
      refine(body);
      const a = best[body];
      if (!a) continue;
      const transit = a.sep < DISC_RADIUS;
      out.push({
        id: `iss-${body}`,
        title:
          body === "moon"
            ? transit
              ? { fr: "L'ISS devant la Lune", en: "The ISS across the Moon" }
              : { fr: "L'ISS près de la Lune", en: "The ISS by the Moon" }
            : transit
              ? { fr: "L'ISS devant le Soleil", en: "The ISS across the Sun" }
              : { fr: "L'ISS près du Soleil", en: "The ISS by the Sun" },
        when: a.t,
        detail: transit
          ? tf("A transit: {0}° from its centre — a second and a half, a solar filter for the Sun", a.sep.toFixed(2))
          : tf("Closest approach {0}° — a transit needs under {1}°: move a few kilometres", a.sep.toFixed(2), DISC_RADIUS),
        view: { ...a.body, fov: 2 },
        times: shotTimes(a.t - 4e3, a.t + 4e3, 33),
        highlight: transit,
        iss: body === "sun" || transit ? "dark" : "lit",
      });
    }
    return out;
  }

  /** The events the eclipse calculator finds: the next solar and lunar eclipses seen here, the next selenelion, the
   *  next transits of Mercury and Venus with the Sun up here. */
  private async eclipseEvents(p: SkyPlace, now: number): Promise<Ev[]> {
    const { lat, lon } = p;
    const out: Ev[] = [];
    let events: EclipseEvent[] = [];
    try {
      events = (await this.d.search({ from: now, to: now + 30 * 365.25 * DAY, kinds: ["solar", "lunar", "transit"], place: { lat, lon } }))
        .events;
    } catch {
      return out;
    }
    const solar = events.find((e) => e.kind === "solar" && e.here?.seen);
    if (solar && solar.kind === "solar") {
      const sun = this.d.azAlt("sun", lat, lon, solar.t);
      out.push({
        id: "solar",
        title: TYPES[`solar-${solar.here?.type ?? solar.type}`] ?? { fr: "Éclipse de Soleil", en: "Solar eclipse" },
        when: solar.t,
        detail: tf("Here: magnitude {0}, the Sun {1}° up", (solar.here?.magnitude ?? solar.magnitude).toFixed(2), Math.round(sun.alt)),
        view: { ...sun, fov: 3 },
        times: shotTimes(solar.t - 1.5 * HOUR, solar.t + 1.5 * HOUR, 25),
        render: { kind: "eclipse", fill: { lat, lon, eclipse: "solar", date: solar.t } },
      });
    }
    const lunars = events.filter((e) => e.kind === "lunar" && e.here?.seen);
    const lunar = lunars[0];
    if (lunar && lunar.kind === "lunar") {
      const span = shotTimes(
        lunar.contacts[0]?.t ?? lunar.t - 2 * HOUR,
        lunar.contacts[lunar.contacts.length - 1]?.t ?? lunar.t + 2 * HOUR,
        30,
      );
      const pts = span.map((ms) => this.d.azAlt("moon", lat, lon, ms)).filter((m) => m.alt > -1);
      out.push({
        id: "lunar",
        title: TYPES[`lunar-${lunar.type}`] ?? { fr: "Éclipse de Lune", en: "Lunar eclipse" },
        when: lunar.t,
        detail: tf("The Moon {0}° up at the greatest", Math.round(lunar.here?.moonAlt ?? 0)),
        view: pts.length ? frame(pts, 16 / 9) : { ...this.d.azAlt("moon", lat, lon, lunar.t), fov: 30 },
        times: span,
        render: { kind: "eclipse", fill: { lat, lon, eclipse: "lunar", date: lunar.t } },
      });
    }
    for (const e of lunars) {
      if (e.kind !== "lunar") continue;
      const s = selenelionAt(e.contacts, (id, ms) => this.d.azAlt(id, lat, lon, ms));
      if (!s) continue;
      out.push({
        id: "selenelion",
        title: { fr: "Sélénélion", en: "Selenelion" },
        when: s.t,
        detail: tf(
          "The eclipsed Moon on the horizon at {0}°, the Sun rising or setting opposite at {1}°",
          Math.round(s.moon.az),
          Math.round(s.sun.az),
        ),
        view: { az: s.moon.az, alt: Math.max(1, s.moon.alt + 2), fov: 20 },
        times: shotTimes(s.t - 20 * 60e3, s.t + 20 * 60e3, 21),
        render: { kind: "eclipse", fill: { lat, lon, eclipse: "lunar", date: e.t } },
        highlight: true,
      });
      break;
    }
    for (const planet of ["mercury", "venus"] as const) {
      const tr0 = events.find((e) => e.kind === "transit" && e.planet === planet && this.d.azAlt("sun", lat, lon, e.t).alt > 3);
      if (tr0?.kind !== "transit") continue;
      out.push({
        id: `transit-${planet}`,
        title:
          planet === "mercury"
            ? { fr: "Transit de Mercure", en: "Transit of Mercury" }
            : { fr: "Transit de Vénus", en: "Transit of Venus" },
        when: tr0.t,
        detail: tf("Across the Sun for {0} h — a solar filter", ((tr0.end - tr0.start) / HOUR).toFixed(1)),
        view: { ...this.d.azAlt("sun", lat, lon, tr0.t), fov: 1 },
        times: shotTimes(tr0.start, tr0.end, 30),
        render: { kind: "eclipse", fill: { lat, lon, eclipse: "transit", planet, date: tr0.t } },
      });
    }
    return out;
  }

  private fill(evs: Ev[], done: boolean) {
    this.list.replaceChildren();
    if (!evs.length && done) this.list.append(el("p", "se-wait", t("Nothing to see from here for now")));
    for (const e of evs) {
      const card = el("article", `se-card${e.highlight ? " hot" : ""}`);
      card.dataset.testid = `sky-event-${e.id}`;
      const lens = Math.round(lensMm(e.view.fov));
      card.append(
        el("h3", "se-title", tr(e.title)),
        el("p", "se-when", e.when ? `${fmtDate(e.when)} UTC` : ""),
        el("p", "se-detail", e.detail),
        el(
          "p",
          "se-view",
          tf("Look {0}° · {1}° up · field {2}° (≈ {3} mm)", Math.round(e.view.az), Math.round(e.view.alt), +e.view.fov.toFixed(1), lens),
        ),
      );
      const acts = el("div", "se-acts");
      const at = e.when ?? this.d.now();
      acts.append(
        button({ label: t("Go there"), testid: `sky-go-${e.id}`, onClick: () => (this.hide(), this.d.aim({ ms: at, ...e.view })) }),
        button({
          label: t("Live it"),
          kind: "primary",
          testid: `sky-live-${e.id}`,
          onClick: () => {
            this.hide();
            this.liveOf(e);
          },
        }),
      );
      if (e.render)
        acts.append(
          button({
            label: t("Render"),
            testid: `sky-render-${e.id}`,
            onClick: () => {
              this.hide();
              this.d.render(e.render!.kind, e.render!.fill);
            },
          }),
        );
      card.append(acts);
      this.list.append(card);
    }
    if (!done) this.list.append(el("p", "se-wait", t("Reading the sky…")));
  }
}
