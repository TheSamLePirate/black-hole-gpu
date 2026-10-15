// Missions made (docs/PLAN-AVIATION-AAA.md, P3 — game/mission.ts): a mission as a link (#mission=…, the base64url of
// its JSON), read back; and a mission sketched — by TARS from a sentence, by the editor — completed: its places named
// ("Nice", "LFMN") found, its ids, its objectives' words, its start (where we fly, else near its first place) and its
// time allowed set; a real flight escorted somewhere sent there (its course to it once the mission begins). Then
// checked as any.

import { tf } from "../i18n";
import { checkMission, distM, type GeoPt, type MissionSpec, type MissionUnit, type Objective, type Trigger } from "./mission";

/** A mission as a link's hash. */
export function missionToHash(spec: MissionSpec): string {
  const bytes = new TextEncoder().encode(JSON.stringify(spec));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `#mission=${btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

/** A link's mission (null: none in it); what is wrong in it thrown. */
export function missionFromHash(hash: string): MissionSpec | null {
  const m = /[#&]mission=([\w-]+)/.exec(hash);
  if (!m) return null;
  const b64 = m[1]!.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const { spec, errors } = checkMission(JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))));
  if (!spec) throw new Error(errors.join("; "));
  return spec;
}

/** A place as a sketch may give it: a point, or a name to find (an airfield's ICAO, a town). */
export type Where = GeoPt | { place: string; alt?: number };
/** Finds a named place (null: not found). */
export type Resolver = (
  name: string,
) => Promise<{ lat: number; lon: number; name?: string } | null> | { lat: number; lon: number; name?: string } | null;

/** A sketched objective: its kind, what it is about, any left out. */
export interface SketchObjective {
  kind: Objective["kind"];
  id?: string;
  text?: string;
  optional?: boolean;
  points?: number;
  after?: string;
  units?: string[];
  unit?: string;
  within?: number;
  seconds?: number;
  carrier?: string;
  at?: Where & { radius?: number };
  until?: Where & { radius?: number };
}

/** A sketch: a mission's fields, any left out; its places points or names. */
export interface Sketch {
  id?: string;
  title?: string;
  brief?: string;
  start?: Partial<MissionSpec["start"]> & { place?: string };
  time?: MissionSpec["time"];
  weather?: MissionSpec["weather"];
  units?: (Partial<MissionUnit> & { kind: MissionUnit["kind"]; at?: Where; route?: Where[] })[];
  objectives?: SketchObjective[];
  triggers?: Trigger[];
  limit?: number;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "mission";

/**
 * A sketch completed into a mission: its names found (`resolve`), its ids and words, its start (`here`: where we
 * fly — else 40 km short of its first place, heading for it), its time allowed (the way at 250 m/s, twice, 10 min at
 * least); a real flight or an airliner escorted to a place turned for it 5 s in. The mission checked, or what is
 * wrong.
 */
export async function completeMission(
  x: Sketch,
  o: { here?: GeoPt & { alt: number; hdg: number; speed: number }; resolve: Resolver },
): Promise<{ spec: MissionSpec | null; errors: string[] }> {
  const errors: string[] = [];
  const names = new Map<string, string>();
  const find = async <T extends object>(w: T | undefined, what: string): Promise<(T & GeoPt) | undefined> => {
    if (!w) return undefined;
    const p = w as unknown as Partial<GeoPt> & { place?: string };
    if (typeof p.lat === "number" && typeof p.lon === "number") return w as T & GeoPt;
    if (typeof p.place === "string" && p.place.trim()) {
      const r = await o.resolve(p.place.trim());
      if (!r) {
        errors.push(tf("{0}: no place called {1}", what, p.place));
        return undefined;
      }
      const { place, ...rest } = p;
      const out = { ...rest, lat: r.lat, lon: r.lon } as unknown as T & GeoPt;
      names.set(`${r.lat},${r.lon}`, r.name ?? place!);
      return out;
    }
    return undefined;
  };
  const nameAt = (g: GeoPt) => names.get(`${g.lat},${g.lon}`) ?? `${g.lat.toFixed(2)}°, ${g.lon.toFixed(2)}°`;
  // the units: their ids, their places found
  const units: MissionUnit[] = [];
  let k = 0;
  for (const u of x.units ?? []) {
    k++;
    const at = await find(u.at, `unit ${u.id ?? k}`);
    const route: GeoPt[] = [];
    for (const r of u.route ?? []) {
      const p = await find(r, `unit ${u.id ?? k}'s route`);
      if (p) route.push(p);
    }
    const id = u.id ?? `${u.kind}${k}`;
    units.push({
      ...(u as MissionUnit),
      id,
      at,
      route: route.length ? route : undefined,
      name: u.name ?? u.match?.callsign ?? (u.kind === "carrier" ? u.carrier : undefined),
    });
  }
  const unitName = (id: string) => {
    const u = units.find((v) => v.id === id);
    return u?.name ?? u?.match?.callsign ?? id;
  };
  // the objectives: their ids, places, words
  const objectives: Objective[] = [];
  k = 0;
  for (const ob of x.objectives ?? []) {
    k++;
    const id = ob.id ?? `o${k}`;
    const at = await find(ob.at, `objective ${id}`);
    const until = await find(ob.until, `objective ${id}`);
    const radius = (z: { radius?: number } | undefined, d: number) => (z?.radius && z.radius > 0 ? z.radius : d);
    let done: Objective | null = null;
    const base = { id, optional: ob.optional, points: ob.points, after: ob.after };
    switch (ob.kind) {
      case "reach":
        if (at) done = { ...base, kind: "reach", at: { ...at, radius: radius(at, 3000) }, text: ob.text ?? tf("Reach {0}", nameAt(at)) };
        break;
      case "destroy": {
        const us = ob.units ?? [];
        done = { ...base, kind: "destroy", units: us, text: ob.text ?? tf("Destroy {0}", us.map(unitName).join(", ")) };
        break;
      }
      case "escort": {
        const u = ob.unit ?? "";
        if (until)
          done = {
            ...base,
            kind: "escort",
            unit: u,
            until: { ...until, radius: radius(until, 15_000) },
            within: ob.within ?? 8000,
            text: ob.text ?? tf("Escort {0} to {1}", unitName(u), nameAt(until)),
          };
        break;
      }
      case "protect": {
        const u = ob.unit ?? "";
        const s = ob.seconds ?? 300;
        done = {
          ...base,
          kind: "protect",
          unit: u,
          seconds: s,
          text: ob.text ?? tf("Protect {0} for {1} min", unitName(u), Math.round(s / 60)),
        };
        break;
      }
      case "identify": {
        const u = ob.unit ?? "";
        done = { ...base, kind: "identify", unit: u, within: ob.within ?? 900, text: ob.text ?? tf("Identify {0}", unitName(u)) };
        break;
      }
      case "land": {
        const cv = ob.carrier;
        done = {
          ...base,
          kind: "land",
          carrier: cv,
          at: at ? { ...at, radius: radius(at, 4000) } : undefined,
          text: ob.text ?? (cv ? tf("Land aboard {0}", unitName(cv)) : at ? tf("Land at {0}", nameAt(at)) : tf("Land")),
        };
        break;
      }
    }
    if (done) objectives.push(done);
    else errors.push(tf("objective {0}: its place", id));
  }
  // (an airliner, a real flight escorted somewhere: it goes there)
  const triggers = [...(x.triggers ?? [])];
  for (const ob of objectives)
    if (ob.kind === "escort") {
      const u = units.find((v) => v.id === ob.unit);
      const turned = triggers.some((tr) => tr.do.some((a) => "course" in a && a.course.unit === ob.unit));
      if (u && (u.kind === "traffic" || u.kind === "airliner") && !u.route && !turned)
        triggers.push({
          id: `to-${ob.id}`,
          when: { time: 5 },
          do: [{ course: { unit: ob.unit, to: { lat: ob.until.lat, lon: ob.until.lon, alt: 3000 } } }],
        });
    }
  // the first place: the start's aim, the time's measure
  const first: GeoPt | undefined =
    units.find((u) => u.at)?.at ??
    objectives
      .map((ob) => (ob.kind === "reach" ? ob.at : ob.kind === "escort" ? ob.until : ob.kind === "land" ? ob.at : undefined))
      .find(Boolean);
  // the start: given, else where we fly, else short of the first place
  let start: MissionSpec["start"] | undefined;
  const s0 = x.start ? await find(x.start, "start") : undefined;
  if (s0) {
    start = { hdg: 0, speed: 230, alt: 3000, ...(x.start as object), lat: s0.lat, lon: s0.lon } as MissionSpec["start"];
    // (a start in the air: high and fast enough to fly — 1 000 m over the sea, 150 m/s at least)
    if (!x.start?.carrier) {
      start.alt = Math.max(start.alt ?? 3000, 1000);
      start.speed = Math.max(start.speed, 150);
    }
  } else if (o.here) start = { lat: o.here.lat, lon: o.here.lon, alt: o.here.alt, hdg: o.here.hdg, speed: Math.max(o.here.speed, 150) };
  else if (first) {
    const D = Math.PI / 180;
    const back = 40_000 / 6_371_008.8 / D;
    start = { lat: first.lat - back, lon: first.lon, alt: 4000, hdg: 0, speed: 230 };
  }
  if (start) {
    for (const k2 of ["variant", "loadout", "fuel", "carrier"] as const)
      if (x.start?.[k2] !== undefined) (start as unknown as Record<string, unknown>)[k2] = x.start[k2];
    if (!start.loadout) start.loadout = units.some((u) => u.kind === "sam" || u.kind === "truck" || u.kind === "bunker") ? "ag" : "aa";
  }
  // (a real flight not placed: where it is set when none is heard — 25 km ahead of the start, at 10 km)
  if (start) {
    const D = Math.PI / 180;
    for (const u of units)
      if (u.kind === "traffic" && !u.at) {
        const h = start.hdg * D;
        const d = 25_000 / 6_371_008.8 / D;
        u.at = { lat: start.lat + d * Math.cos(h), lon: start.lon + (d * Math.sin(h)) / Math.cos(start.lat * D), alt: 10_000 };
        u.hdg ??= start.hdg;
      }
  }
  const far = first && start ? distM(start, first) : 0;
  const limit = x.limit ?? Math.max(600, Math.round(((far * 2) / 250 + 300) / 60) * 60);
  const title = x.title?.trim() || objectives[0]?.text || "Mission";
  if (errors.length) return { spec: null, errors };
  return checkMission({
    v: 1,
    id: x.id ?? `${slug(title)}-${Date.now().toString(36).slice(-4)}`,
    title,
    brief: x.brief ?? objectives.map((ob) => ob.text).join(" · "),
    start,
    time: x.time,
    weather: x.weather,
    units,
    objectives,
    triggers,
    limit,
  });
}

// ------------------------------------------------------------------------------------ the editor's draft

/** A unit as the editor holds it: where, what, whose, what to do with it, when it appears. */
export interface DraftUnit {
  id: string;
  kind: MissionUnit["kind"];
  name: string;
  lat: number;
  lon: number;
  /** its height over the sea [m] (an aircraft's) */
  alt: number;
  hdg: number;
  speed?: number;
  side: "hostile" | "friend" | "neutral";
  /** a real flight's callsign (kind traffic) */
  callsign?: string;
  carrier?: MissionUnit["carrier"];
  /** its objectives, in order: destroy it, identify it, escort it to the destination, protect it, land aboard (a
   *  carrier) */
  roles: UnitRole[];
  /** set this many seconds in (none: from the start) */
  appear?: number;
  /** set by one of the mission's own triggers (kept in `extra`) */
  byTrigger?: boolean;
  /** destroyed together with the others of its group: one objective for all */
  group?: string;
  optional?: boolean;
  /** its objectives' words (none: made) */
  texts?: Partial<Record<UnitRole, string>>;
}
export type UnitRole = "destroy" | "identify" | "escort" | "protect" | "land";
/** A place: to reach, to land at, an escort's destination. */
export interface DraftPlace {
  id: string;
  lat: number;
  lon: number;
  radius: number;
  role: "reach" | "land" | "dest";
  name: string;
  optional?: boolean;
  text?: string;
}
export interface Draft {
  id: string;
  title: string;
  brief: string;
  start: { lat: number; lon: number; alt: number; hdg: number; speed: number };
  variant: "B" | "C";
  loadout: "aa" | "ag" | "gun";
  /** the local hour there (none: the scene's) */
  hour?: number;
  weather: string;
  /** the time allowed [min] */
  limit: number;
  units: DraftUnit[];
  places: DraftPlace[];
  /** the messages said along the way: when [s], what */
  msgs: { at: number; text: string }[];
  /** the objectives one after the other (each after the one before) */
  chain: boolean;
  /** the triggers the editor does not show (a mission's own, kept) */
  extra: Trigger[];
}

/** A new draft about a place (the craft's). */
export const newDraft = (at: { lat: number; lon: number; alt?: number; hdg?: number }): Draft => ({
  id: `m-${Date.now().toString(36)}`,
  title: "",
  brief: "",
  start: { lat: at.lat, lon: at.lon, alt: Math.max(1500, at.alt ?? 3000), hdg: at.hdg ?? 0, speed: 230 },
  variant: "B",
  loadout: "aa",
  weather: "fair",
  limit: 30,
  units: [],
  places: [],
  msgs: [],
  chain: false,
  extra: [],
});

/** The draft as a mission (checked), or what is wrong. */
export function draftToSpec(d: Draft): { spec: MissionSpec | null; errors: string[] } {
  const dest = d.places.find((p) => p.role === "dest");
  const name = (u: DraftUnit) => u.name || u.callsign || u.id;
  const objectives: Objective[] = [];
  const errors: string[] = [];
  const place = (p: DraftPlace) => (p.name ? p.name : `${p.lat.toFixed(2)}°, ${p.lon.toFixed(2)}°`);
  for (const u of d.units)
    for (const r of u.roles) {
      const base = { id: u.roles.length > 1 ? `o-${u.id}-${r}` : `o-${u.id}`, optional: u.optional || undefined };
      const text = u.texts?.[r];
      if (r === "destroy" && u.group) {
        // (a group: one objective, at its first)
        if (objectives.some((o) => o.id === `o-${u.group}`)) continue;
        const all = d.units.filter((v) => v.group === u.group && v.roles.includes("destroy"));
        objectives.push({
          ...base,
          id: `o-${u.group}`,
          kind: "destroy",
          units: all.map((v) => v.id),
          text: text || tf("Destroy {0}", all.map(name).join(", ")),
        });
      } else if (r === "destroy") objectives.push({ ...base, kind: "destroy", units: [u.id], text: text || tf("Destroy {0}", name(u)) });
      else if (r === "identify")
        objectives.push({ ...base, kind: "identify", unit: u.id, within: 900, text: text || tf("Identify {0}", name(u)) });
      else if (r === "protect")
        objectives.push({ ...base, kind: "protect", unit: u.id, seconds: 300, text: text || tf("Protect {0} for {1} min", name(u), 5) });
      else if (r === "land") objectives.push({ ...base, kind: "land", carrier: u.id, text: text || tf("Land aboard {0}", name(u)) });
      else if (!dest) errors.push(tf("{0}: an escort's destination (a place)", name(u)));
      else
        objectives.push({
          ...base,
          kind: "escort",
          unit: u.id,
          until: { lat: dest.lat, lon: dest.lon, radius: dest.radius },
          within: 8000,
          text: text || tf("Escort {0} to {1}", name(u), place(dest)),
        });
    }
  for (const p of d.places) {
    const base = { id: `o-${p.id}`, optional: p.optional || undefined };
    if (p.role === "reach")
      objectives.push({
        ...base,
        kind: "reach",
        at: { lat: p.lat, lon: p.lon, radius: p.radius },
        text: p.text || tf("Reach {0}", place(p)),
      });
    else if (p.role === "land")
      objectives.push({
        ...base,
        kind: "land",
        at: { lat: p.lat, lon: p.lon, radius: p.radius },
        text: p.text || tf("Land at {0}", place(p)),
      });
  }
  if (d.chain) {
    let prev: string | undefined;
    for (const o of objectives) {
      if (o.optional) continue;
      if (prev) o.after = prev;
      prev = o.id;
    }
  }
  const units: MissionUnit[] = d.units.map((u) => ({
    id: u.id,
    kind: u.kind,
    name: u.name || undefined,
    carrier: u.kind === "carrier" ? (u.carrier ?? "ford") : undefined,
    at: { lat: u.lat, lon: u.lon, alt: u.alt },
    hdg: u.hdg,
    speed: u.speed,
    side: u.kind === "carrier" ? undefined : u.side,
    match: u.kind === "traffic" && u.callsign ? { callsign: u.callsign } : undefined,
    later: (u.appear !== undefined && u.appear > 0) || u.byTrigger ? true : undefined,
  }));
  const triggers: Trigger[] = [...d.extra];
  for (const u of d.units)
    if (u.appear !== undefined && u.appear > 0) triggers.push({ id: `appear-${u.id}`, when: { time: u.appear }, do: [{ spawn: u.id }] });
  d.msgs.forEach((m, i) => triggers.push({ id: `say-${i}`, when: { time: m.at }, do: [{ say: m.text }] }));
  // (an airliner, a real flight escorted: it goes to the destination)
  for (const o of objectives)
    if (o.kind === "escort") {
      const u = d.units.find((v) => v.id === o.unit)!;
      const turned = triggers.some((tr) => tr.do.some((a) => "course" in a && a.course.unit === u.id));
      if ((u.kind === "airliner" || u.kind === "traffic") && !turned)
        triggers.push({
          id: `to-${o.id}`,
          when: { time: 5 },
          do: [{ course: { unit: u.id, to: { lat: o.until.lat, lon: o.until.lon, alt: 3000 } } }],
        });
    }
  if (errors.length) return { spec: null, errors };
  return checkMission({
    v: 1,
    id: d.id,
    title: d.title.trim() || objectives[0]?.text || "Mission",
    brief: d.brief.trim() || objectives.map((o) => o.text).join(" · "),
    start: { ...d.start, variant: d.variant, loadout: d.loadout },
    time: d.hour !== undefined ? { localHour: d.hour } : undefined,
    weather: { preset: d.weather, wind: 1 },
    units,
    objectives,
    triggers,
    limit: Math.round(d.limit * 60),
  });
}

/** A mission as the editor's draft (a given one edited): its units and places with their objectives, its
 *  appearances and messages; its other triggers kept as they are. */
export function specToDraft(s: MissionSpec): Draft {
  const objsOf = (id: string) =>
    s.objectives.filter((x) =>
      x.kind === "destroy" ? x.units.includes(id) : "unit" in x ? x.unit === id : x.kind === "land" && x.carrier === id,
    );
  const appear = new Map<string, number>();
  const msgs: Draft["msgs"] = [];
  const extra: Trigger[] = [];
  for (const tr of s.triggers ?? []) {
    if ("time" in tr.when && tr.do.every((a) => "spawn" in a))
      for (const a of tr.do) appear.set((a as { spawn: string }).spawn, tr.when.time);
    else if ("time" in tr.when && tr.do.length === 1 && "say" in tr.do[0]!) msgs.push({ at: tr.when.time, text: tr.do[0].say });
    else extra.push(tr);
  }
  const spawned = new Set(extra.flatMap((tr) => tr.do.flatMap((a) => ("spawn" in a ? [a.spawn] : []))));
  const units: DraftUnit[] = s.units.map((u) => {
    const os = objsOf(u.id);
    return {
      id: u.id,
      kind: u.kind,
      name: u.name ?? "",
      lat: u.at?.lat ?? s.start.lat,
      lon: u.at?.lon ?? s.start.lon,
      alt:
        u.at?.alt ?? (u.kind === "drone" ? 4000 : u.kind === "fighter" ? 6000 : u.kind === "airliner" || u.kind === "traffic" ? 9000 : 0),
      hdg: u.hdg ?? 0,
      speed: u.speed,
      side: u.side ?? (u.kind === "airliner" || u.kind === "traffic" ? "neutral" : "hostile"),
      callsign: u.match?.callsign,
      carrier: u.carrier,
      roles: os.map((o) => o.kind as UnitRole),
      appear: u.later && !spawned.has(u.id) ? (appear.get(u.id) ?? 60) : undefined,
      byTrigger: u.later && spawned.has(u.id) ? true : undefined,
      group: os.find((o) => o.kind === "destroy" && o.units.length > 1)?.id,
      optional: os.length ? os.every((o) => o.optional) : undefined,
      texts: Object.fromEntries(os.map((o) => [o.kind, o.text])),
    };
  });
  const places: DraftPlace[] = [];
  for (const o of s.objectives) {
    if (o.kind === "reach") places.push({ id: o.id, ...o.at, role: "reach", name: "", optional: o.optional, text: o.text });
    else if (o.kind === "land" && o.at) places.push({ id: o.id, ...o.at, role: "land", name: "", optional: o.optional, text: o.text });
    else if (o.kind === "escort" && !places.some((p) => p.role === "dest"))
      places.push({ id: `${o.id}-dest`, ...o.until, role: "dest", name: "" });
  }
  // (the "say" with a course or a side change — a deviation — stays in extra; the "say" alone, a message)
  return {
    id: s.id,
    title: s.title,
    brief: s.brief,
    start: { lat: s.start.lat, lon: s.start.lon, alt: s.start.alt ?? 3000, hdg: s.start.hdg, speed: s.start.speed },
    variant: s.start.variant ?? "B",
    loadout: s.start.loadout ?? "aa",
    hour: s.time?.localHour,
    weather: s.weather?.preset ?? "fair",
    limit: Math.round((s.limit ?? 1800) / 60),
    units,
    places,
    msgs,
    chain: s.objectives.some((o) => !!o.after),
    extra: extra.filter((tr) => !tr.id.startsWith("to-")),
  };
}
