// The crew console's language (docs/CREW.md): French or English, chosen in the console and kept (kerr.crew.lang) —
// by default the browser's. Its own small module, not the simulator's i18n (its dictionaries would weigh on the
// console's bundle): every text is a pair written where it is used, L("…", "…").
import { store } from "../util/storage";

export type CrewLang = "fr" | "en";

function initial(): CrewLang {
  const kept = store.get("kerr.crew.lang");
  if (kept === "fr" || kept === "en") return kept;
  const nav = typeof navigator !== "undefined" ? navigator.language : "en";
  return (nav ?? "en").toLowerCase().startsWith("fr") ? "fr" : "en";
}

let cur: CrewLang = initial();
if (typeof document !== "undefined") document.documentElement.lang = cur;
const listeners = new Set<(l: CrewLang) => void>();

/** the console's language now */
export const lang = () => cur;
/** the console's language chosen (kept for the next visits): the page says it, the listeners redraw */
export function setLang(l: CrewLang) {
  if (l === cur) return;
  cur = l;
  store.set("kerr.crew.lang", l);
  if (typeof document !== "undefined") document.documentElement.lang = l;
  for (const f of [...listeners]) f(l);
}
export function onLang(f: (l: CrewLang) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
/** a text in the console's language: its French, its English */
export const L = (fr: string, en: string) => (cur === "fr" ? fr : en);
/** a pair (net/crewcmd.ts's acts' words, the checklists') in the console's language */
export const Lp = (t: { fr: string; en: string }) => t[cur];
/** the locale of the figures (1 234,5 or 1,234.5) */
export const locale = () => (cur === "fr" ? "fr-FR" : "en-GB");
