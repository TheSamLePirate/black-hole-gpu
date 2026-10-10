// Every game action as a "/" command (PLAN-TARS-AGENT C6): run at once by TARS's own tools, without the model
// — the target, the views (/cockpit, /chase…), the autopilots, the holds, the controls, the time, teleporting,
// missions and manoeuvres, the camera, the sky, the interface, saves and scenes, any setting, any key —
// their arguments by position ("/teleport orbit Lune 100") or by name ("altKm=100"), each completed as one
// types (bodies, sites, views, screens, scenes, saves, settings and their values, keys, constellations); and
// /tool for any of his tools with its parameters. Pure: the words in, the tool's call and the completions
// out.

import type { Text } from "../i18n";
import type { Args, Param, ToolSpec } from "./tool-schema";

/** The values a parameter may take, by kind (main.ts fills them). */
export interface GameCtx {
  bodies: { value: string; hint?: string }[];
  sites: { value: string; hint?: string }[];
  mounts: { value: string; hint?: string }[];
  screens: string[];
  scenes: string[];
  saves: string[];
  settings: { key: string; label: string; values?: string[] }[];
  sky: string[];
  keys: { value: string; hint?: string }[];
  tools: ToolSpec[];
}

type Provider =
  | "body"
  | "site"
  | "place"
  | "mount"
  | "screen"
  | "scene"
  | "save"
  | "setting"
  | "settingValue"
  | "sky"
  | "key"
  | "onoff"
  | "updown";

export interface GameCommand {
  name: string;
  /** the tool it calls */
  tool: string;
  /** its positional arguments: each the tool's parameter it fills, and where its values come from */
  args?: { param: string; from?: Provider; rest?: boolean }[];
  /** the arguments it always sets */
  fixed?: Args;
  desc: Text;
}

const M = (name: string, desc: Text): GameCommand => ({ name, tool: "camera", fixed: { mount: name }, desc });

export const GAME_COMMANDS: GameCommand[] = [
  // the target, the views
  {
    name: "target",
    tool: "set_target",
    args: [{ param: "name", from: "body", rest: true }],
    desc: { fr: "Viser un corps, une station, un vaisseau", en: "Target a body, a station, a craft" },
  },
  {
    name: "view",
    tool: "camera",
    args: [{ param: "mount", from: "mount" }],
    desc: { fr: "Une vue du vaisseau", en: "A view of the ship" },
  },
  M("cockpit", { fr: "Vue cockpit", en: "Cockpit view" }),
  M("cabin", { fr: "Vue cabine (libre)", en: "Cabin view (free)" }),
  M("chase", { fr: "Vue poursuite", en: "Chase view" }),
  M("quarter", { fr: "Vue trois-quarts (film)", en: "Quarter view (film)" }),
  M("around", { fr: "Vue autour du vaisseau", en: "View around the ship" }),
  M("flyby", { fr: "Vue de passage", en: "Fly-by view" }),
  { name: "shipview", tool: "camera", fixed: { shipView: true }, desc: { fr: "Retour à la vue vaisseau", en: "Back to the ship's view" } },
  {
    name: "spectator",
    tool: "camera",
    args: [{ param: "spectator", from: "onoff" }],
    desc: { fr: "Caméra libre, le vaisseau continue", en: "Free camera, the ship flies on" },
  },
  {
    name: "goto",
    tool: "camera",
    args: [{ param: "goTo", from: "body", rest: true }],
    desc: { fr: "La caméra libre vers un corps", en: "The free camera to a body" },
  },
  { name: "telescope", tool: "camera", args: [{ param: "telescope", from: "onoff" }], desc: { fr: "Le télescope", en: "The telescope" } },
  {
    name: "lookat",
    tool: "camera",
    args: [{ param: "lookAt", from: "onoff" }],
    desc: { fr: "La vue verrouillée sur la cible", en: "The view locked on the target" },
  },
  { name: "fov", tool: "camera", args: [{ param: "fovDeg" }], desc: { fr: "Le champ de vision [°]", en: "The field of view [°]" } },
  {
    name: "cinematic",
    tool: "camera",
    args: [{ param: "cinematic" }],
    desc: { fr: "Une cinématique (orbit, dive, journey, none)", en: "A cinematic (orbit, dive, journey, none)" },
  },
  // flying
  {
    name: "autopilot",
    tool: "autopilot",
    args: [{ param: "mode" }, { param: "site", from: "site", rest: true }],
    desc: { fr: "Un autopilote (et son site)", en: "An autopilot (and its site)" },
  },
  {
    name: "land",
    tool: "autopilot",
    fixed: { mode: "land" },
    desc: { fr: "Autopilote : posé propulsé ici", en: "Autopilot: powered landing here" },
  },
  {
    name: "entry",
    tool: "autopilot",
    fixed: { mode: "entry" },
    args: [{ param: "site", from: "site", rest: true }],
    desc: { fr: "Rentrée et posé sur un site", en: "Entry and landing at a site" },
  },
  {
    name: "takeoff",
    tool: "autopilot",
    fixed: { mode: "takeoff" },
    args: [{ param: "altKm" }, { param: "incDeg" }],
    desc: { fr: "Décollage vers une orbite [km] [°]", en: "Take-off to an orbit [km] [°]" },
  },
  { name: "dock", tool: "autopilot", fixed: { mode: "dock" }, desc: { fr: "Autopilote d'amarrage", en: "Docking autopilot" } },
  { name: "circularize", tool: "autopilot", fixed: { mode: "circularize" }, desc: { fr: "Circulariser", en: "Circularize" } },
  { name: "hover", tool: "autopilot", fixed: { mode: "hover" }, desc: { fr: "Tenir la position", en: "Hold position" } },
  { name: "apoff", tool: "autopilot", fixed: { mode: "none" }, desc: { fr: "Couper l'autopilote", en: "Autopilot off" } },
  { name: "hold", tool: "hold", args: [{ param: "direction" }], desc: { fr: "Un maintien d'attitude", en: "An attitude hold" } },
  { name: "throttle", tool: "controls", args: [{ param: "throttle" }], desc: { fr: "Les gaz (0 à 1)", en: "The throttle (0 to 1)" } },
  {
    name: "gear",
    tool: "controls",
    args: [{ param: "gear", from: "updown" }],
    desc: { fr: "Le train (down, up)", en: "The gear (down, up)" },
  },
  { name: "flaps", tool: "controls", args: [{ param: "flaps" }], desc: { fr: "Les volets (0, 0.5, 1)", en: "The flaps (0, 0.5, 1)" } },
  { name: "brake", tool: "controls", args: [{ param: "airBrake", from: "onoff" }], desc: { fr: "L'aérofrein", en: "The air brake" } },
  { name: "sas", tool: "controls", args: [{ param: "sas", from: "onoff" }], desc: { fr: "Le SAS", en: "The SAS" } },
  { name: "assist", tool: "controls", args: [{ param: "assist", from: "onoff" }], desc: { fr: "Le mode assisté", en: "Assisted mode" } },
  {
    name: "flightmode",
    tool: "controls",
    args: [{ param: "flightMode" }],
    desc: { fr: "La loi de vol (rocket, plane, sf)", en: "The flight law (rocket, plane, sf)" },
  },
  { name: "antigrav", tool: "controls", args: [{ param: "antigrav", from: "onoff" }], desc: { fr: "L'antigravité", en: "Antigravity" } },
  { name: "goaround", tool: "flight_action", fixed: { action: "go_around" }, desc: { fr: "Remise de gaz", en: "Go around" } },
  { name: "undock", tool: "flight_action", fixed: { action: "undock" }, desc: { fr: "Désamarrer", en: "Undock" } },
  {
    name: "release",
    tool: "flight_action",
    fixed: { action: "release" },
    desc: { fr: "Rendre les commandes", en: "Release the controls" },
  },
  { name: "craft", tool: "set_craft", args: [{ param: "vessel" }], desc: { fr: "L'appareil piloté", en: "The craft flown" } },
  {
    name: "ship",
    tool: "set_craft",
    args: [{ param: "ship", from: "onoff" }],
    desc: { fr: "Le vaisseau (on, off)", en: "The ship (on, off)" },
  },
  // navigating
  {
    name: "mission",
    tool: "plan_mission",
    args: [{ param: "target", from: "body" }, { param: "arrival" }, { param: "altKm" }],
    desc: { fr: "Une mission vers un corps, volée", en: "A mission to a body, flown" },
  },
  {
    name: "maneuver",
    tool: "plan_maneuver",
    args: [{ param: "op" }, { param: "altKm" }],
    desc: { fr: "Une manœuvre du calculateur, volée", en: "A flight-computer manoeuvre, flown" },
  },
  { name: "execute", tool: "manage_plan", fixed: { action: "execute" }, desc: { fr: "Exécuter le plan", en: "Execute the plan" } },
  { name: "clearplan", tool: "manage_plan", fixed: { action: "clear" }, desc: { fr: "Effacer le plan", en: "Clear the plan" } },
  // teleporting, time
  {
    name: "teleport",
    tool: "place_ship",
    args: [{ param: "mode" }, { param: "body", from: "place" }, { param: "altKm" }],
    desc: {
      fr: "Téléporter (orbit, ground, near, glide, hover, wormhole) vers un corps ou un site",
      en: "Teleport (orbit, ground, near, glide, hover, wormhole) to a body or a site",
    },
  },
  { name: "warp", tool: "time", args: [{ param: "warp" }], desc: { fr: "Le temps ×N", en: "Time ×N" } },
  { name: "realtime", tool: "time", fixed: { warp: 1 }, desc: { fr: "Temps réel", en: "Real time" } },
  { name: "pause", tool: "time", fixed: { running: false }, desc: { fr: "Pause", en: "Pause" } },
  { name: "resume", tool: "time", fixed: { running: true }, desc: { fr: "Reprendre", en: "Resume" } },
  {
    name: "autowarp",
    tool: "time",
    args: [{ param: "autoWarp", from: "onoff" }],
    desc: { fr: "Le temps géré par le hub", en: "Warp managed by the hub" },
  },
  {
    name: "date",
    tool: "set_date",
    args: [{ param: "date", rest: true }],
    desc: { fr: "Une date (ISO), +N h, ou now", en: "A date (ISO), +N h, or now" },
  },
  // the interface, the sky
  {
    name: "map",
    tool: "interface",
    fixed: { map: true },
    args: [{ param: "mapTab" }],
    desc: { fr: "La carte (orbit, globe, map)", en: "The map (orbit, globe, map)" },
  },
  { name: "closemap", tool: "interface", fixed: { map: false }, desc: { fr: "Fermer la carte", en: "Close the map" } },
  { name: "panel", tool: "interface", args: [{ param: "open" }], desc: { fr: "Ouvrir un panneau", en: "Open a panel" } },
  { name: "close", tool: "interface", fixed: { close: true }, desc: { fr: "Fermer le panneau du dessus", en: "Close the panel on top" } },
  {
    name: "density",
    tool: "interface",
    args: [{ param: "hudDensity" }],
    desc: { fr: "La densité du HUD (0, 1, 2)", en: "The HUD density (0, 1, 2)" },
  },
  { name: "screenshot", tool: "interface", fixed: { screenshot: true }, desc: { fr: "Une capture PNG", en: "A PNG screenshot" } },
  {
    name: "sky",
    tool: "sky",
    args: [{ param: "goTo", from: "sky", rest: true }],
    desc: { fr: "Se tourner vers une constellation, une étoile", en: "Turn to a constellation, a star" },
  },
  {
    name: "constellations",
    tool: "sky",
    args: [{ param: "lines", from: "onoff" }],
    desc: { fr: "Les constellations", en: "The constellations" },
  },
  // saves, scenes, settings, keys
  {
    name: "save",
    tool: "saves",
    fixed: { action: "save" },
    args: [{ param: "name", from: "save", rest: true }],
    desc: { fr: "Sauvegarder", en: "Save" },
  },
  {
    name: "load",
    tool: "saves",
    fixed: { action: "load" },
    args: [{ param: "name", from: "save", rest: true }],
    desc: { fr: "Charger une sauvegarde", en: "Load a save" },
  },
  {
    name: "deletesave",
    tool: "saves",
    fixed: { action: "delete" },
    args: [{ param: "name", from: "save", rest: true }],
    desc: { fr: "Effacer une sauvegarde", en: "Delete a save" },
  },
  {
    name: "scene",
    tool: "start_scene",
    args: [{ param: "name", from: "scene", rest: true }],
    desc: { fr: "Lancer une scène ou une mission", en: "Start a scene or a mission" },
  },
  {
    name: "set",
    tool: "set_settings",
    args: [
      { param: "key", from: "setting" },
      { param: "value", from: "settingValue", rest: true },
    ],
    desc: { fr: "Un réglage = une valeur", en: "A setting = a value" },
  },
  {
    name: "quality",
    tool: "set_settings",
    args: [{ param: "quality" }],
    desc: { fr: "La qualité (low … game)", en: "The quality (low … game)" },
  },
  {
    name: "press",
    tool: "press_key",
    args: [{ param: "id", from: "key" }],
    desc: { fr: "Une action du clavier", en: "A keyboard action" },
  },
  // reading
  {
    name: "places",
    tool: "list_places",
    args: [{ param: "body", from: "body" }],
    desc: { fr: "Les sites et pistes", en: "The sites and runways" },
  },
  { name: "weather", tool: "get_weather", desc: { fr: "La météo ici", en: "The weather here" } },
  {
    name: "weatherat",
    tool: "weather_at",
    args: [{ param: "lat" }, { param: "lon" }, { param: "date" }],
    desc: {
      fr: "La météo réelle d'un lieu à une date : /weatherat 42.5 -2.5 2026-08-12T18:30Z",
      en: "The real weather of a place at a date: /weatherat 42.5 -2.5 2026-08-12T18:30Z",
    },
  },
  { name: "report", tool: "get_flight_report", desc: { fr: "Le dernier rapport de vol", en: "The last flight report" } },
  {
    name: "tool",
    tool: "",
    desc: { fr: "N'importe quel outil de TARS : /tool nom clé=valeur…", en: "Any of TARS's tools: /tool name key=value…" },
  },
];

/** The words of a command line split: quoted strings kept whole. */
export function words(s: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  for (let m = re.exec(s); m; m = re.exec(s)) out.push(m[1] ?? m[2]!);
  return out;
}

const truthy = (v: string) => !/^(off|non|no|0|false|up|haut)$/i.test(v);

/** A word as a parameter's value: a number, a switch, or the text. */
function asValue(p: Param | undefined, v: string, from?: Provider): unknown {
  if (from === "onoff" || from === "updown" || p?.type === "boolean") return truthy(v);
  if (p?.type === "number") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : v;
  }
  return v;
}

/** A game command line read: the tool and its arguments (an error: what is wrong). */
export function gameCall(line: string, tools: ToolSpec[], sites: string[] = []): { tool: string; args: Args } | { error: string } | null {
  const m = /^\/([\w-]+)(?:\s+(.*))?$/s.exec(line.trim());
  if (!m) return null;
  const c = GAME_COMMANDS.find((x) => x.name === m[1]!.toLowerCase());
  if (!c) return null;
  let ws = words(m[2] ?? "");
  let toolName = c.tool;
  if (c.name === "tool") {
    toolName = ws[0] ?? "";
    ws = ws.slice(1);
    if (!toolName) return { error: "/tool <name> key=value…" };
  }
  const spec = tools.find((t) => t.name === toolName);
  if (!spec) return { error: `no tool "${toolName}"` };
  const P = spec.params ?? {};
  const args: Args = { ...(c.fixed ?? {}) };
  const pos = (c.args ?? []).slice();
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]!;
    const kv = /^([A-Za-z]\w*)=(.*)$/s.exec(w);
    if (kv && kv[1]! in P) {
      args[kv[1]!] = asValue(P[kv[1]!], kv[2]!);
      continue;
    }
    const a = pos.shift();
    if (!a) return { error: `too many arguments: "${w}"` };
    const rest = a.rest ? ws.slice(i).join(" ") : w;
    if (a.rest) i = ws.length;
    // (teleport's place: a site's name for the ground, a glide, a hover — else a body)
    if (a.from === "place" && sites.some((s) => s.toLowerCase().includes(rest.toLowerCase()))) {
      const mode = String(args.mode ?? "");
      if (mode === "ground" || mode === "glide" || mode === "hover") {
        args.site = rest;
        continue;
      }
    }
    args[a.param] = asValue(P[a.param], rest, a.from);
  }
  // (/set: its pair as the tool wants it; /date "+N": hours)
  if (toolName === "set_settings" && "key" in args) {
    args.changes = [{ key: String(args.key), value: String(args.value ?? "") }];
    delete args.key;
    delete args.value;
  }
  if (toolName === "set_date" && typeof args.date === "string") {
    const d = args.date.trim();
    if (/^now$/i.test(d)) return { tool: toolName, args: { now: true } };
    const h = /^([+-]\d+(?:\.\d+)?)\s*h?$/i.exec(d);
    if (h) return { tool: toolName, args: { hours: Number(h[1]) } };
  }
  return { tool: toolName, args };
}

const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** A parameter's values: its enum, else its provider's. */
function valuesFor(p: Param | undefined, from: Provider | undefined, ctx: GameCtx, prev: Args): { value: string; hint?: string }[] {
  switch (from) {
    case "body":
      return ctx.bodies;
    case "site":
      return ctx.sites;
    case "place":
      return [...ctx.bodies, ...ctx.sites];
    case "mount":
      return ctx.mounts;
    case "screen":
      return ctx.screens.map((value) => ({ value }));
    case "scene":
      return ctx.scenes.map((value) => ({ value }));
    case "save":
      return ctx.saves.map((value) => ({ value }));
    case "setting":
      return ctx.settings.map((s) => ({ value: s.key, hint: s.label }));
    case "settingValue":
      return (ctx.settings.find((s) => s.key === prev.key)?.values ?? []).map((value) => ({ value }));
    case "sky":
      return ctx.sky.map((value) => ({ value }));
    case "key":
      return ctx.keys;
    case "onoff":
      return [{ value: "on" }, { value: "off" }];
    case "updown":
      return [{ value: "down" }, { value: "up" }];
  }
  if (p?.type === "string" && p.enum) return p.enum.map((value) => ({ value }));
  if (p?.type === "boolean") return [{ value: "true" }, { value: "false" }];
  return [];
}

/** What completes a game command's arguments as typed ("/teleport orbit Lu" → "Lune"). */
export function completeGame(input: string, ctx: GameCtx, max = 12): { text: string; label: string; hint?: string }[] | null {
  const m = /^\/([\w-]+)\s+(.*)$/s.exec(input);
  if (!m) return null;
  const c = GAME_COMMANDS.find((x) => x.name === m[1]!.toLowerCase());
  if (!c) return null;
  const typed = m[2]!;
  const ws = words(typed);
  const ending = /\s$/.test(typed) || typed === "";
  const done = ending ? ws : ws.slice(0, -1);
  const part = ending ? "" : (ws.at(-1) ?? "");
  const head = `/${c.name} ${done.map((w) => (w.includes(" ") ? `"${w}"` : w)).join(" ")}${done.length ? " " : ""}`;
  const pick = (vals: { value: string; hint?: string }[]) =>
    vals
      .filter((v) => fold(v.value).includes(fold(part)) || (v.hint && fold(v.hint).includes(fold(part))))
      .slice(0, max)
      .map((v) => ({ text: `${head}${v.value.includes(" ") ? `"${v.value}"` : v.value} `, label: v.value, hint: v.hint }));
  // (/tool: the tool's name, then its parameters as key=, then a parameter's values)
  if (c.name === "tool") {
    if (!done.length) return pick(ctx.tools.map((t) => ({ value: t.name, hint: t.description.slice(0, 70) })));
    const spec = ctx.tools.find((t) => t.name === done[0]);
    if (!spec) return [];
    const kv = /^([A-Za-z]\w*)=(.*)$/.exec(part);
    if (kv) {
      const vals = valuesFor(spec.params?.[kv[1]!], undefined, ctx, {});
      return vals
        .filter((v) => fold(v.value).includes(fold(kv[2]!)))
        .slice(0, max)
        .map((v) => ({ text: `${head}${kv[1]}=${v.value} `, label: `${kv[1]}=${v.value}` }));
    }
    const used = new Set(done.slice(1).map((w) => w.split("=")[0]));
    return Object.entries(spec.params ?? {})
      .filter(([k]) => !used.has(k) && fold(k).includes(fold(part)))
      .slice(0, max)
      .map(([k, p]) => ({
        text: `${head}${k}=`,
        label: `${k}=`,
        hint: p.description ?? (p.type === "string" && p.enum ? p.enum.join(" · ") : p.type),
      }));
  }
  // (a positional argument's values: the next one's)
  const spec = ctx.tools.find((t) => t.name === c.tool);
  const prev: Args = { ...(c.fixed ?? {}) };
  (c.args ?? []).forEach((a, i) => {
    if (done[i] !== undefined) prev[a.param] = done[i];
  });
  const a = (c.args ?? [])[Math.min(done.length, (c.args ?? []).length - 1)];
  if (!a || (done.length >= (c.args ?? []).length && !a.rest)) return [];
  return pick(valuesFor(spec?.params?.[a.param], a.from, ctx, prev));
}
