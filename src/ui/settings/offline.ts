// Settings › Offline (docs/ANALYSE-IGN-LIDAR.md §9.5, I8b): what the game keeps on this device and the zones fetched
// ahead. A tab of its own, not built from the schema: the storage (used, the quota, persistent or not — and the advice to
// install the game), the automatic cache (its size, its budget: 300 MB, 1 GB, 3 GB; emptied), the zones (a row each, its
// progress while it downloads), a zone's sheet (paused, resumed, cancelled; updated, shown on the map, deleted) and the
// adding of one (its place — the On foot screen's search: the Atlas's destinations, an address, coordinates — or the
// position now, its profile, its radius; its tiles, size and time estimated with the room left, before the download).
// The rows are the menus' items: the keys, a click, the pad (← → change a value). Its figures read again every 1.5 s
// while shown. A zone's place chosen on a map too (the Atlas's — ui/mapview.ts —, in this screen: the pad's there), its
// circle at its radius over the zones kept; a zone's sheet shows it there. The pages' side of the zones: src/pwa-zones.ts; the worker's: src/sw.ts.

import { geocode, parseCoords } from "../../game/geocode";
import { POIS } from "../../game/pois";
import { lang, type Text, tr } from "../../i18n";
import type { Pwa, PwaStats } from "../../pwa";
import type { ZoneRecord } from "../../pwa/rules";
import type { ZoneProfileId } from "../../system/zones";
import { el, h } from "../kit";
import { MapView, type ToScreen } from "../mapview";
import type { MenuAction } from "../menu/actions";
import type { MenuScreen } from "../menu/router";
import { type FootPlace, placeCoords, placesOf } from "../title/foot";
import type { Units } from "../unitsys";

const T = {
  storage: { fr: "Stockage", en: "Storage" },
  used: { fr: "Espace utilisé", en: "Space used" },
  usedVal: { fr: "{0} sur {1}", en: "{0} of {1}" },
  usedHelp: {
    fr: "Ce que le jeu garde sur cet appareil : l'application, le cache automatique, les zones hors ligne. Le quota est la place que le navigateur lui accorde.",
    en: "What the game keeps on this device: the application, the automatic cache, the offline zones. The quota is the room the browser grants it.",
  },
  persist: { fr: "Stockage persistant", en: "Persistent storage" },
  persistHelp: {
    fr: "Sans lui, le navigateur peut effacer les zones quand la place manque. Safari efface aussi les données d'un site non installé après 7 jours sans visite : installez le jeu (Partager › Sur l'écran d'accueil, ou l'icône d'installation de la barre d'adresse).\n\nEntrée : le demander au navigateur.",
    en: "Without it, the browser may clear the zones when room runs short. Safari also clears a site not installed after 7 days without a visit: install the game (Share › Add to Home Screen, or the address bar's install icon).\n\nEnter: ask the browser for it.",
  },
  persistOk: { fr: "Stockage persistant accordé", en: "Persistent storage granted" },
  persistNo: {
    fr: "Le navigateur le refuse pour l'instant : installer le jeu aide",
    en: "The browser refuses it for now: installing the game helps",
  },
  cache: { fr: "Cache automatique", en: "Automatic cache" },
  cacheRow: { fr: "Tuiles vues en vol", en: "Tiles seen in flight" },
  cacheHelp: {
    fr: "Le relief et l'imagerie de la Terre vus en vol, gardés pour la prochaine fois. Au-delà du budget, les tuiles servies le moins récemment sont effacées. Les zones hors ligne n'en font pas partie.\n\n← → : le budget.",
    en: "The Earth's relief and imagery seen in flight, kept for next time. Beyond the budget, the tiles served least recently are deleted. The offline zones are not part of it.\n\n← →: the budget.",
  },
  clear: { fr: "Vider le cache automatique", en: "Empty the automatic cache" },
  clearHelp: {
    fr: "Ses tuiles effacées ; les zones hors ligne gardées. Le jeu les redemande au réseau en vol.",
    en: "Its tiles deleted; the offline zones kept. The game asks the network for them again in flight.",
  },
  cleared: { fr: "Cache automatique vidé", en: "Automatic cache emptied" },
  zones: { fr: "Zones hors ligne", en: "Offline zones" },
  noZone: {
    fr: "Aucune zone : une région gardée ici se vole sans réseau.",
    en: "No zone yet: a region kept here is flown without a network.",
  },
  add: { fr: "Ajouter une zone", en: "Add a zone" },
  addHint: {
    fr: "Un lieu, un profil, un rayon : estimé avant de télécharger",
    en: "A place, a profile, a radius: estimated before downloading",
  },
  noWorker: {
    fr: "Le hors ligne demande le service worker du jeu : le site installé ou ouvert en HTTPS (il n'est pas actif ici).",
    en: "Offline play needs the game's service worker: the site installed or opened over HTTPS (it is not active here).",
  },
  downloading: { fr: "téléchargement {0} %", en: "downloading {0} %" },
  waiting: { fr: "en attente du jeu · {0} %", en: "waiting for the game · {0} %" },
  paused: { fr: "en pause · {0} %", en: "paused · {0} %" },
  failed: { fr: "{0} tuiles en échec", en: "{0} tiles failed" },
  ready: { fr: "{0} · {1}", en: "{0} · {1}" },
  zoneHelp: {
    fr: "{0}, {1} autour de {2}.\n{3} tuiles, {4}. {5}",
    en: "{0}, {1} around {2}.\n{3} tiles, {4}. {5}",
  },
  sources: { fr: "Sources : {0}.", en: "Sources: {0}." },
  srcOrtho: { fr: "orthophotos", en: "orthophotos" },
  srcRelief: { fr: "relief IGN", en: "IGN relief" },
  srcHlod: { fr: "silhouettes lointaines", en: "far silhouettes" },
  srcGlobal: { fr: "données mondiales", en: "global data" },
  since: { fr: "Téléchargée le {0}.", en: "Downloaded on {0}." },
  pause: { fr: "Suspendre", en: "Pause" },
  resume: { fr: "Reprendre", en: "Resume" },
  cancel: { fr: "Annuler le téléchargement", en: "Cancel the download" },
  update: { fr: "Mettre à jour", en: "Update" },
  updateHint: { fr: "Chaque tuile redemandée : le millésime des sources", en: "Every tile asked again: the sources' vintage" },
  map: { fr: "Voir sur la carte", en: "Show on the map" },
  del: { fr: "Supprimer", en: "Delete" },
  delSure: { fr: "Confirmer : supprimer la zone", en: "Confirm: delete the zone" },
  deleted: { fr: "Zone supprimée", en: "Zone deleted" },
  place: { fr: "Lieu", en: "Place" },
  here: { fr: "La position actuelle", en: "The position now" },
  profile: { fr: "Profil", en: "Profile" },
  radius: { fr: "Rayon", en: "Radius" },
  core: { fr: "Cœur détaillé", en: "Detailed core" },
  coreHelp: {
    fr: "Autour du centre, les niveaux d'un aérodrome — orthophotos à 0,4 m, relief à 1 m — : ce que le jeu demande sous ≈ 1 km du sol, en plein écran. Ailleurs dans la zone, hors ligne, il s'en tient au profil sans rien demander au réseau.\n\n← → : son rayon.",
    en: "Round the centre, an airfield's levels — orthophotos at 0.4 m, relief at 1 m —: what the game asks under ≈ 1 km over the ground, full screen. Elsewhere in the zone, offline, it keeps to the profile and asks the network nothing.\n\n← →: its radius.",
  },
  coreNone: { fr: "Aucun", en: "None" },
  coreAll: { fr: "Toute la zone", en: "The whole zone" },
  coreVal: { fr: "{0} · + {1}", en: "{0} · + {1}" },
  coreOf: { fr: "Cœur détaillé de {0}.", en: "Detailed core of {0}." },
  estimate: { fr: "Estimation", en: "Estimate" },
  estVal: { fr: "{0} tuiles · {1} · ≈ {2}", en: "{0} tiles · {1} · ≈ {2}" },
  estHelp: {
    fr: "Par les tailles moyennes mesurées de chaque source ; un relief manquant (la mer, une lacune du relevé) ajoute ses tuiles de repli.\nPlace libre : {0}.",
    en: "By each source's measured mean sizes; missing relief (the sea, a gap in the survey) adds its fallback tiles.\nRoom left: {0}.",
  },
  tooBig: { fr: "Place insuffisante : {0} libres", en: "Not enough room: {0} left" },
  download: { fr: "Télécharger", en: "Download" },
  started: { fr: "Zone « {0} » : téléchargement lancé", en: "Zone “{0}”: download started" },
  near: { fr: "Près de {0}", en: "Near {0}" },
  onMap: { fr: "Choisir sur la carte", en: "Choose on the map" },
  onMapHint: {
    fr: "Le cercle de la zone, à son rayon, posé où l'on veut",
    en: "The zone's circle, at its radius, set down anywhere",
  },
  mapPick: { fr: "La zone sur la carte", en: "The zone on the map" },
  mapView: { fr: "Les zones sur la carte", en: "The zones on the map" },
  mapHelp: {
    fr: "Un clic pose la zone, un glisser déplace son cercle, la molette zoome.\nAu clavier et à la manette : les flèches la déplacent, Page ↑ ↓ (LB RB) zooment, Entrée (A) la pose ici.",
    en: "A click sets the zone down, a drag moves its circle, the wheel zooms.\nOn the keyboard and the pad: the arrows move it, Page ↑ ↓ (LB RB) zoom, Enter (A) sets it here.",
  },
  mapViewHelp: {
    fr: "Les zones gardées : ambre prête, bleu en téléchargement, gris en pause.\nLes flèches déplacent la carte, Page ↑ ↓ (LB RB) zooment.",
    en: "The zones kept: amber ready, blue downloading, grey paused.\nThe arrows move the map, Page ↑ ↓ (LB RB) zoom.",
  },
  setHere: { fr: "Poser la zone ici", en: "Set the zone here" },
  atlas: { fr: "Ouvrir dans l'Atlas", en: "Open in the Atlas" },
  zoom: { fr: "Zoom", en: "Zoom" },
  search: { fr: "Un lieu, une adresse, des coordonnées…", en: "A place, an address, coordinates…" },
  point: { fr: "Coordonnées", en: "Coordinates" },
  addresses: { fr: "Adresses", en: "Addresses" },
  searching: { fr: "Recherche des adresses…", en: "Searching the addresses…" },
  noAddress: { fr: "Aucune adresse trouvée", en: "No address found" },
  choose: { fr: "Choisir", en: "Choose" },
  change: { fr: "Changer", en: "Change" },
  back: { fr: "Retour", en: "Back" },
  title: { fr: "Réglages", en: "Settings" },
  tab: { fr: "Hors ligne", en: "Offline" },
} satisfies Record<string, Text>;

/** the profiles as the player reads them: their levels, their radius and their detailed core's by default [km] (the
 *  airfield's levels already its own) */
export const PROFILES: { id: ZoneProfileId; label: Text; hint: Text; radiusKm: number; coreKm: number }[] = [
  {
    id: "airport",
    label: { fr: "Aéroport, roulage", en: "Airfield, taxiing" },
    hint: { fr: "Orthophotos à 0,4 m, relief à 1 m", en: "Orthophotos at 0.4 m, relief at 1 m" },
    radiusKm: 5,
    coreKm: 0,
  },
  {
    id: "low",
    label: { fr: "Vol bas", en: "Low flight" },
    hint: { fr: "Orthophotos à 0,8 m, relief à 2 m", en: "Orthophotos at 0.8 m, relief at 2 m" },
    radiusKm: 10,
    coreKm: 3,
  },
  {
    id: "valley",
    label: { fr: "Vallée, massif", en: "Valley, massif" },
    hint: { fr: "Orthophotos à 1,6 m, relief à 4 m", en: "Orthophotos at 1.6 m, relief at 4 m" },
    radiusKm: 30,
    coreKm: 0,
  },
  {
    id: "overflight",
    label: { fr: "Survol d'une région", en: "Flying over a region" },
    hint: { fr: "Orthophotos à 3,2 m, relief à 8 m", en: "Orthophotos at 3.2 m, relief at 8 m" },
    radiusKm: 50,
    coreKm: 0,
  },
];
/** the radii offered [km] */
export const RADII = [1, 2, 3, 5, 10, 15, 20, 30, 50, 75, 100];
/** the detailed cores' radii offered [km] (0: none; at most the zone's) */
export const CORES = [0, 0.5, 1, 2, 3, 5, 10, 20, 50];
/** the automatic cache's budgets offered [bytes] */
export const BUDGETS = [300 * 2 ** 20, 2 ** 30, 3 * 2 ** 30];

const fill = (s: string, ...a: string[]) => a.reduce((x, v, i) => x.replace(`{${i}}`, v), s);

/** a size in words: "182 Mo", "1,9 Go" / "182 MB", "1.9 GB" */
export function fmtBytes(b: number, l = lang): string {
  const fr = l === "fr";
  const u = fr ? ["o", "Ko", "Mo", "Go", "To"] : ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = Math.max(0, b);
  while (v >= 1000 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  const s = v < 10 && i >= 3 ? v.toFixed(1) : String(Math.round(v));
  return `${fr ? s.replace(".", ",") : s} ${u[i]}`;
}
/** a time in words: "45 s", "3 min", "1 h 10" */
export function fmtDuration(s: number): string {
  if (s < 60) return `${Math.max(1, Math.round(s))} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}
/** a zone's name on the position now: the Atlas's destination nearest within 30 km, else its coordinates */
export function nearName(lat: number, lon: number, l = lang): string {
  const D = Math.PI / 180;
  let best: (typeof POIS)[number] | null = null;
  let dMin = 30;
  for (const p of POIS) {
    if (p.body !== "earth") continue;
    const a = Math.sin(((p.lat - lat) * D) / 2) ** 2 + Math.cos(lat * D) * Math.cos(p.lat * D) * Math.sin(((p.lon - lon) * D) / 2) ** 2;
    const d = 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
    if (d < dMin) {
      dMin = d;
      best = p;
    }
  }
  return best ? fill(T.near[l], best.name[l]) : placeCoords({ id: "", name: { fr: "", en: "" }, lat, lon }, l);
}

/** A circle on the ground about a place [°, m]: its rim's points, `n` bearings apart (a great circle's distance). */
export function circlePoints(lat: number, lon: number, radiusM: number, n = 72): [number, number][] {
  const D = Math.PI / 180,
    d = radiusM / 6_371_008.8;
  const p1 = lat * D,
    l1 = lon * D;
  const out: [number, number][] = [];
  for (let k = 0; k <= n; k++) {
    const b = (2 * Math.PI * k) / n;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    out.push([p2 / D, l2 / D]);
  }
  return out;
}
/** a zone's detailed core on a map: its circle dotted */
function drawCore(ctx: CanvasRenderingContext2D, to: ToScreen, lat: number, lon: number, coreKm: number, col: string) {
  const pts = circlePoints(lat, lon, coreKm * 1000).map(([la, lo]) => to(la, lo));
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.setLineDash([2, 4]);
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.setLineDash([]);
}
/** a zone's colour by its state: ready amber, downloading blue, paused grey */
export const ZONE_COL: Record<ZoneRecord["state"], string> = { ready: "#ffb35c", downloading: "#6fd2ff", paused: "#9aa4b2" };
/** Zones drawn on a map (the settings' own, the Atlas's): their discs and rims, their names. */
export function drawZones(
  ctx: CanvasRenderingContext2D,
  to: ToScreen,
  zones: readonly (Pick<ZoneRecord, "lat" | "lon" | "radiusKm" | "name" | "state"> & { coreKm?: number })[],
  names = true,
) {
  for (const z of zones) {
    const pts = circlePoints(z.lat, z.lon, z.radiusKm * 1000).map(([la, lo]) => to(la, lo));
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = `${ZONE_COL[z.state]}26`;
    ctx.fill();
    ctx.strokeStyle = ZONE_COL[z.state];
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // (its detailed core, inside: dotted)
    if (z.coreKm && z.coreKm < z.radiusKm) drawCore(ctx, to, z.lat, z.lon, z.coreKm, ZONE_COL[z.state]);
    if (!names) continue;
    const [x, y] = to(z.lat, z.lon);
    ctx.font = "600 11px Rajdhani, system-ui, sans-serif";
    ctx.fillStyle = ZONE_COL[z.state];
    ctx.textAlign = "center";
    ctx.fillText(z.name, x, y - 4);
    ctx.textAlign = "start";
  }
}
/** a count in words, grouped as the language does */
const fmtCount = (n: number) => n.toLocaleString(lang === "fr" ? "fr-FR" : "en-GB");
const fmtDate = (t: number) =>
  new Date(t).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
const profileOf = (id: string) => PROFILES.find((p) => p.id === id) ?? PROFILES[1]!;
const percent = (z: ZoneRecord) => (z.total ? Math.min(100, Math.floor((100 * z.cursor) / z.total)) : 0);

export interface OfflineDeps {
  pwa(): Pwa | null;
  units(): Units;
  /** where one is on the Earth now (geodetic WGS84) — under 50 km: a zone's place —, null elsewhere */
  here(): { lat: number; lon: number } | null;
  /** the Atlas on a place (the settings left for it) */
  showOnMap(p: { lat: number; lon: number; name: string }): void;
  toast(text: string): void;
}

/** what the settings' screen lends the tab: its router, its explanation, its prompts */
export interface OfflineHost {
  push(s: MenuScreen): void;
  back(): void;
  refresh(): void;
  explain(title: string, text: string, extra?: Node[]): void;
  prompts(list: [MenuAction, Text][]): HTMLElement;
}

/** the figures the tab shows, read again while it is up */
interface Figures {
  stats: PwaStats | null;
  zones: ZoneRecord[];
  usage: number;
  quota: number;
  persisted: boolean;
}

/** the map's screen (its view, its place: the tests') */
interface MapScreenState extends MenuScreen {
  map: MapView;
  at(): { lat: number; lon: number };
}

/** the zone's being added: where, how, how far */
interface Draft {
  place: FootPlace;
  profile: ZoneProfileId;
  radiusKm: number;
  coreKm: number;
}

export class OfflineTab {
  private f: Figures = { stats: null, zones: [], usage: 0, quota: 0, persisted: false };
  private timer = 0;
  private draft: Draft | null = null;

  constructor(private d: OfflineDeps) {}

  /** the zones as last read (the Atlas draws them), read again now */
  get zonesKnown(): readonly ZoneRecord[] {
    return this.f.zones;
  }
  async readZones(): Promise<readonly ZoneRecord[]> {
    return (await this.read()).zones;
  }

  /** The figures read again (the worker's, the storage's). */
  private async read(): Promise<Figures> {
    const pwa = this.d.pwa();
    const [stats, zones, est, persisted] = await Promise.all([
      pwa ? pwa.stats() : null,
      pwa?.zones ? pwa.zones.list() : [],
      navigator.storage?.estimate?.().catch(() => null) ?? null,
      navigator.storage?.persisted?.().catch(() => false) ?? false,
    ]);
    this.f = {
      stats,
      zones: [...zones].sort((a, b) => a.created - b.created),
      usage: est?.usage ?? 0,
      quota: est?.quota ?? 0,
      persisted: !!persisted,
    };
    return this.f;
  }

  /** Every 1.5 s while `anchor` is shown: the figures read, `tick` called with them (stopped once it is gone). */
  private watch(anchor: HTMLElement, tick: (f: Figures) => void) {
    clearInterval(this.timer);
    const id = window.setInterval(async () => {
      if (!anchor.isConnected) return clearInterval(id);
      tick(await this.read());
    }, 1500);
    this.timer = id;
    void this.read().then(tick);
  }

  /** a row: a label, a value (rendered again with the figures), ← → and Enter */
  private row(
    host: OfflineHost,
    o: {
      id: string;
      label: string;
      chip?: string;
      value: () => Node[];
      help: () => [string, string];
      step?: (dir: 1 | -1) => void;
      go?: () => void;
      off?: () => boolean;
      chev?: boolean;
    },
  ): HTMLElement & { render?: () => void } {
    const val = h("span", { class: "pls-val" });
    const b = h(
      "button",
      {
        class: "m-item tt-act pls-row",
        type: "button",
        "data-testid": `offline-${o.id}`,
        "data-focus-id": `offline-${o.id}`,
        "data-key": `offline-${o.id}`,
      },
      h("span", { class: "pls-label" }, el("span", "", o.label), o.chip ? el("em", "pls-chip", o.chip) : null),
      val,
    ) as HTMLElement & { render?: () => void };
    const explain = () => host.explain(...o.help());
    b.render = () => {
      val.replaceChildren(...o.value(), ...(o.chev ? [el("em", "pz-chev", "›")] : []));
      b.setAttribute("aria-valuetext", val.textContent ?? "");
      const off = o.off?.() ?? false;
      b.classList.toggle("off", off);
      b.setAttribute("aria-disabled", String(off));
    };
    b.addEventListener("keydown", (e) => {
      if (!o.step || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      e.preventDefault();
      e.stopPropagation();
      o.step(e.key === "ArrowRight" ? 1 : -1);
      b.render?.();
      explain();
    });
    b.addEventListener("click", (e) => {
      if (o.off?.()) return;
      if (o.go) return o.go();
      if (!o.step) return;
      const r = b.getBoundingClientRect();
      o.step(e.clientX > 0 && e.clientX < r.left + r.width * 0.55 ? -1 : 1);
      b.render?.();
      explain();
    });
    b.addEventListener("focus", explain);
    b.addEventListener("pointerenter", explain);
    b.render();
    return b;
  }

  private choice(text: string): Node[] {
    return [el("i", "", "◂"), el("b", "", text), el("i", "", "▸")];
  }
  private bar(pct: number, text: string): Node[] {
    return [h("span", { class: "pls-bar" }, h("i", { style: `width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%` })), el("b", "", text)];
  }

  /** A zone's state in a few words, its bar while it downloads. */
  private zoneValue(z: ZoneRecord): Node[] {
    const pct = percent(z);
    if (z.state === "ready") return [el("b", "", fill(tr(T.ready), fmtBytes(z.bytes), fmtDate(z.updated ?? z.created)))];
    if (z.state === "paused")
      return this.bar(
        pct,
        z.failed ? `${fill(tr(T.paused), String(pct))} · ${fill(tr(T.failed), String(z.failed))}` : fill(tr(T.paused), String(pct)),
      );
    const zones = this.d.pwa()?.zones;
    return this.bar(pct, fill(tr(zones?.active === z.id ? T.downloading : T.waiting), String(pct)));
  }

  private zoneHelp(z: ZoneRecord): [string, string] {
    const u = this.d.units();
    const src = [
      z.sources.ortho ? tr(T.srcOrtho) : null,
      z.sources.relief ? tr(T.srcRelief) : null,
      z.sources.hlod && z.sources.relief ? tr(T.srcHlod) : null,
      tr(T.srcGlobal),
    ].filter(Boolean);
    const text = fill(
      tr(T.zoneHelp),
      tr(profileOf(z.profile).label),
      u.fDist(z.radiusKm * 1000, 0),
      placeCoords({ id: "", name: { fr: "", en: "" }, lat: z.lat, lon: z.lon }),
      fmtCount(z.total),
      fmtBytes(z.bytes),
      `${z.coreKm ? `${fill(tr(T.coreOf), u.fDist(Math.min(z.coreKm, z.radiusKm) * 1000, z.coreKm < 1 ? 1 : 0))} ` : ""}${fill(tr(T.sources), src.join(", "))}${z.state === "ready" ? ` ${fill(tr(T.since), fmtDate(z.updated ?? z.created))}` : ""}`,
    );
    return [z.name, text];
  }

  // ------------------------------------------------------------------ the tab

  /** The tab's rows (the settings' list): the storage, the automatic cache, the zones, the adding of one. */
  rows(host: OfflineHost): HTMLElement[] {
    const pwa = this.d.pwa();
    const out: HTMLElement[] = [];
    const rendered: (HTMLElement & { render?: () => void })[] = [];
    const add = (b: HTMLElement & { render?: () => void }) => {
      if (!out.some((x) => x.dataset.autofocus !== undefined) && b.tagName === "BUTTON") b.dataset.autofocus = "";
      rendered.push(b);
      out.push(b);
      return b;
    };
    // ---- the storage (explained until another row is focused)
    out.push(el("h4", "tt-group", tr(T.storage)));
    host.explain(tr(T.used), tr(T.usedHelp));
    add(
      this.row(host, {
        id: "used",
        label: tr(T.used),
        value: () =>
          this.f.quota
            ? this.bar((100 * this.f.usage) / this.f.quota, fill(tr(T.usedVal), fmtBytes(this.f.usage), fmtBytes(this.f.quota)))
            : [el("b", "", "—")],
        help: () => [tr(T.used), tr(T.usedHelp)],
      }),
    );
    add(
      this.row(host, {
        id: "persist",
        label: tr(T.persist),
        value: () => [
          el("span", `pls-dot${this.f.persisted ? " on" : ""}`, ""),
          el("b", "", tr(this.f.persisted ? { fr: "Oui", en: "Yes" } : { fr: "Non", en: "No" })),
        ],
        help: () => [tr(T.persist), tr(T.persistHelp)],
        go: () =>
          void (async () => {
            const ok = (await navigator.storage?.persist?.().catch(() => false)) ?? false;
            this.d.toast(tr(ok ? T.persistOk : T.persistNo));
            await this.read();
            for (const r of rendered) r.render?.();
          })(),
      }),
    );
    if (!pwa) {
      out.push(el("p", "tt-empty", tr(T.noWorker)));
      host.explain(tr(T.tab), tr(T.noWorker));
      this.watch(out[1]!, () => {
        for (const r of rendered) r.render?.();
      });
      return out;
    }
    // ---- the automatic cache
    out.push(el("h4", "tt-group", tr(T.cache)));
    const budgetNow = () => this.f.stats?.tileBudget ?? BUDGETS[0]!;
    add(
      this.row(host, {
        id: "cache",
        label: tr(T.cacheRow),
        value: () => [
          ...this.bar((100 * (this.f.stats?.tileBytes ?? 0)) / budgetNow(), `${fmtBytes(this.f.stats?.tileBytes ?? 0)} /`),
          ...this.choice(fmtBytes(budgetNow())),
        ],
        help: () => [tr(T.cacheRow), tr(T.cacheHelp)],
        step: (dir) => {
          const i = BUDGETS.reduce((best, b, k) => (Math.abs(b - budgetNow()) < Math.abs(BUDGETS[best]! - budgetNow()) ? k : best), 0);
          const next = BUDGETS[Math.min(BUDGETS.length - 1, Math.max(0, i + dir))]!;
          if (this.f.stats) this.f.stats = { ...this.f.stats, tileBudget: next };
          void pwa.setBudget(next).then(() => this.read());
        },
      }),
    );
    add(
      this.row(host, {
        id: "clear",
        label: tr(T.clear),
        value: () => [],
        help: () => [tr(T.clear), tr(T.clearHelp)],
        go: () =>
          void pwa.clearTiles().then(async () => {
            this.d.toast(tr(T.cleared));
            await this.read();
            for (const r of rendered) r.render?.();
          }),
      }),
    );
    // ---- the zones
    out.push(el("h4", "tt-group", tr(T.zones)));
    const ids = this.f.zones.map((z) => z.id).join(",");
    if (!this.f.zones.length) out.push(el("p", "tt-empty", tr(T.noZone)));
    for (const z0 of this.f.zones) {
      const zone = () => this.f.zones.find((z) => z.id === z0.id) ?? z0;
      add(
        this.row(host, {
          id: `zone-${z0.id}`,
          label: z0.name,
          chip: tr(profileOf(z0.profile).label),
          value: () => this.zoneValue(zone()),
          help: () => this.zoneHelp(zone()),
          go: () => host.push(this.zoneScreen(host, z0.id)),
          chev: true,
        }),
      );
    }
    const addBtn = h(
      "button",
      { class: "m-item tt-act", type: "button", "data-testid": "offline-add", "data-focus-id": "offline-add" },
      h("span", { class: "tt-act-row" }, el("span", "", tr(T.add)), el("em", "pz-chev", "›")),
      el("small", "", tr(T.addHint)),
    );
    addBtn.addEventListener("click", () => host.push(this.addScreen(host)));
    addBtn.addEventListener("focus", () => host.explain(tr(T.add), tr(T.addHint)));
    out.push(addBtn);
    // (the figures read again: a zone come or gone — the list built again —, else each row's value)
    this.watch(addBtn, (f) => {
      if (f.zones.map((z) => z.id).join(",") !== ids) return host.refresh();
      for (const r of rendered) r.render?.();
    });
    return out;
  }

  // ------------------------------------------------------------------ a zone's sheet

  private zoneScreen(host: OfflineHost, id: string): MenuScreen {
    let sure = false;
    return {
      id: "offline:zone",
      build: () => {
        const z = this.f.zones.find((x) => x.id === id);
        const page = h("div", { class: "tt-page pls-page pls-offline", "data-testid": "offline-zone" });
        const list = h("nav", { class: "pls-list", "aria-label": z?.name ?? "" });
        const about = h("aside", { class: "pls-explain", "aria-live": "polite" });
        const zones = this.d.pwa()?.zones;
        const act = (testid: string, label: Text, go: () => void | Promise<void>, hint?: Text, focusId = testid) => {
          const b = h(
            "button",
            { class: "m-item tt-act", type: "button", "data-testid": `offline-zone-${testid}`, "data-focus-id": focusId },
            h("span", { class: "tt-act-row" }, el("span", "", tr(label))),
            hint ? el("small", "", tr(hint)) : null,
          );
          b.addEventListener("click", () => void go());
          return b;
        };
        const show = () => {
          const zz = this.f.zones.find((x) => x.id === id);
          if (!zz) return;
          const [title, text] = this.zoneHelp(zz);
          about.replaceChildren(
            el("h3", "tt-preview-title", title),
            h("p", { class: "pls-cost" }, ...this.zoneValue(zz)),
            el("p", "pls-help", text),
          );
        };
        const acts: HTMLElement[] = [];
        if (z && zones) {
          if (z.state === "downloading")
            acts.push(
              act("pause", T.pause, async () => {
                await zones.pause(id);
                await this.read();
                host.refresh();
              }),
            );
          if (z.state === "paused")
            acts.push(
              act("resume", T.resume, async () => {
                await zones.resume(id);
                await this.read();
                host.refresh();
              }),
            );
          if (z.state === "ready") {
            acts.push(
              act(
                "update",
                T.update,
                async () => {
                  await zones.update(id);
                  await this.read();
                  host.refresh();
                },
                T.updateHint,
              ),
            );
          }
          acts.push(act("map", T.map, () => host.push(this.mapScreen(host, { view: id }))));
          // (deleting asks twice: the first press turns the item into its confirmation)
          // (its confirmation keeps the focus: the same item to the router)
          const del = act(
            sure ? "delete-sure" : "delete",
            sure ? T.delSure : z.state === "ready" ? T.del : T.cancel,
            async () => {
              if (!sure) {
                sure = true;
                host.refresh();
                return;
              }
              await zones.remove(id);
              this.d.toast(tr(T.deleted));
              await this.read();
              host.back();
            },
            undefined,
            "delete",
          );
          if (sure) del.classList.add("pls-danger");
          acts.push(del);
        }
        if (acts[0]) acts[0].dataset.autofocus = "";
        list.replaceChildren(...acts);
        page.append(
          h("header", { class: "pls-head" }, h("h2", { class: "pz-title" }, `${tr(T.tab)} · ${z?.name ?? ""}`)),
          h("div", { class: "pls-body" }, h("div", { class: "pls-side" }, list), about),
          host.prompts([
            ["confirm", T.choose],
            ["back", T.back],
          ]),
        );
        show();
        // (its progress while shown; its state changed: its actions built again)
        let state = z?.state;
        this.watch(page, (f) => {
          const zz = f.zones.find((x) => x.id === id);
          if (!zz) return host.back();
          if (zz.state !== state) {
            state = zz.state;
            return host.refresh();
          }
          show();
        });
        return page;
      },
      leave: () => clearInterval(this.timer),
    };
  }

  // ------------------------------------------------------------------ adding a zone

  /** Opened on the place now (the pause's « Keep this zone offline »), else the last one chosen. */
  startDraft(place?: FootPlace) {
    const p = PROFILES.find((x) => x.id === (this.draft?.profile ?? "low"))!;
    this.draft = {
      place: place ??
        this.draft?.place ??
        this.herePlace() ?? { id: "chamonix", name: { fr: "Chamonix", en: "Chamonix" }, lat: 45.9237, lon: 6.8694 },
      profile: p.id,
      radiusKm: this.draft?.radiusKm ?? p.radiusKm,
      coreKm: this.draft?.coreKm ?? p.coreKm,
    };
  }

  private herePlace(): FootPlace | null {
    const at = this.d.here();
    return at ? { id: `here:${at.lat.toFixed(4)},${at.lon.toFixed(4)}`, name: T.here, lat: at.lat, lon: at.lon, kind: "point" } : null;
  }

  addScreen(host: OfflineHost): MenuScreen {
    if (!this.draft) this.startDraft();
    return {
      id: "offline:add",
      build: () => {
        const D = this.draft!;
        const zones = this.d.pwa()?.zones ?? null;
        const u = this.d.units();
        const page = h("div", { class: "tt-page pls-page pls-offline", "data-testid": "offline-add-screen" });
        const list = h("nav", { class: "pls-list", "aria-label": tr(T.add) });
        const about = h("aside", { class: "pls-explain", "aria-live": "polite", "data-testid": "offline-add-explain" });
        const sub: OfflineHost = {
          ...host,
          explain: (title, text, extra = []) =>
            about.replaceChildren(el("h3", "tt-preview-title", title), el("p", "pls-help", text), ...extra),
        };
        // (the detailed core at most the zone; none with the airfield's profile — its levels already)
        const coreKm = () => (D.profile === "airport" ? 0 : Math.min(D.coreKm, D.radiusKm));
        const est = (core = coreKm()) => {
          const e = zones?.estimate({ lat: D.place.lat, lon: D.place.lon, radiusKm: D.radiusKm, profile: D.profile, coreKm: core });
          return e ?? { chains: 0, urls: 0, bytes: 0, seconds: 0 };
        };
        let e = est();
        // (what the core adds: the estimate without it, read again with the zone)
        let bare = coreKm() ? est(0) : e;
        const free = () => Math.max(0, this.f.quota - this.f.usage);
        const tooBig = () => this.f.quota > 0 && e.bytes > free();
        const rows: (HTMLElement & { render?: () => void })[] = [];
        const again = () => {
          e = est();
          bare = coreKm() ? est(0) : e;
          for (const r of rows) r.render?.();
        };
        const place = this.row(sub, {
          id: "add-place",
          label: tr(T.place),
          value: () => [el("b", "", `${tr(D.place.name)} · ${placeCoords(D.place)}`)],
          help: () => [tr(T.place), tr(T.search)],
          go: () => host.push(this.placeScreen(host)),
          chev: true,
        });
        place.dataset.autofocus = "";
        const onMap = this.row(sub, {
          id: "add-map",
          label: tr(T.onMap),
          value: () => [],
          help: () => [tr(T.onMap), tr(T.onMapHint)],
          go: () => host.push(this.mapScreen(host, {})),
          chev: true,
        });
        const profile = this.row(sub, {
          id: "add-profile",
          label: tr(T.profile),
          value: () => this.choice(tr(profileOf(D.profile).label)),
          help: () => [tr(profileOf(D.profile).label), tr(profileOf(D.profile).hint)],
          step: (dir) => {
            const i = PROFILES.findIndex((p) => p.id === D.profile);
            const p = PROFILES[(i + dir + PROFILES.length) % PROFILES.length]!;
            D.profile = p.id;
            D.radiusKm = p.radiusKm;
            D.coreKm = p.coreKm;
            again();
          },
        });
        const radius = this.row(sub, {
          id: "add-radius",
          label: tr(T.radius),
          value: () => this.choice(u.fDist(D.radiusKm * 1000, 0)),
          help: () => [tr(T.radius), tr(profileOf(D.profile).hint)],
          step: (dir) => {
            const i = RADII.reduce((best, r, k) => (Math.abs(r - D.radiusKm) < Math.abs(RADII[best]! - D.radiusKm) ? k : best), 0);
            D.radiusKm = RADII[Math.min(RADII.length - 1, Math.max(0, i + dir))]!;
            again();
          },
        });
        const core = this.row(sub, {
          id: "add-core",
          label: tr(T.core),
          value: () =>
            D.profile === "airport"
              ? [el("b", "", tr(T.coreAll))]
              : this.choice(
                  coreKm()
                    ? fill(
                        tr(T.coreVal),
                        coreKm() >= D.radiusKm ? tr(T.coreAll) : u.fDist(coreKm() * 1000, coreKm() < 1 ? 1 : 0),
                        fmtBytes(Math.max(0, e.bytes - bare.bytes)),
                      )
                    : tr(T.coreNone),
                ),
          help: () => [tr(T.core), tr(T.coreHelp)],
          step: (dir) => {
            if (D.profile === "airport") return;
            const offered = CORES.filter((c) => c < D.radiusKm).concat(D.radiusKm);
            const i = offered.reduce((best, c, k) => (Math.abs(c - coreKm()) < Math.abs(offered[best]! - coreKm()) ? k : best), 0);
            D.coreKm = offered[Math.min(offered.length - 1, Math.max(0, i + dir))]!;
            again();
          },
        });
        const estimate = this.row(sub, {
          id: "add-estimate",
          label: tr(T.estimate),
          value: () => [
            el("b", tooBig() ? "pls-risky" : "", fill(tr(T.estVal), fmtCount(e.chains), fmtBytes(e.bytes), fmtDuration(e.seconds))),
          ],
          help: () => [tr(T.estimate), fill(tr(T.estHelp), this.f.quota ? fmtBytes(free()) : "—")],
        });
        const go = h(
          "button",
          { class: "m-item tt-act pls-go", type: "button", "data-testid": "offline-download", "data-focus-id": "offline-download" },
          h("span", { class: "tt-act-row" }, el("span", "", tr(T.download))),
          el("small", "", ""),
        ) as HTMLElement & { render?: () => void };
        go.render = () => {
          const big = tooBig();
          go.classList.toggle("off", big || !zones);
          go.setAttribute("aria-disabled", String(big || !zones));
          go.querySelector("small")!.textContent = big
            ? fill(tr(T.tooBig), fmtBytes(free()))
            : `${tr(D.place.name)} · ${u.fDist(D.radiusKm * 1000, 0)}`;
        };
        go.addEventListener("click", async () => {
          if (tooBig() || !zones) return;
          const name = D.place.id.startsWith("here:") ? nearName(D.place.lat, D.place.lon) : tr(D.place.name);
          const id = await zones.add({
            name,
            lat: D.place.lat,
            lon: D.place.lon,
            radiusKm: D.radiusKm,
            profile: D.profile,
            coreKm: coreKm(),
          });
          if (!id) return;
          this.d.toast(fill(tr(T.started), name));
          await this.read();
          host.back();
        });
        go.addEventListener("focus", () => sub.explain(tr(T.download), go.querySelector("small")!.textContent ?? ""));
        rows.push(place, onMap, profile, radius, core, estimate, go);
        go.render();
        list.replaceChildren(place, onMap, profile, radius, core, estimate, go);
        page.append(
          h("header", { class: "pls-head" }, h("h2", { class: "pz-title" }, `${tr(T.tab)} · ${tr(T.add)}`)),
          h("div", { class: "pls-body" }, h("div", { class: "pls-side" }, list), about),
          host.prompts([
            ["left", T.change],
            ["confirm", T.choose],
            ["back", T.back],
          ]),
        );
        // (the room left read again: the estimate's warning follows it)
        this.watch(page, () => go.render?.());
        return page;
      },
      leave: () => clearInterval(this.timer),
    };
  }

  // ------------------------------------------------------------------ the map

  /**
   * The zone on a map (`view`: a zone kept, shown — else the draft's place chosen): its circle at its radius over the zones
   * kept. The mouse: a click sets it down, a drag moves it, the wheel zooms. The keys and the pad, on the map focused:
   * the arrows move it (the view: the map), Page ↑ ↓ (LB RB) zoom, Enter (A) sets it here and goes back.
   */
  private mapScreen(host: OfflineHost, o: { view?: string }): MapScreenState {
    const map = new MapView();
    const viewing = o.view ?? null;
    const zoneNow = () => (viewing ? this.f.zones.find((z) => z.id === viewing) : null);
    const D = this.draft;
    let at = viewing ? { lat: zoneNow()?.lat ?? 0, lon: zoneNow()?.lon ?? 0 } : { lat: D!.place.lat, lon: D!.place.lon };
    const radiusKm = () => (viewing ? (zoneNow()?.radiusKm ?? 1) : D!.radiusKm);
    const screen: MapScreenState = {
      id: "offline:map",
      map,
      at: () => at,
      build: () => {
        const page = h("div", { class: "tt-page pls-page pls-offline pls-map-page", "data-testid": "offline-map" });
        const info = h("div", { class: "pls-map-info", "data-testid": "offline-map-info" });
        const box = h(
          "button",
          {
            class: "m-item pls-map",
            type: "button",
            "data-testid": "offline-map-canvas",
            "data-focus-id": "map",
            "data-autofocus": "",
            "aria-label": tr(viewing ? T.mapView : T.mapPick),
          },
          map.canvas,
        );
        // (its map on it: the tests aim at the zone's circle by it)
        (box as HTMLElement & { map?: MapView }).map = map;
        const u = this.d.units();
        const show = () => {
          const z = zoneNow();
          const e =
            !viewing && this.d.pwa()?.zones
              ? this.d.pwa()!.zones!.estimate({
                  lat: at.lat,
                  lon: at.lon,
                  radiusKm: D!.radiusKm,
                  profile: D!.profile,
                  coreKm: D!.profile === "airport" ? 0 : Math.min(D!.coreKm, D!.radiusKm),
                })
              : null;
          const lines: Node[] = [
            el("h3", "tt-preview-title", viewing ? (z?.name ?? "") : nearName(at.lat, at.lon)),
            el("p", "pls-default", `${placeCoords({ id: "", name: T.point, ...at })} · ${u.fDist(radiusKm() * 1000, 0)}`),
          ];
          if (e) lines.push(el("p", "pls-cost", fill(tr(T.estVal), fmtCount(e.chains), fmtBytes(e.bytes), fmtDuration(e.seconds))));
          lines.push(el("p", "pls-help", tr(viewing ? T.mapViewHelp : T.mapHelp)));
          info.replaceChildren(...lines);
          box.dataset.lat = at.lat.toFixed(5);
          box.dataset.lon = at.lon.toFixed(5);
          box.dataset.zoom = map.zoom.toFixed(2);
          box.dataset.zones = String(this.f.zones.length);
        };
        const moveTo = (lat: number, lon: number, follow = false) => {
          at = { lat: Math.max(-85, Math.min(85, lat)), lon: ((((lon + 180) % 360) + 360) % 360) - 180 };
          if (follow) map.flyTo(at.lat, at.lon, map.zoom, 220);
          map.request();
          show();
        };
        map.overlay = (ctx, to, W, H) => {
          drawZones(
            ctx,
            to,
            this.f.zones.filter((z) => z.id !== viewing || !viewing),
            true,
          );
          if (viewing) {
            const z = zoneNow();
            if (z) drawZones(ctx, to, [z], false);
          } else {
            // (the zone being chosen: its circle dashed, white; its centre's cross)
            const pts = circlePoints(at.lat, at.lon, radiusKm() * 1000).map(([la, lo]) => to(la, lo));
            ctx.beginPath();
            pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.closePath();
            ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
            ctx.fill();
            ctx.setLineDash([6, 5]);
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.setLineDash([]);
            const core = D!.profile === "airport" ? 0 : Math.min(D!.coreKm, D!.radiusKm);
            if (core && core < D!.radiusKm) drawCore(ctx, to, at.lat, at.lon, core, "#ffffff");
          }
          const [x, y] = to(at.lat, at.lon);
          ctx.strokeStyle = viewing ? ZONE_COL[zoneNow()?.state ?? "ready"] : "#ffffff";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x - 9, y);
          ctx.lineTo(x + 9, y);
          ctx.moveTo(x, y - 9);
          ctx.lineTo(x, y + 9);
          ctx.stroke();
          void W;
          void H;
        };
        map.onMove = () => {
          box.dataset.zoom = map.zoom.toFixed(2);
        };
        if (!viewing) {
          map.onPick = (lat, lon) => moveTo(lat, lon);
          // (a press inside the circle: the circle dragged, not the map)
          map.grab = (px, py) => {
            const [x, y] = map.toScreen(at.lat, at.lon);
            const [ex] = map.toScreen(...circlePoints(at.lat, at.lon, radiusKm() * 1000, 4)[1]!);
            return Math.hypot(px - x, py - y) <= Math.max(18, Math.abs(ex - x)) ? (lat, lon) => moveTo(lat, lon) : null;
          };
        }
        // (the keys, the pad's as keys: the arrows a tenth of the view, Page ↑ ↓ a zoom step, Enter set down)
        box.addEventListener("keydown", (e) => {
          const W = map.canvas.clientWidth || 800,
            H = map.canvas.clientHeight || 600;
          const step: Record<string, [number, number]> = {
            ArrowLeft: [-0.1 * W, 0],
            ArrowRight: [0.1 * W, 0],
            ArrowUp: [0, -0.1 * H],
            ArrowDown: [0, 0.1 * H],
          };
          const s = step[e.key];
          if (s) {
            e.preventDefault();
            e.stopPropagation();
            const [x, y] = map.toScreen(at.lat, at.lon);
            const [lat, lon] = map.placeAt(x + s[0], y + s[1]);
            moveTo(lat, lon, true);
            return;
          }
          if (e.key === "PageUp" || e.key === "PageDown") {
            e.preventDefault();
            e.stopPropagation();
            const [x, y] = map.toScreen(at.lat, at.lon);
            map.zoomAbout(e.key === "PageUp" ? 1 : -1, x, y);
            show();
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            setHere();
          }
        });
        // (leaving: the focus put back on the map first — the router remembers it, the next visit's arrows the map's)
        const leave = () => {
          box.focus();
          host.back();
        };
        const setHere = () => {
          if (viewing || !D) return leave();
          D.place = {
            id: `map:${at.lat.toFixed(4)},${at.lon.toFixed(4)}`,
            name: { fr: nearName(at.lat, at.lon, "fr"), en: nearName(at.lat, at.lon, "en") },
            lat: at.lat,
            lon: at.lon,
            kind: "point",
          };
          leave();
        };
        const acts: HTMLElement[] = [];
        const act = (testid: string, label: Text, go: () => void) => {
          const b = h(
            "button",
            { class: "m-item tt-act", type: "button", "data-testid": `offline-map-${testid}`, "data-focus-id": `map-${testid}` },
            h("span", { class: "tt-act-row" }, el("span", "", tr(label))),
          );
          b.addEventListener("click", go);
          acts.push(b);
        };
        if (!viewing) act("here", T.setHere, setHere);
        else {
          const z = zoneNow();
          if (z) act("atlas", T.atlas, () => this.d.showOnMap({ lat: z.lat, lon: z.lon, name: z.name }));
        }
        act("back", T.back, leave);
        page.append(
          h("header", { class: "pls-head" }, h("h2", { class: "pz-title" }, `${tr(T.tab)} · ${tr(viewing ? T.mapView : T.mapPick)}`)),
          h("div", { class: "pls-map-body" }, h("div", { class: "pls-side pls-map-side" }, info, ...acts), box),
          host.prompts([
            ["up", T.change],
            ["tabNext", T.zoom],
            ["confirm", viewing ? T.back : T.setHere],
            ["back", T.back],
          ]),
        );
        show();
        // (the view: the zone's circle about a fifth of the map's height — once the canvas has its size)
        requestAnimationFrame(() => {
          map.setBody("earth");
          const H = map.canvas.clientHeight || 600;
          const rWorld = (radiusKm() * 1000) / (2 * Math.PI * 6_378_137 * Math.cos((at.lat * Math.PI) / 180));
          const z = Math.log2((0.2 * H) / (rWorld * 256));
          map.flyTo(at.lat, at.lon, Math.max(map.minZoom(), Math.min(14, z)), 10);
          show();
        });
        this.watch(page, () => {
          map.request();
          show();
        });
        return page;
      },
      // (the map's pad keys its own: the router not to move the focus off it)
      action: (a) => a === "tabPrev" || a === "tabNext",
      leave: () => clearInterval(this.timer),
    };
    return screen;
  }

  // ------------------------------------------------------------------ the place

  /** The Earth's places: the position now, coordinates, the Atlas's destinations, an address (the On foot screen's
   *  search — ui/title/title.ts placePicker). */
  private placeScreen(host: OfflineHost): MenuScreen {
    let asked: AbortController | null = null;
    let timer = 0;
    return {
      id: "offline:place",
      build: () => {
        const D = this.draft!;
        const page = h("div", { class: "tt-page tt-list tt-picker", "data-testid": "offline-place" });
        const input = h("input", {
          class: "tt-search",
          type: "search",
          placeholder: tr(T.search),
          "aria-label": tr(T.search),
          "data-testid": "offline-place-search",
          "data-autofocus": "",
        }) as HTMLInputElement;
        const list = h("nav", { class: "tt-acts tt-fields", "aria-label": tr(T.place) });
        const status = el("p", "tt-empty", "");
        const entry = (p: FootPlace, sub: string, testid: string) => {
          const b = h(
            "button",
            { class: "m-item tt-act", type: "button", "data-testid": testid, "data-focus-id": `place-${p.id}` },
            el("span", "", tr(p.name)),
            el("small", "", sub),
          );
          if (p.id === D.place.id) b.classList.add("on");
          b.addEventListener("click", () => {
            D.place = p;
            host.back();
          });
          return b;
        };
        const fillList = () => {
          const q = input.value.trim();
          const rows: HTMLElement[] = [];
          const here = this.herePlace();
          if (here && !q) rows.push(entry(here, placeCoords(here), "offline-place-here"));
          const at = parseCoords(q);
          if (at)
            rows.push(
              entry(
                { id: `pt:${at.lat.toFixed(4)},${at.lon.toFixed(4)}`, name: T.point, lat: at.lat, lon: at.lon, kind: "point" },
                placeCoords({ id: "", name: T.point, ...at }),
                "offline-place-point",
              ),
            );
          for (const x of placesOf("earth", q).slice(0, 80)) {
            if (x.group) rows.push(el("h4", "tt-group", x.group));
            rows.push(entry(x.place, tr(x.place.about ?? { fr: "", en: "" }), `offline-place-${x.place.id}`));
          }
          list.replaceChildren(...rows);
          status.textContent = "";
          // (the addresses: asked once the typing pauses — the newer search supersedes the older)
          asked?.abort();
          clearTimeout(timer);
          if (at || q.length < 3) return;
          status.textContent = tr(T.searching);
          timer = window.setTimeout(() => {
            const ctl = new AbortController();
            asked = ctl;
            void geocode(q, { lang, near: { lat: D.place.lat, lon: D.place.lon }, signal: ctl.signal })
              .then((found) => {
                if (ctl.signal.aborted || !page.isConnected) return;
                status.textContent = found.length ? "" : tr(T.noAddress);
                if (!found.length) return;
                list.append(
                  el("h4", "tt-group", tr(T.addresses)),
                  ...found.map((g, i) =>
                    entry(
                      {
                        id: `addr:${g.lat.toFixed(4)},${g.lon.toFixed(4)}`,
                        name: { fr: g.name, en: g.name },
                        lat: g.lat,
                        lon: g.lon,
                        kind: "address",
                        about: { fr: g.detail, en: g.detail },
                      },
                      g.detail,
                      `offline-place-address-${i}`,
                    ),
                  ),
                );
              })
              .catch(() => {
                if (!ctl.signal.aborted && page.isConnected) status.textContent = tr(T.noAddress);
              });
          }, 450);
        };
        input.addEventListener("input", fillList);
        input.addEventListener("keydown", (e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            list.querySelector<HTMLElement>("button")?.focus();
          } else if (e.key === "Enter") {
            e.preventDefault();
            list.querySelector<HTMLElement>("button")?.click();
          }
        });
        fillList();
        page.append(
          h(
            "p",
            { class: "pz-crumb" },
            el("span", "", tr(T.title)),
            el("i", "", "›"),
            el("span", "", tr(T.tab)),
            el("i", "", "›"),
            el("b", "", tr(T.place)),
          ),
          h("div", { class: "tt-list-side tt-picker-body" }, input, status, list),
          host.prompts([
            ["confirm", T.choose],
            ["back", T.back],
          ]),
        );
        return page;
      },
      leave: () => {
        clearTimeout(timer);
        asked?.abort();
      },
    };
  }
}
