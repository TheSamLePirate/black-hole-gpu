// TARS's orders without a model (PLAN-TARS-AGENT A4): offline, without a key, the common orders understood in
// French or English — the autopilots (land, at a site; take off; circularize; dock; off), the target, the
// gear, the time (a warp, real time, pause, run), the views, the map, a quick save, undo, a teleport into
// orbit, forget everything — and turned into the same tools' calls the agent makes. Pure: words in, calls
// out (none: not an order — his written answers then).

import type { Args } from "./tool-schema";

export interface Order {
  tool: string;
  args: Args;
}

const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, " ").replace(/\s+/g, " ").trim();

/** the name after a word ("vise Mars", "land at Edwards"): the rest of the clause */
const after = (q: string, re: RegExp) => {
  const m = re.exec(q);
  return m
    ? q
        .slice(m.index + m[0].length)
        .split(/\s*(?:,|;|\bpuis\b|\bet\b|\bthen\b|\band\b|\.|!|\?)\s*/)[0]!
        .trim()
    : "";
};

const MOUNT_WORDS: [RegExp, string][] = [
  [/\bcockpit\b/, "cockpit"],
  [/\b(cabine|cabin)\b/, "cabin"],
  [/\b(poursuite|chase|exterieure?|outside)\b/, "chase"],
  [/\b(trois[- ]quarts?|quarter)\b/, "quarter"],
  [/\b(autour|around)\b/, "around"],
  [/\b(libre|free)\b/, "free"],
];

/** The calls an order asks for, in their order (empty: not an order). */
export function parseOrders(text: string): Order[] {
  const q = fold(text);
  const out: Order[] = [];
  const add = (tool: string, args: Args = {}) => out.push({ tool, args });

  if (/\b(oublie tout|efface ta memoire|forget (it all|everything)|clear your memory)\b/.test(q)) add("memory", { action: "clear" });
  if (/\b(annule|undo)\b/.test(q) && !/autopilot/.test(q)) add("saves", { action: "undo" });
  if (/\b(sauvegarde|quick ?save|save the game|save game)\b/.test(q)) add("saves", { action: "save", name: "Quick save" });

  // (the target before what may use it)
  const tgt = after(q, /\b(vise|cible|target|pointe vers|aim at)\s+(la |le |l |les )?/);
  if (tgt) add("set_target", { name: tgt });

  // (a teleport into orbit: "téléporte-nous en orbite (de 100 km) autour de la Lune")
  if (
    /\b(teleporte|teleport|place|mets?)[- ]?(nous|moi|us|le vaisseau|the ship)?\b.*\borbite?\b/.test(q) &&
    /\b(autour d[eu]|de la|around|about)\b/.test(q)
  ) {
    const body = after(q, /\b(autour d[eu]|autour de la|around|about)\s+(la |le |l |the )?/);
    const km = /(\d+(?:[.,]\d+)?)\s*km/.exec(q);
    if (body) add("place_ship", { mode: "orbit", body, ...(km ? { altKm: Number(km[1]!.replace(",", ".")) } : {}) });
  }

  // the autopilots
  if (/\b(coupe|desengage|eteins|arrete) (l |le )?(autopilote|pilote auto)|\bautopilot off\b|\bdisengage\b/.test(q))
    add("autopilot", { mode: "none" });
  else if (/\b(atterris|atterrir|pose[- ]?(nous|toi|le)|land( us)?|touch down)\b/.test(q)) {
    const site = after(q, /\b(a|au|sur|at|on)\s+(l |la |le )?(?=[a-z])/);
    add("autopilot", site ? { mode: "entry", site } : { mode: "land" });
  } else if (/\b(decolle|decollage|take ?off|lift ?off|launch)\b/.test(q)) {
    const km = /(\d+)\s*km/.exec(q);
    add("autopilot", { mode: "takeoff", ...(km ? { altKm: Number(km[1]) } : {}) });
  } else if (/\b(circularise|circularize)\b/.test(q)) add("autopilot", { mode: "circularize" });
  else if (/\b(amarre|arrime|dock)\b/.test(q) && !/\b(desamarre|undock)\b/.test(q)) add("autopilot", { mode: "dock" });
  else if (/\b(stationnaire|hover|tiens la position|hold position)\b/.test(q)) add("autopilot", { mode: "hover" });
  if (/\b(desamarre|undock)\b/.test(q)) add("flight_action", { action: "undock" });
  if (/\b(remise de gaz|go[- ]around)\b/.test(q)) add("flight_action", { action: "go_around" });

  // the gear
  if (/\b(sors|baisse|descends?) (le )?train\b|\bgear down\b|\btrain (sorti|bas)\b/.test(q)) add("controls", { gear: true });
  else if (/\b(rentre|remonte|leve) (le )?train\b|\bgear up\b/.test(q)) add("controls", { gear: false });

  // the time
  const warp =
    /\b(?:warp|x|fois|acceler\w* (?:le temps )?(?:a|de)?|temps (?:a|x))\s*[x×]?\s*(\d[\d\s]*)\b|\b(\d[\d\s]*)\s*(?:fois|x)\b/.exec(q);
  if (/\b(temps reel|real ?time)\b/.test(q)) add("time", { warp: 1 });
  else if (warp && /\b(temps|warp|acceler|time|fois)\b/.test(q))
    add("time", { warp: Math.min(1e6, Math.max(1, Number((warp[1] ?? warp[2])!.replace(/\s/g, "")))) });
  if (/\b(pause|mets en pause|fige le temps)\b/.test(q)) add("time", { running: false });
  else if (/\b(reprends|relance le temps|resume|unpause)\b/.test(q)) add("time", { running: true });

  // the views, the map
  if (/\b(vue|view|camera)\b/.test(q)) for (const [re, m] of MOUNT_WORDS) if (re.test(q)) add("camera", { mount: m }), void 0;
  if (/\b(ouvre|montre|affiche|open|show)\b.*\b(carte|map)\b/.test(q)) add("interface", { map: true });
  else if (/\b(ferme|cache|close|hide)\b.*\b(carte|map)\b/.test(q)) add("interface", { map: false });
  return out.filter((o, i) => out.findIndex((x) => x.tool === o.tool && JSON.stringify(x.args) === JSON.stringify(o.args)) === i);
}

/** His word once an order is done: short, in the language, the failures named. */
export function orderReply(lang: "fr" | "en", done: { tool: string; ok: boolean; error?: string }[]): string {
  const bad = done.filter((d) => !d.ok);
  if (!bad.length) return lang === "fr" ? (done.length > 1 ? "C'est fait, tout." : "C'est fait.") : done.length > 1 ? "All done." : "Done.";
  const why = bad.map((d) => d.error ?? d.tool).join(" ; ");
  return lang === "fr" ? `Pas pu : ${why}.` : `Couldn't: ${why}.`;
}
