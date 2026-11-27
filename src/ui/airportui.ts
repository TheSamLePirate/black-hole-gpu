// The airport mode's interface (docs/PLAN-AEROPORT-AAA.md V8 — Sam, 26 Nov 2026: « dans ce mode, pas de HUD ni d'UI, à part le menu
// du haut qui se masque comme d'habitude ; une UI avec la liste des avions, les files — sélectionnables pour voir leurs infos et les
// suivre — ; le bandeau télé »): the game's HUD and panels hidden (body.airport-mode — style.css: what H hides, the top bar left), and
// one panel at the right — the airport, the director's shots, its queues (the arrivals ↘, the departures ↗, the others about the
// airport: on its ground, flying near), each row chosen to follow it (chosen again: let go), the one filmed's card (its callsign,
// airline, registration, type, phase, height, speed, vertical speed, runway, the seconds to the event). Collapsed to its title by its
// handle. Rebuilt four times a second at most, only when what it shows changed.

import { AIRPORT_MODES, type AirportMode } from "../cine/airport";
import {
  type Arrival,
  airportCraft,
  airportFollow,
  airportMode,
  airportNext,
  airportState,
  airportStop,
  callsignOf,
} from "../controller/airportview";
import type { TrafficCraft } from "../controller/traffic";
import { t, tf } from "../i18n";
import { airlineOf } from "../traffic/livery";
import { AIRPORT_MODE_LABEL } from "./camerapanel";
import { el as h } from "./kit";
import { unitsFor } from "./unitsys";

const PHASE_LABEL: Record<string, string> = {
  parked: t("parked"),
  taxi: t("taxiing"),
  takeoff: t("take-off roll"),
  landing: t("landing"),
  approach: t("approach"),
  climb: t("climbing"),
  cruise: t("cruising"),
  descent: t("descending"),
  rotor: t("rotorcraft"),
};

const mmss = (s: number) => {
  const x = Math.max(0, Math.round(Math.abs(s)));
  return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, "0")}`;
};
const nameOf = (c: TrafficCraft) =>
  `${c.provenance === "synthetic" ? `${t("Synthetic")} · ` : c.provenance === "reconstructed" ? `${t("Reconstructed")} · ` : ""}${callsignOf(c)}`;

export interface AirportUiDeps {
  settings: { units?: "metric" | "imperial" };
  activity?(enabled?: boolean): { enabled: boolean; network: unknown };
  weather?(): { summary: string; metar: string };
  /** the mode left (the free camera kept where it is) */
  quit(): void;
  /** the radio's last lines (traffic/atc.ts) */
  radio?(): readonly { who: "tower" | "pilot"; text: string }[];
}

export class AirportUi {
  readonly root: HTMLElement;
  private key = "";
  private at = -1;
  private collapsed = false;
  /** the cinema's bars (2.39:1 — the picture letterboxed), on by default */
  private bars: HTMLElement;
  private barsOn = true;

  constructor(private d: AirportUiDeps) {
    this.bars = h("div", "airport-bars");
    this.bars.append(h("div", "ab-top"), h("div", "ab-bottom"));
    this.bars.hidden = true;
    document.body.append(this.bars);
    this.root = h("aside", "airport-ui");
    this.root.dataset.testid = "airport-ui";
    this.root.hidden = true;
    // (its keys, its clicks: the panel's own — not the flight's, not the camera's drag)
    for (const ev of ["keydown", "pointerdown", "wheel"] as const) this.root.addEventListener(ev, (e) => e.stopPropagation());
    document.body.append(this.root);
  }

  /** A frame: shown while the mode is on (body.airport-mode), its contents rebuilt when they changed (4 Hz at most). */
  frame(nowMs: number) {
    const S = airportState();
    document.body.classList.toggle("airport-mode", !!S);
    this.root.hidden = !S;
    this.bars.hidden = !S || !this.barsOn;
    if (!S) {
      this.key = "";
      return;
    }
    if (nowMs - this.at < 250) return;
    this.at = nowMs;
    const cur = S.current ? airportCraft(S.current) : null;
    const U = unitsFor(this.d.settings);
    const key = [
      JSON.stringify(this.d.weather?.()),
      `${this.d.activity?.().enabled}:${this.d.activity?.().network}`,
      S.code,
      S.dir.mode,
      S.shot,
      S.current,
      S.pinned,
      this.collapsed,
      S.queue.map((q) => `${q.c.id}:${Math.round(q.eta)}:${q.c.gnd}`).join(","),
      S.others.map((c) => `${c.id}:${c.phase}`).join(","),
      cur ? `${Math.round(U.alt(cur.msl) / 10)}:${Math.round(U.spd(Math.hypot(...cur.v)))}` : "",
      this.d.radio?.().length ?? 0,
      this.d.radio?.().at(-1)?.text ?? "",
    ].join("|");
    if (key === this.key) return;
    this.key = key;
    this.build();
  }

  private build() {
    const S = airportState();
    if (!S) return;
    const U = unitsFor(this.d.settings);
    const head = h("header", "au-head");
    const title = h("div", "au-title");
    title.append(h("b", "", S.code), h("span", "", S.name));
    const fold = h("button", "au-icon", this.collapsed ? "▾" : "▴");
    fold.title = this.collapsed ? t("Show the lists") : t("Fold the lists");
    fold.dataset.testid = "airport-ui-fold";
    fold.onclick = () => {
      this.collapsed = !this.collapsed;
      this.key = "";
      this.build();
    };
    const quit = h("button", "au-icon", "×");
    quit.title = t("Leave the airport view");
    quit.dataset.testid = "airport-ui-quit";
    quit.onclick = () => {
      airportStop();
      this.d.quit();
    };
    head.append(title, fold, quit);
    const body: HTMLElement[] = [];
    const weather = this.d.weather?.();
    if (weather) {
      const box = h("section", "au-weather");
      box.dataset.testid = "airport-ui-weather";
      box.append(h("div", "au-label", t("Weather")), h("div", "", weather.summary));
      const raw = h("div", "au-metar", weather.metar);
      raw.dataset.testid = "airport-ui-metar";
      box.append(raw);
      body.push(box);
    }
    if (!this.collapsed) {
      const activity = this.d.activity?.();
      if (activity) {
        const button = h("button", "au-btn", t(activity.enabled ? "Supplemental traffic: on" : "Supplemental traffic: off"));
        button.dataset.testid = "airport-ui-activity";
        button.disabled = !activity.network;
        button.onclick = () => {
          this.d.activity?.(!activity.enabled);
          this.key = "";
          this.build();
        };
        body.push(button);
      }
      // the director: Auto and its shots
      const seg = h("div", "au-seg");
      for (const m of AIRPORT_MODES as AirportMode[]) {
        const b = h("button", "", AIRPORT_MODE_LABEL[m]);
        b.classList.toggle("on", S.dir.mode === m);
        b.dataset.testid = `airport-ui-mode-${m}`;
        b.onclick = () => {
          airportMode(m);
          this.key = "";
          this.build();
        };
        seg.append(b);
      }
      const bars = h("button", "au-btn", this.barsOn ? t("Cinema bars: on") : t("Cinema bars: off"));
      bars.dataset.testid = "airport-ui-bars";
      bars.onclick = () => {
        this.barsOn = !this.barsOn;
        this.key = "";
        this.build();
      };
      const next = h("button", "au-btn", t("Next movement"));
      next.dataset.testid = "airport-ui-next";
      next.onclick = () => {
        airportNext();
        this.key = "";
      };
      body.push(h("div", "au-label", t("Director")), seg, next, bars);
      // the one filmed: its card
      const cur = S.current ? airportCraft(S.current) : null;
      if (cur) body.push(this.card(cur, S.queue.find((q) => q.c.id === cur.id) ?? null, S.pinned === cur.id, U));
      // the radio: its last lines (the tower amber, the crews white)
      const R = this.d.radio?.() ?? [];
      if (R.length) {
        const box = h("section", "au-radio");
        box.dataset.testid = "airport-ui-radio";
        box.append(h("div", "au-label", t("Radio")));
        for (const l of R.slice(-3)) box.append(h("div", `au-radio-line ${l.who}`, l.text));
        body.push(box);
      }
      // the queues
      const arr = S.queue.filter((q) => !q.dep);
      const dep = S.queue.filter((q) => q.dep);
      body.push(
        this.list(`↘ ${t("Arrivals")}`, "arr", arr, S.current, S.pinned),
        this.list(`↗ ${t("Departures")}`, "dep", dep, S.current, S.pinned),
        this.others(S.others, S.current, S.pinned),
      );
    }
    this.root.replaceChildren(head, ...body);
  }

  private row(c: TrafficCraft, right: string, cur: string | null, pinned: string | null, sub: string) {
    const r = h("button", "au-row");
    r.dataset.testid = `airport-ui-row-${c.id}`;
    r.classList.toggle("on", c.id === cur);
    r.classList.toggle("pin", c.id === pinned);
    r.append(h("b", "", nameOf(c)), h("span", "au-sub", sub), h("span", "au-eta", right));
    r.title = c.id === pinned ? t("Followed — click to let the director choose again") : t("Follow it");
    r.onclick = () => {
      airportFollow(c.id === pinned ? null : c.id);
      this.key = "";
    };
    return r;
  }

  private list(label: string, id: string, q: Arrival[], cur: string | null, pinned: string | null) {
    const box = h("section", "au-list");
    box.dataset.testid = `airport-ui-${id}`;
    box.append(h("div", "au-label", `${label} · ${q.length}`));
    if (!q.length) box.append(h("div", "au-none", t("none now")));
    for (const x of q.slice(0, 8)) {
      const right = x.dep
        ? x.c.gnd
          ? x.eta > 0 && Math.hypot(...x.c.v) < 3
            ? t("lined up")
            : mmss(x.eta)
          : t("airborne")
        : x.c.gnd
          ? t("rolling")
          : mmss(x.eta);
      box.append(this.row(x.c, right, cur, pinned, [x.c.type, x.way.name.split(" ").pop()].filter(Boolean).join(" · ")));
    }
    return box;
  }

  private others(list: TrafficCraft[], cur: string | null, pinned: string | null) {
    const box = h("section", "au-list");
    box.dataset.testid = "airport-ui-others";
    box.append(h("div", "au-label", `${t("About the airport")} · ${list.length}`));
    if (!list.length) box.append(h("div", "au-none", t("none now")));
    for (const c of list.slice(0, 8))
      box.append(this.row(c, PHASE_LABEL[c.phase] ?? c.phase, cur, pinned, [c.type, c.reg].filter(Boolean).join(" · ")));
    return box;
  }

  private card(c: TrafficCraft, q: Arrival | null, pinned: boolean, U: ReturnType<typeof unitsFor>) {
    const box = h("section", "au-card");
    box.dataset.testid = "airport-ui-card";
    const al = airlineOf(c.cs);
    box.append(
      h("div", "au-card-title", `${pinned ? "📌 " : ""}${nameOf(c)}`),
      h("div", "au-card-sub", [al, c.reg, c.type].filter(Boolean).join(" · ")),
    );
    const vs = c.v[0]! * c.up[0]! + c.v[1]! * c.up[1]! + c.v[2]! * c.up[2]!;
    const rows: [string, string][] = [
      // (in a queue: its movement's phase — the traffic's own reads « cruise » low on a final, 26 Nov 2026)
      [
        t("Phase"),
        q
          ? q.dep
            ? c.gnd
              ? Math.hypot(...c.v) < 3
                ? t("lined up")
                : t("take-off roll")
              : t("initial climb")
            : c.gnd
              ? t("landing roll")
              : t("final approach")
          : (PHASE_LABEL[c.phase] ?? c.phase),
      ],
      [t("Altitude"), c.gnd ? t("on the ground") : U.fAlt(c.msl)],
      [t("Speed"), U.fSpd(Math.hypot(...c.v))],
      [t("Vertical speed"), U.fVs(vs)],
    ];
    if (q) {
      rows.push([t("Runway"), q.way.name.split(" ").pop() ?? ""]);
      rows.push(
        q.dep
          ? [t("Lift-off"), q.eta > 0 ? tf("in {0}", mmss(q.eta)) : tf("{0} ago", mmss(q.eta))]
          : [t("Touchdown"), q.eta > 0 ? tf("in {0}", mmss(q.eta)) : tf("{0} ago", mmss(q.eta))],
      );
    }
    const dl = h("dl", "au-facts");
    for (const [k, v] of rows) dl.append(h("dt", "", k), h("dd", "", v));
    box.append(dl);
    return box;
  }
}
