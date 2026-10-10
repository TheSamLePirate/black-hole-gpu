// Deepgram's Aura-2 voices TARS and the radio may speak with (PLAN-TARS: his voice, to choose): the French and
// English ones, as Deepgram's model list gave them on 10 October 2026 (its REST list is closed to a page by
// CORS: kept here). g: masculine, feminine; words: how Deepgram describes it.

export interface AuraVoice {
  id: string;
  name: string;
  lang: "fr" | "en";
  g: "m" | "f" | "n";
  words: string[];
}

export const AURA_VOICES: AuraVoice[] = [
  { id: "aura-2-amalthea-en", name: "Amalthea", lang: "en", g: "f", words: ["engaging", "natural", "cheerful"] },
  { id: "aura-2-andromeda-en", name: "Andromeda", lang: "en", g: "f", words: ["casual", "expressive", "comfortable"] },
  { id: "aura-2-apollo-en", name: "Apollo", lang: "en", g: "m", words: ["confident", "comfortable", "casual"] },
  { id: "aura-2-arcas-en", name: "Arcas", lang: "en", g: "m", words: ["natural", "smooth", "clear"] },
  { id: "aura-2-aries-en", name: "Aries", lang: "en", g: "m", words: ["warm", "energetic", "caring"] },
  { id: "aura-2-asteria-en", name: "Asteria", lang: "en", g: "f", words: ["clear", "confident", "knowledgeable"] },
  { id: "aura-2-athena-en", name: "Athena", lang: "en", g: "f", words: ["calm", "smooth", "professional"] },
  { id: "aura-2-atlas-en", name: "Atlas", lang: "en", g: "m", words: ["enthusiastic", "confident", "approachable"] },
  { id: "aura-2-aurora-en", name: "Aurora", lang: "en", g: "f", words: ["cheerful", "expressive", "energetic"] },
  { id: "aura-2-callista-en", name: "Callista", lang: "en", g: "f", words: ["clear", "energetic", "professional"] },
  { id: "aura-2-cora-en", name: "Cora", lang: "en", g: "f", words: ["smooth", "melodic", "caring"] },
  { id: "aura-2-cordelia-en", name: "Cordelia", lang: "en", g: "f", words: ["approachable", "warm", "polite"] },
  { id: "aura-2-delia-en", name: "Delia", lang: "en", g: "f", words: ["casual", "friendly", "cheerful"] },
  { id: "aura-2-draco-en", name: "Draco", lang: "en", g: "m", words: ["warm", "approachable", "trustworthy"] },
  { id: "aura-2-electra-en", name: "Electra", lang: "en", g: "f", words: ["professional", "engaging", "knowledgeable"] },
  { id: "aura-2-harmonia-en", name: "Harmonia", lang: "en", g: "f", words: ["empathetic", "clear", "calm"] },
  { id: "aura-2-helena-en", name: "Helena", lang: "en", g: "f", words: ["caring", "natural", "positive"] },
  { id: "aura-2-hera-en", name: "Hera", lang: "en", g: "f", words: ["smooth", "warm", "professional"] },
  { id: "aura-2-hermes-en", name: "Hermes", lang: "en", g: "m", words: ["expressive", "engaging", "professional"] },
  { id: "aura-2-hyperion-en", name: "Hyperion", lang: "en", g: "m", words: ["caring", "warm", "empathetic"] },
  { id: "aura-2-iris-en", name: "Iris", lang: "en", g: "f", words: ["cheerful", "positive", "approachable"] },
  { id: "aura-2-janus-en", name: "Janus", lang: "en", g: "f", words: ["southern", "smooth", "trustworthy"] },
  { id: "aura-2-juno-en", name: "Juno", lang: "en", g: "f", words: ["natural", "engaging", "melodic"] },
  { id: "aura-2-jupiter-en", name: "Jupiter", lang: "en", g: "m", words: ["expressive", "knowledgeable", "baritone"] },
  { id: "aura-2-luna-en", name: "Luna", lang: "en", g: "f", words: ["friendly", "natural", "engaging"] },
  { id: "aura-2-mars-en", name: "Mars", lang: "en", g: "m", words: ["smooth", "patient", "trustworthy"] },
  { id: "aura-2-minerva-en", name: "Minerva", lang: "en", g: "f", words: ["positive", "friendly", "natural"] },
  { id: "aura-2-neptune-en", name: "Neptune", lang: "en", g: "m", words: ["professional", "patient", "polite"] },
  { id: "aura-2-odysseus-en", name: "Odysseus", lang: "en", g: "m", words: ["calm", "smooth", "comfortable"] },
  { id: "aura-2-ophelia-en", name: "Ophelia", lang: "en", g: "f", words: ["expressive", "enthusiastic", "cheerful"] },
  { id: "aura-2-orion-en", name: "Orion", lang: "en", g: "m", words: ["approachable", "comfortable", "calm"] },
  { id: "aura-2-orpheus-en", name: "Orpheus", lang: "en", g: "m", words: ["professional", "clear", "confident"] },
  { id: "aura-2-pandora-en", name: "Pandora", lang: "en", g: "f", words: ["smooth", "calm", "melodic"] },
  { id: "aura-2-phoebe-en", name: "Phoebe", lang: "en", g: "f", words: ["energetic", "warm", "casual"] },
  { id: "aura-2-pluto-en", name: "Pluto", lang: "en", g: "m", words: ["smooth", "calm", "empathetic"] },
  { id: "aura-2-saturn-en", name: "Saturn", lang: "en", g: "m", words: ["knowledgeable", "confident", "baritone"] },
  { id: "aura-2-selene-en", name: "Selene", lang: "en", g: "f", words: ["expressive", "engaging", "energetic"] },
  { id: "aura-2-thalia-en", name: "Thalia", lang: "en", g: "f", words: ["clear", "confident", "energetic"] },
  { id: "aura-2-theia-en", name: "Theia", lang: "en", g: "f", words: ["expressive", "polite", "sincere"] },
  { id: "aura-2-vesta-en", name: "Vesta", lang: "en", g: "f", words: ["natural", "expressive", "patient"] },
  { id: "aura-2-zeus-en", name: "Zeus", lang: "en", g: "m", words: ["deep", "trustworthy", "smooth"] },
  { id: "aura-2-agathe-fr", name: "Agathe", lang: "fr", g: "f", words: ["charismatic", "cheerful", "enthusiastic"] },
  { id: "aura-2-hector-fr", name: "Hector", lang: "fr", g: "m", words: ["confident", "empathetic", "expressive"] },
];
