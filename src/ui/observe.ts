// The observatory (the telescope from the Earth's ground): everything there is to look at from where one stands —
// the Sun (through its filter), the Moon, the planets and their moons, the dwarf worlds, the ISS, the bright stars,
// our mouth of the wormhole and Gargantua's system beyond it —, where each stands now, when it is next seen (above
// the horizon, the sky dark enough for it: system/observing.ts) and at its best; the telescope taken to it now, or
// the clock taken to its best moment with the telescope on it.

import "./observe.css";
import { fmtLatLon } from "../game/geo";
import { t, tf } from "../i18n";
import { OUR_TARGETS } from "../settings";
import { NAMED_STARS } from "../skychart";
import { nextSeen, type Observable, seenAt, type SeenWindow, spotOf } from "../system/observing";
import { BODY_NAMES } from "../targeting";
import { button, el, h, modal } from "./kit";

export interface ObserveHost {
  /** where one stands on the Earth's ground (null: not there) */
  place(): { lat: number; lon: number } | null;
  /** the game's date [ms UTC] */
  now(): number;
  /** the telescope taken to it from where one stands, the clock at `at` (none: now): why not, or null */
  aim(o: Observable, at?: number): string | null;
}

type Group = "sky" | "planets" | "moons" | "stars" | "far";
export interface ObserveItem {
  o: Observable;
  name: string;
  group: Group;
  /** its key: a body's id, "star:Name", "iss", "wormhole" */
  key: string;
}

const GROUPS: [Group, string][] = [
  ["sky", "The Sun, the Moon, the ISS"],
  ["planets", "Planets"],
  ["moons", "Moons and dwarf worlds"],
  ["stars", "Bright stars"],
  ["far", "The wormhole"],
];
const PLANETS = new Set(["mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune"]);

/** Everything one can look at from the Earth's ground. */
export function observeCatalog(): ObserveItem[] {
  const out: ObserveItem[] = [];
  for (const id of OUR_TARGETS) {
    if (id === "earth") continue;
    const group: Group = id === "sun" || id === "moon" ? "sky" : PLANETS.has(id) ? "planets" : "moons";
    out.push({ o: { kind: "body", id }, name: t(BODY_NAMES[id] ?? id), group, key: id });
  }
  out.push({ o: { kind: "iss" }, name: t("ISS"), group: "sky", key: "iss" });
  for (const s of [...NAMED_STARS].sort((a, b) => a.mag - b.mag).slice(0, 60))
    out.push({ o: { kind: "star", name: s.name, v: s.v }, name: s.name, group: "stars", key: `star:${s.name}` });
  out.push({ o: { kind: "wormhole" }, name: t("Wormhole (Gargantua beyond it)"), group: "far", key: "wormhole" });
  return out;
}

/** An item by a name or key, either language ("Jupiter", "Lune", "Sirius", "ISS", "wormhole"). */
export function findObservable(q: string, list = observeCatalog()): ObserveItem | null {
  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const n = fold(q);
  return (
    list.find((x) => fold(x.key) === n || fold(x.name) === n || fold(x.key.replace(/^star:/, "")) === n) ??
    list.find((x) => fold(x.name).startsWith(n) || fold(x.key).startsWith(n)) ??
    null
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
const hm = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compass = (az: number) => t(COMPASS[Math.round((((az % 360) + 360) % 360) / 22.5) % 16]!);

/** A window in words: its day, its span, its best moment and height. */
export function windowText(w: SeenWindow, now: number): string {
  const same = day(w.from) === day(now);
  const when = same ? t("today") : day(w.from);
  return tf("{0} {1}–{2} UTC · best {3} at {4}° {5}", when, hm(w.from), hm(w.to), hm(w.best), Math.round(w.alt), compass(w.az));
}

export class ObservePage {
  private close: (() => void) | null = null;
  /** the next windows found (a key's, from a place and a date): the list's second look is instant */
  private seen = new Map<string, SeenWindow | null>();
  private gen = 0;

  constructor(private d: ObserveHost) {}

  get isOpen() {
    return !!this.close;
  }

  hide() {
    this.close?.();
  }

  /** Opened from where one stands (a search typed); why not, or null. */
  open(query = ""): string | null {
    const p = this.d.place();
    if (!p) return t("The telescope from the Earth: stand on its ground first — walking, on the tripod, or the free camera over it");
    if (this.close) this.hide();
    const now = this.d.now();
    const gen = ++this.gen;
    const items = observeCatalog();
    const search = el("input", "ob-search") as HTMLInputElement;
    search.type = "search";
    search.placeholder = t("A planet, a moon, a star, the ISS…");
    search.value = query;
    search.setAttribute("data-testid", "observe-search");
    const list = el("div", "ob-list");
    const status = el("p", "ob-status", "");
    const rows = new Map<
      string,
      { row: HTMLElement; when: HTMLElement; now: HTMLElement; best: HTMLButtonElement; aim: HTMLButtonElement }
    >();
    const go = (it: ObserveItem, at?: number) => {
      const why = this.d.aim(it.o, at);
      if (why) status.textContent = why;
      else this.hide();
    };
    for (const [g, label] of GROUPS) {
      const head = el("h3", "ob-group", t(label));
      head.dataset.group = g;
      list.append(head);
      for (const it of items.filter((x) => x.group === g)) {
        const nowEl = el("span", "ob-now", "");
        const when = el("span", "ob-when", t("…"));
        const aim = button({ label: t("Look now"), testid: `observe-aim-${it.key}`, onClick: () => go(it) });
        const best = button({ label: t("Go to its best"), kind: "primary", testid: `observe-best-${it.key}`, onClick: () => {} });
        best.disabled = true;
        const row = h(
          "div",
          { class: "ob-row", "data-key": it.key, "data-testid": `observe-row-${it.key}` },
          el("b", "ob-name", it.name),
          nowEl,
          when,
          h("div", { class: "ob-acts" }, aim, best),
        );
        rows.set(it.key, { row, when, now: nowEl, best, aim });
        list.append(row);
      }
    }
    // (where each stands now: at once — the windows come after, a row at a time)
    for (const it of items) {
      const r = rows.get(it.key)!;
      const s = spotOf(it.o, p.lat, p.lon, now);
      const up = !!s && seenAt(it.o, p.lat, p.lon, now);
      r.row.classList.toggle("up", up);
      r.now.textContent = s
        ? s.alt > 0
          ? tf("now {0}° {1}", Math.round(s.alt), compass(s.az))
          : t("below the horizon")
        : t("its orbit unknown");
      r.aim.title = up ? "" : t("Not seen from here now: the telescope aims there all the same");
    }
    const filter = () => {
      const q = search.value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
      for (const it of items) {
        const name = it.name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
        rows.get(it.key)!.row.hidden = !!q && !name.includes(q) && !it.key.includes(q);
      }
      for (const head of list.querySelectorAll<HTMLElement>(".ob-group")) {
        const any = items.some((it) => it.group === head.dataset.group && !rows.get(it.key)!.row.hidden);
        head.hidden = !any;
      }
    };
    search.addEventListener("input", filter);
    search.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const first = items.find((it) => !rows.get(it.key)!.row.hidden);
      if (first) rows.get(first.key)!.best.disabled ? go(first) : rows.get(first.key)!.best.click();
    });
    filter();
    const m = modal({
      title: t("The observatory: what to see from here, and when"),
      body: [
        h(
          "div",
          { class: "ob-head" },
          el("b", "", fmtLatLon(p.lat, p.lon, 4, [t("N"), t("S"), t("E"), t("W")])),
          el("span", "", tf("{0} UTC", new Date(now).toISOString().slice(0, 16).replace("T", " "))),
        ),
        search,
        status,
        list,
      ],
      cls: "ob-frame",
      testid: "observe",
      onClose: () => (this.close = null),
    });
    this.close = m.close;
    // (the next windows: the shown first, a row a tick — the page never held)
    const place = `${p.lat.toFixed(4)},${p.lon.toFixed(4)},${Math.floor(now / 600e3)}`;
    const order = [...items].sort((a, b) => Number(rows.get(a.key)!.row.hidden) - Number(rows.get(b.key)!.row.hidden));
    const fill = (i: number) => {
      if (gen !== this.gen || !this.close || i >= order.length) return;
      const it = order[i]!;
      const key = `${it.key}@${place}`;
      let w = this.seen.get(key);
      if (w === undefined) {
        w = nextSeen(it.o, p.lat, p.lon, now, it.o.kind === "iss" ? 10 : 60);
        this.seen.set(key, w);
      }
      const r = rows.get(it.key)!;
      if (w) {
        r.when.textContent = windowText(w, now);
        r.best.disabled = false;
        r.best.onclick = () => go(it, w!.best);
      } else r.when.textContent = it.o.kind === "iss" ? t("no pass seen from here in ten days") : t("not seen from here for two months");
      setTimeout(() => fill(i + 1), 0);
    };
    setTimeout(() => fill(0), 30);
    queueMicrotask(() => search.focus());
    return null;
  }
}
