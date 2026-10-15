// TARS's aviation knowledge (docs/PLAN-AVIATION-AAA.md, I1): the pages written for him (docs/aviation/en, fr — the
// F-35's systems and limits, basic flying, energy, the dogfight, formation flying, the carrier, the ILS, the
// emergencies, the radar, the weapons, the traffic), cut into their sections, searched by their words (accents and
// case aside, the rarer words weighing more, a section's title thrice, a word's start enough) and read. Bundled with
// the game: no request.

import en_basics from "../../docs/aviation/en/basics.md" with { type: "text" };
import en_bfm from "../../docs/aviation/en/bfm.md" with { type: "text" };
import en_carrier from "../../docs/aviation/en/carrier.md" with { type: "text" };
import en_emergencies from "../../docs/aviation/en/emergencies.md" with { type: "text" };
import en_energy from "../../docs/aviation/en/energy.md" with { type: "text" };
import en_f35 from "../../docs/aviation/en/f35.md" with { type: "text" };
import en_formation from "../../docs/aviation/en/formation.md" with { type: "text" };
import en_ils from "../../docs/aviation/en/ils.md" with { type: "text" };
import en_radar from "../../docs/aviation/en/radar.md" with { type: "text" };
import en_traffic from "../../docs/aviation/en/traffic.md" with { type: "text" };
import en_weapons from "../../docs/aviation/en/weapons.md" with { type: "text" };
import fr_basics from "../../docs/aviation/fr/basics.md" with { type: "text" };
import fr_bfm from "../../docs/aviation/fr/bfm.md" with { type: "text" };
import fr_carrier from "../../docs/aviation/fr/carrier.md" with { type: "text" };
import fr_emergencies from "../../docs/aviation/fr/emergencies.md" with { type: "text" };
import fr_energy from "../../docs/aviation/fr/energy.md" with { type: "text" };
import fr_f35 from "../../docs/aviation/fr/f35.md" with { type: "text" };
import fr_formation from "../../docs/aviation/fr/formation.md" with { type: "text" };
import fr_ils from "../../docs/aviation/fr/ils.md" with { type: "text" };
import fr_radar from "../../docs/aviation/fr/radar.md" with { type: "text" };
import fr_traffic from "../../docs/aviation/fr/traffic.md" with { type: "text" };
import fr_weapons from "../../docs/aviation/fr/weapons.md" with { type: "text" };

export type KnowledgeLang = "en" | "fr";
export const KNOWLEDGE_PAGES = [
  "f35",
  "basics",
  "energy",
  "bfm",
  "formation",
  "carrier",
  "ils",
  "emergencies",
  "radar",
  "weapons",
  "traffic",
] as const;
export type KnowledgePage = (typeof KNOWLEDGE_PAGES)[number];

const PAGES: Record<KnowledgeLang, Record<KnowledgePage, string>> = {
  en: {
    f35: en_f35,
    basics: en_basics,
    energy: en_energy,
    bfm: en_bfm,
    formation: en_formation,
    carrier: en_carrier,
    ils: en_ils,
    emergencies: en_emergencies,
    radar: en_radar,
    weapons: en_weapons,
    traffic: en_traffic,
  },
  fr: {
    f35: fr_f35,
    basics: fr_basics,
    energy: fr_energy,
    bfm: fr_bfm,
    formation: fr_formation,
    carrier: fr_carrier,
    ils: fr_ils,
    emergencies: fr_emergencies,
    radar: fr_radar,
    weapons: fr_weapons,
    traffic: fr_traffic,
  },
};

/** A section of a page: its page, its language, its title (the page's own for its opening), its text. */
export interface KnowledgeSection {
  page: KnowledgePage;
  lang: KnowledgeLang;
  title: string;
  text: string;
}

/** A word as it is compared: lower case, its accents dropped. */
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const WORDS = /[a-z0-9]+(?:-[a-z0-9]+)*/g;
/** the words too common to count (English, French) */
const STOP = new Set(
  "the a an of to in on at by for and or is are be it its with as from that this then than out up how what which when de la le les des du un une et ou au aux en sur par pour dans est sont que qui se sa son ses il elle on ne pas plus quel quelle comment".split(
    " ",
  ),
);
const words = (s: string) => (fold(s).match(WORDS) ?? []).filter((w) => w.length > 1 && !STOP.has(w));

let index: { S: KnowledgeSection[]; tf: Map<string, number>[]; df: Map<string, number> } | null = null;
function build() {
  const S: KnowledgeSection[] = [];
  for (const lang of ["en", "fr"] as const)
    for (const page of KNOWLEDGE_PAGES) {
      const md = PAGES[lang][page];
      const top = /^# (.+)$/m.exec(md)?.[1] ?? page;
      const parts = md.split(/^## /m);
      S.push({ page, lang, title: top, text: parts[0]!.replace(/^# .+$/m, "").trim() });
      for (const p of parts.slice(1)) {
        const nl = p.indexOf("\n");
        S.push({ page, lang, title: `${top} — ${p.slice(0, nl).trim()}`, text: p.slice(nl + 1).trim() });
      }
    }
  const tf = S.map((s) => {
    const m = new Map<string, number>();
    for (const w of words(s.text)) m.set(w, (m.get(w) ?? 0) + 1);
    for (const w of words(s.title)) m.set(w, (m.get(w) ?? 0) + 3);
    return m;
  });
  const df = new Map<string, number>();
  for (const m of tf) for (const w of m.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  index = { S, tf, df };
  return index;
}

/** The sections that answer a question best (its language's first, the other's if none), their score. */
export function searchKnowledge(q: string, lang: KnowledgeLang = "en", n = 4): (KnowledgeSection & { score: number })[] {
  const I = index ?? build();
  const qs = [...new Set(words(q))];
  const N = I.S.length;
  const scored = I.S.map((s, i) => {
    let score = 0;
    for (const w of qs) {
      let f = I.tf[i]!.get(w) ?? 0;
      // (a word's start is enough: "appont" finds "appontage", "missiles" finds "missile")
      if (!f && w.length > 4) for (const [k, c] of I.tf[i]!) if (k.length > 4 && (k.startsWith(w) || w.startsWith(k))) f += c * 0.7;
      if (f) score += (1 + Math.log(f)) * Math.log(1 + N / (I.df.get(w) ?? 1));
    }
    return { ...s, score };
  }).filter((s) => s.score > 0);
  const mine = scored.filter((s) => s.lang === lang);
  return (mine.length ? mine : scored).sort((a, b) => b.score - a.score).slice(0, n);
}

/** A page read whole, or one of its sections (by a word of its title). */
export function readKnowledge(page: KnowledgePage, lang: KnowledgeLang = "en", section?: string): string | null {
  const md = PAGES[lang]?.[page];
  if (!md) return null;
  if (!section) return md;
  const I = index ?? build();
  const want = fold(section);
  const s = I.S.find((x) => x.page === page && x.lang === lang && fold(x.title).includes(want));
  return s ? `## ${s.title}\n${s.text}` : md;
}
