// The interface's language: French for a French browser, English otherwise — or the one chosen and
// kept (kerr.lang). Texts are pairs written where they are used: tr({ fr: "…", en: "…" }).
import { store } from "./util/storage";
import frBodies from "./i18n/fr-bodies";
import frFc from "./i18n/fr-fc";
import frHud from "./i18n/fr-hud";
import frPlace from "./i18n/fr-place";
import frAssist from "./i18n/fr-assist";
import frPwa from "./i18n/fr-pwa";
import frMain from "./i18n/fr-main";
import frSettings from "./i18n/fr-settings";
import frCockpit from "./i18n/fr-cockpit";
import frTars from "./i18n/fr-tars";
import frVoices from "./i18n/fr-voices";
import frModes from "./i18n/fr-modes";
import frRoute from "./i18n/fr-route";
import frNet from "./i18n/fr-net";
import frAero from "./i18n/fr-aero";
import frRadar from "./i18n/fr-radar";
import frFlight from "./i18n/fr-flight";
import frMission from "./i18n/fr-mission";
import frProcedures from "./i18n/fr-procedures";
import frAar from "./i18n/fr-aar";
import frInstructor from "./i18n/fr-instructor";
import frCopilot from "./i18n/fr-copilot";
import frCourse from "./i18n/fr-course";
import frRadio from "./i18n/fr-radio";
import frViews from "./i18n/fr-views";
import frJetpad from "./i18n/fr-jetpad";
import frReplay from "./i18n/fr-replay";
import frNetSpace from "./i18n/fr-netspace";
import frSpaceMissions from "./i18n/fr-spacemissions";
import frSpaceSchool from "./i18n/fr-spaceschool";

export type Lang = "fr" | "en";
export type Text = Record<Lang, string>;

function initial(): Lang {
  const kept = store.get("kerr.lang");
  if (kept === "fr" || kept === "en") return kept;
  const nav = typeof navigator !== "undefined" ? navigator.language : "en";
  return (nav ?? "en").toLowerCase().startsWith("fr") ? "fr" : "en";
}

export let lang: Lang = initial();
// (the page says its language: screen readers, hyphenation, the browser's translation offer)
if (typeof document !== "undefined") document.documentElement.lang = lang;

const langListeners = new Set<(l: Lang) => void>();

/** Chooses the language (kept for the next visits): the page says it, the menus listening redraw themselves
 *  (PLAN-TITRE-AAA E9b — what was built before in the other language follows at the next load). */
export function setLang(l: Lang) {
  if (l === lang) return;
  lang = l;
  store.set("kerr.lang", l);
  if (typeof document !== "undefined") document.documentElement.lang = l;
  for (const f of [...langListeners]) f(l);
}

/** Told when the language changes (a menu redrawing itself); the unsubscription returned. */
export function onLangChange(f: (l: Lang) => void): () => void {
  langListeners.add(f);
  return () => langListeners.delete(f);
}

/** A text in the interface's language. */
export const tr = (t: Text) => t[lang];

// ------------------------------------------------------------------------------------ the dictionary
// The interface's long-standing English texts (the settings, the help, the messages) are translated in
// dictionaries keyed by the English (src/i18n/*.ts): t("…") gives the French where there is one, the
// English otherwise — a text not yet translated still shows, in English.

const FR = new Map<string, string>();
/** The French dictionary (read by the tests). */
export const FRENCH: ReadonlyMap<string, string> = FR;

/** Adds French for English texts. */
export function addFrench(d: Record<string, string>) {
  for (const [k, v] of Object.entries(d)) FR.set(k, v);
}

/** An English text of the interface, in its language. */
export const t = (en: string) => (lang === "fr" ? (FR.get(en) ?? en) : en);

/** With values: {0}, {1}… in the English and in its translation. */
export const tf = (en: string, ...v: (string | number)[]) => t(en).replace(/\{(\d)\}/g, (_, i: string) => String(v[Number(i)]));

/** Is there French for it (the tests: what is left to translate). */
export const hasFrench = (en: string) => FR.has(en);

addFrench(frSettings);
addFrench(frSpaceSchool);
addFrench(frSpaceMissions);
addFrench(frNetSpace);
addFrench(frCockpit);
addFrench(frTars);
addFrench(frVoices);
addFrench(frModes);
addFrench(frRoute);
addFrench(frNet);
addFrench(frAero);
addFrench(frRadar);
addFrench(frFlight);
addFrench(frMission);
addFrench(frProcedures);
addFrench(frAar);
addFrench(frInstructor);
addFrench(frCopilot);
addFrench(frCourse);
addFrench(frRadio);
addFrench(frViews);
addFrench(frJetpad);
addFrench(frReplay);
addFrench(frMain);
addFrench(frHud);
addFrench(frPlace);
addFrench(frAssist);
addFrench(frPwa);
addFrench(frFc);
addFrench(frBodies);
