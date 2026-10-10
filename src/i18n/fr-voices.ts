// The Deepgram voices' names and manners in French (the settings' choices of TARS's and the radio's voices):
// built from the catalogue (audio/aura-voices.ts), Deepgram's words translated one by one.

import { AURA_VOICES } from "../audio/aura-voices";

const WORDS: Record<string, string> = {
  engaging: "engageante",
  natural: "naturelle",
  cheerful: "enjouée",
  casual: "décontractée",
  expressive: "expressive",
  comfortable: "à l'aise",
  confident: "assurée",
  smooth: "douce",
  clear: "claire",
  warm: "chaleureuse",
  energetic: "énergique",
  caring: "attentionnée",
  knowledgeable: "savante",
  calm: "calme",
  professional: "professionnelle",
  enthusiastic: "enthousiaste",
  approachable: "accessible",
  melodic: "mélodieuse",
  polite: "polie",
  friendly: "amicale",
  trustworthy: "digne de confiance",
  empathetic: "empathique",
  positive: "positive",
  southern: "du Sud",
  baritone: "baryton",
  patient: "patiente",
  sincere: "sincère",
  deep: "grave",
  charismatic: "charismatique",
};

/** The English of a voice's hint, as the schema makes it, and its French. */
export function voiceHint(g: "m" | "f" | "n", words: string[], fr: boolean): string {
  const gender = fr ? (g === "m" ? "masculine" : g === "f" ? "féminine" : "") : g === "m" ? "masculine" : g === "f" ? "feminine" : "";
  const w = fr ? words.map((x) => WORDS[x] ?? x) : words;
  return `${gender}${w.length ? ` · ${w.join(", ")}` : ""}`;
}

const frVoices: Record<string, string> = {};
for (const v of AURA_VOICES) {
  // (a name that is a body's — Pluto, Saturn — keeps the body's French: Pluton, Saturne)
  if (!["Pluto", "Saturn"].includes(v.name)) frVoices[v.name] = v.name;
  frVoices[voiceHint(v.g, v.words, false)] = voiceHint(v.g, v.words, true);
}
export default frVoices;
