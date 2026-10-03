// The interface's language: French for a French browser, English otherwise — or the one chosen and
// kept (kerr.lang). Texts are pairs written where they are used: tr({ fr: "…", en: "…" }).
import { store } from "./util/storage";

export type Lang = "fr" | "en";
export type Text = Record<Lang, string>;

function initial(): Lang {
  const kept = store.get("kerr.lang");
  if (kept === "fr" || kept === "en") return kept;
  const nav = typeof navigator !== "undefined" ? navigator.language : "en";
  return (nav ?? "en").toLowerCase().startsWith("fr") ? "fr" : "en";
}

export let lang: Lang = initial();

/** Chooses the language (kept for the next visits). */
export function setLang(l: Lang) {
  lang = l;
  store.set("kerr.lang", l);
}

/** A text in the interface's language. */
export const tr = (t: Text) => t[lang];
