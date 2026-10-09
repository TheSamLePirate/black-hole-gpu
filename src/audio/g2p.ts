// Text to phonemes for TARS's robot voice (PLAN-TARS T5a), in English — the words a robot says as it would
// read them: numbers written out, the most frequent and the game's own words from a small dictionary, the rest
// by letter rules with their contexts (after the Naval Research Laboratory's public ones). Pure; audio/formant.ts
// says the phonemes. (In French TARS speaks with the system's voice — the owner's choice, 09/10/2026: a home-made
// French was measured not understood, 76–87 % of its words lost to a transcriber against 11 % for the system's.)
//
// Phonemes (ASCII): vowels i I e E ae a A O o U u V @ 3, the diphthongs aI eI oU aU OI; consonants p b t d k g f
// v s z S Z T D h m n N l r w j tS dZ; "|" a word's end, "," a short pause, "." a long one. A stressed vowel is
// followed by "'".

const VOWELS = new Set(["i", "I", "e", "E", "ae", "a", "A", "O", "o", "U", "u", "V", "@", "3", "aI", "eI", "oU", "aU", "OI"]);
export const isVowel = (p: string) => VOWELS.has(p.replace("'", ""));

// ------------------------------------------------------------------------------------ numbers
const EN_UNITS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function enInt(n: number): string {
  if (n < 20) return EN_UNITS[n]!;
  if (n < 100) return EN_TENS[Math.floor(n / 10)]! + (n % 10 ? ` ${EN_UNITS[n % 10]}` : "");
  if (n < 1000) return `${EN_UNITS[Math.floor(n / 100)]} hundred${n % 100 ? ` ${enInt(n % 100)}` : ""}`;
  if (n < 1e6) return `${enInt(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${enInt(n % 1000)}` : ""}`;
  if (n < 1e9) return `${enInt(Math.floor(n / 1e6))} million${n % 1e6 ? ` ${enInt(n % 1e6)}` : ""}`;
  return `${enInt(Math.floor(n / 1e9))} billion${n % 1e9 ? ` ${enInt(n % 1e9)}` : ""}`;
}

/** A number written out ("3.5" → "three point five", "-12" → "minus twelve"). */
export function numberWords(s: string): string {
  const neg = s.startsWith("-") || s.startsWith("−");
  const body = s.replace(/^[-−]/, "").replace(/[\s\u00a0\u202f]/g, "");
  const [i, d] = body.split(".");
  const int = Number(i);
  if (!Number.isFinite(int)) return s;
  let out = enInt(int);
  if (d)
    out += ` point ${d
      .split("")
      .map((x) => enInt(Number(x)))
      .join(" ")}`;
  return (neg ? "minus " : "") + out;
}

/** The text made speakable: numbers (their grouping, their decimals), percents, units, symbols. */
export function normalize(text: string): string {
  return text
    .replace(/(\d)[,\u00a0\u202f ](?=\d{3}\b)/g, "$1")
    .replace(/%/g, " percent")
    .replace(/\bkm\/s\b/g, "kilometres per second")
    .replace(/\bm\/s\b/g, "metres per second")
    .replace(/\bkm\b/g, "kilometres")
    .replace(/(\d)\s?m\b/g, "$1 metres")
    .replace(/(\d)\s?s\b/g, "$1 seconds")
    .replace(/&/g, " and ")
    .replace(/[·—–]/g, ",")
    .replace(/[-−]?\d+(?:\.\d+)?/g, (m) => ` ${numberWords(m)} `);
}

// ------------------------------------------------------------------------------------ English
const EN_DICT: Record<string, string> = {
  a: "@",
  an: "@ n",
  the: "D @",
  and: "ae' n d",
  of: "@ v",
  to: "t u",
  you: "j u'",
  your: "j O' r",
  is: "I' z",
  are: "A' r",
  was: "w A' z",
  were: "w 3'",
  have: "h ae' v",
  has: "h ae' z",
  had: "h ae' d",
  do: "d u'",
  does: "d V' z",
  done: "d V' n",
  one: "w V' n",
  two: "t u'",
  four: "f O' r",
  three: "T r i'",
  five: "f aI' v",
  six: "s I' k s",
  seven: "s E' v @ n",
  eight: "eI' t",
  nine: "n aI' n",
  ten: "t E' n",
  thirteen: "T 3 t i' n",
  fifteen: "f I f t i' n",
  twenty: "t w E' n t i",
  thirty: "T 3' t i",
  forty: "f O' r t i",
  fifty: "f I' f t i",
  sixty: "s I' k s t i",
  seventy: "s E' v @ n t i",
  eighty: "eI' t i",
  ninety: "n aI' n t i",
  yes: "j E' s",
  us: "V' s",
  gas: "g ae' s",
  bus: "b V' s",
  plus: "p l V' s",
  move: "m u' v",
  enough: "@ n V' f",
  ahead: "@ h E' d",
  control: "k @ n t r oU' l",
  controls: "k @ n t r oU' l z",
  about: "@ b aU' t",
  around: "@ r aU' n d",
  moving: "m u' v I N",
  slowly: "s l oU' l i",
  eleven: "I l E' v @ n",
  twelve: "t w E' l v",
  hundred: "h V' n d r @ d",
  thousand: "T aU' z @ n d",
  million: "m I' l j @ n",
  billion: "b I' l j @ n",
  zero: "z I' r oU",
  what: "w V' t",
  where: "w E' r",
  who: "h u'",
  why: "w aI'",
  how: "h aU'",
  there: "D E' r",
  their: "D E' r",
  "there's": "D E' r z",
  they: "D eI'",
  them: "D E' m",
  then: "D E' n",
  than: "D ae' n",
  this: "D I' s",
  that: "D ae' t",
  these: "D i' z",
  those: "D oU' z",
  though: "D oU'",
  with: "w I' D",
  from: "f r V' m",
  into: "I' n t u",
  been: "b I' n",
  be: "b i'",
  he: "h i'",
  she: "S i'",
  we: "w i'",
  me: "m i'",
  my: "m aI'",
  by: "b aI'",
  i: "aI'",
  "i'm": "aI' m",
  "it's": "I' t s",
  "don't": "d oU' n t",
  "can't": "k ae' n t",
  "won't": "w oU' n t",
  "isn't": "I' z @ n t",
  "you're": "j U' r",
  "we're": "w I' r",
  "that's": "D ae' t s",
  "let's": "l E' t s",
  ok: "oU k eI'",
  okay: "oU k eI'",
  tars: "t A' r z",
  case: "k eI' s",
  cooper: "k u' p 3",
  brand: "b r ae' n d",
  houston: "h j u' s t @ n",
  ranger: "r eI' n dZ 3",
  lander: "l ae' n d 3",
  endurance: "E' n d j U r @ n s",
  gargantua: "g A r g ae' n tS u @",
  miller: "m I' l 3",
  mann: "m ae' n",
  edmunds: "E' d m @ n d z",
  earth: "3' T",
  moon: "m u' n",
  mars: "m A' r z",
  jupiter: "dZ u' p I t 3",
  saturn: "s ae' t 3 n",
  fuel: "f j u' @ l",
  orbit: "O' r b I t",
  honesty: "A' n @ s t i",
  humor: "h j u' m 3",
  humour: "h j u' m 3",
  percent: "p 3 s E' n t",
  kilometres: "k I l A' m @ t 3 z",
  kilometers: "k I l A' m @ t 3 z",
  metres: "m i' t 3 z",
  meters: "m i' t 3 z",
  seconds: "s E' k @ n d z",
  minutes: "m I' n I t s",
  hours: "aU' 3 z",
  people: "p i' p @ l",
  water: "w O' t 3",
  great: "g r eI' t",
  said: "s E' d",
  says: "s E' z",
  here: "h I' r",
  know: "n oU'",
  would: "w U' d",
  could: "k U' d",
  should: "S U' d",
  put: "p U' t",
  full: "f U' l",
  pull: "p U' l",
  push: "p U' S",
  good: "g U' d",
  again: "@ g E' n",
  any: "E' n i",
  many: "m E' n i",
  only: "oU' n l i",
  also: "O' l s oU",
  other: "V' D 3",
  another: "@ n V' D 3",
  nothing: "n V' T I N",
  something: "s V' m T I N",
  some: "s V' m",
  come: "k V' m",
  love: "l V' v",
  above: "@ b V' v",
  give: "g I' v",
  live: "l I' v",
  gone: "g O' n",
  get: "g E' t",
  girl: "g 3' l",
  over: "oU' v 3",
  never: "n E' v 3",
  ever: "E' v 3",
  very: "v E' r i",
  every: "E' v r i",
  eye: "aI'",
  idea: "aI d i' @",
  data: "d eI' t @",
  gravity: "g r ae' v I t i",
  relativity: "r E l @ t I' v I t i",
  black: "b l ae' k",
  hole: "h oU' l",
  time: "t aI' m",
  space: "s p eI' s",
  landing: "l ae' n d I N",
  runway: "r V' n w eI",
  engine: "E' n dZ I n",
  course: "k O' r s",
  sure: "S U' r",
  true: "t r u'",
  false: "f O' l s",
  sir: "s 3'",
  copy: "k A' p i",
  roger: "r A' dZ 3",
  setting: "s E' t I N",
  settings: "s E' t I N z",
  probably: "p r A' b @ b l i",
  absolutely: "ae b s @ l u' t l i",
  minus: "m aI' n @ s",
  point: "p OI' n t",
  per: "p 3",
  second: "s E' k @ n d",
  minute: "m I' n I t",
  hour: "aU' 3",
  day: "d eI'",
  days: "d eI' z",
  year: "j I' r",
  years: "j I' r z",
  wormhole: "w 3' m h oU l",
  planet: "p l ae' n @ t",
  speed: "s p i' d",
  altitude: "ae' l t I t u d",
  target: "t A' r g I t",
  autopilot: "O' t oU p aI l @ t",
  pilot: "p aI' l @ t",
  of_course: "@ v k O' r s",
};

/** English letter rules: [left context (regex, tested at the end of what precedes), letters, right context
 *  (regex, tested at the start of what follows), phonemes]. Words padded with spaces; first match wins. */
type Rule = [RegExp | null, string, RegExp | null, string];
const EV = "[aeiouy]",
  EC = "[bcdfghjklmnpqrstvwxz]";
const R = (l: string | null, m: string, r: string | null, p: string): Rule => [
  l ? new RegExp(`${l}$`) : null,
  m,
  r ? new RegExp(`^${r}`) : null,
  p,
];

const EN_RULES: Record<string, Rule[]> = {
  a: [
    R(" ", "a", " ", "@"),
    R(" ", "a", "(?:r|b|h|l|g|w|cr)[aeiou]", "@"),
    R(null, "augh", null, "O"),
    R(null, "ai", null, "eI"),
    R(null, "ay", null, "eI"),
    R(null, "au", null, "O"),
    R(null, "aw", null, "O"),
    R(null, "all", null, "O l"),
    R(null, "alk", null, "O k"),
    R(null, "ar", EV, "ae r"),
    R(null, "ar", null, "A r"),
    R(null, "a", "nge", "eI"),
    R(null, "a", `${EC}e(?:[ds]?|r|ly) `, "eI"),
    R(null, "a", `${EC}i(?:ng|on)`, "eI"),
    R(null, "a", " ", "@"),
    R(null, "a", null, "ae"),
  ],
  b: [R(null, "bb", null, "b"), R(null, "b", null, "b")],
  c: [
    R(" ", "chr", null, "k r"),
    R(null, "ch", null, "tS"),
    R(null, "ck", null, "k"),
    R(null, "cc", "[eiy]", "k s"),
    R(null, "c", "[eiy]", "s"),
    R(null, "c", null, "k"),
  ],
  d: [R(null, "dg", null, "dZ"), R(null, "dd", null, "d"), R(null, "d", null, "d")],
  e: [
    R(`${EC}[td]`, "ed", " ", "I d"),
    R("[pkfsx]|sh|ch", "ed", " ", "t"),
    R(EV + EC, "ed", " ", "d"),
    R("(?:[sxz]|sh|ch|ge|ce)", "es", " ", "I z"),
    R(EC, "es", " ", "z"),
    R(EV + EC, "e", " ", ""),
    R(EC + EC, "e", " ", ""),
    R(null, "ee", null, "i"),
    R(null, "ea", "r ", "I r"),
    R(null, "ea", null, "i"),
    R(null, "ei", null, "i"),
    R(null, "ey", " ", "i"),
    R(null, "ey", null, "eI"),
    R(null, "eu", null, "j u"),
    R(null, "ew", null, "j u"),
    R(null, "er", `(?:${EC}| )`, "3"),
    R(null, "e", `${EC}e `, "i"),
    R(" ", "e", " ", "i"),
    R(null, "e", " ", ""),
    R(null, "e", null, "E"),
  ],
  f: [R(null, "ff", null, "f"), R(null, "f", null, "f")],
  g: [
    R(null, "gh", "(?: |t)", ""),
    R(" ", "gh", null, "g"),
    R(" ", "gn", null, "n"),
    R(null, "gn", " ", "n"),
    R(null, "gg", null, "g"),
    R(null, "g", "[eiy]", "dZ"),
    R(null, "g", null, "g"),
  ],
  h: [R(EV, "h", " ", ""), R(null, "h", null, "h")],
  i: [
    R(null, "igh", null, "aI"),
    R(null, "ie", " ", "aI"),
    R(null, "ie", null, "i"),
    R(null, "ir", `(?:${EC}| )`, "3"),
    R(null, "i", `${EC}e(?:[ds]?|r|ly) `, "aI"),
    R(null, "i", "nd", "aI"),
    R(null, "i", "ld", "aI"),
    R(null, "i", null, "I"),
  ],
  j: [R(null, "j", null, "dZ")],
  k: [R(" ", "kn", null, "n"), R(null, "k", null, "k")],
  l: [R(null, "ll", null, "l"), R(EC, "le", " ", "@ l"), R(null, "l", null, "l")],
  m: [R(null, "mb", " ", "m"), R(null, "mm", null, "m"), R(null, "m", null, "m")],
  n: [R(null, "ng", null, "N"), R(null, "nk", null, "N k"), R(null, "nn", null, "n"), R(null, "n", null, "n")],
  o: [
    R(null, "ough", "t", "O"),
    R(null, "ough", null, "oU"),
    R(null, "ook", null, "U k"),
    R(null, "oo", null, "u"),
    R(null, "oul", "d", "U"),
    R(null, "ou", null, "aU"),
    R(" [hnc]", "ow", " ", "aU"),
    R(null, "ow", "(?:n|er)", "aU"),
    R(null, "ow", null, "oU"),
    R(null, "oi", null, "OI"),
    R(null, "oy", null, "OI"),
    R(null, "oa", null, "oU"),
    R(null, "or", null, "O r"),
    R(null, "old", null, "oU l d"),
    R(null, "o", `${EC}e(?:[ds]?|r|ly) `, "oU"),
    R(null, "o", " ", "oU"),
    R(null, "o", null, "A"),
  ],
  p: [R(null, "ph", null, "f"), R(null, "pp", null, "p"), R(null, "p", null, "p")],
  q: [R(null, "qu", null, "k w"), R(null, "q", null, "k")],
  r: [R(null, "rr", null, "r"), R(null, "r", null, "r")],
  s: [
    R(null, "sh", null, "S"),
    R(EV, "sion", null, "Z @ n"),
    R(null, "sion", null, "S @ n"),
    R(null, "sure", null, "S 3"),
    R(null, "ss", null, "s"),
    R(EV, "s", EV, "z"),
    R("[bdgvlmnr]|" + EV, "s", " ", "z"),
    R(null, "s", null, "s"),
  ],
  t: [
    R(null, "tion", null, "S @ n"),
    R(null, "ture", null, "tS 3"),
    R(null, "tch", null, "tS"),
    R(null, "th", null, "T"),
    R(null, "tt", null, "t"),
    R(null, "t", null, "t"),
  ],
  u: [
    R("[rlj]", "u", `${EC}e `, "u"),
    R(null, "u", `${EC}e(?:[ds]?|r|ly) `, "j u"),
    R(null, "ur", `(?:${EC}| )`, "3"),
    R(null, "ue", " ", "u"),
    R(null, "ui", null, "u"),
    R(" ", "u", `${EC}${EV}`, "j u"),
    R(null, "u", null, "V"),
  ],
  v: [R(null, "v", null, "v")],
  w: [R(" ", "wh", null, "w"), R(" ", "wr", null, "r"), R(null, "wor", null, "w 3"), R(null, "wa", "[^y]", "w A"), R(null, "w", null, "w")],
  x: [R(" ", "x", null, "z"), R(null, "x", null, "k s")],
  y: [R(" ", "y", EV, "j"), R(`${EV}.*${EC}`, "y", " ", "i"), R(" .?", "y", " ", "aI"), R(null, "y", " ", "i"), R(null, "y", null, "I")],
  z: [R(null, "zz", null, "z"), R(null, "z", null, "z")],
};

function enWord(w: string): string[] {
  const d = EN_DICT[w];
  if (d) return d.split(" ");
  const s = ` ${w} `;
  const out: string[] = [];
  let i = 1;
  while (i < s.length - 1) {
    const rules = EN_RULES[s[i]!];
    if (!rules) {
      i++;
      continue;
    }
    let done = false;
    for (const [l, m, r, p] of rules) {
      if (!s.startsWith(m, i)) continue;
      if (l && !l.test(s.slice(0, i))) continue;
      if (r && !r.test(s.slice(i + m.length))) continue;
      if (p) out.push(...p.split(" "));
      i += m.length;
      done = true;
      break;
    }
    if (!done) i++;
  }
  // (the first vowel stressed: most English words of two syllables, a rough rule)
  const v = out.findIndex(isVowel);
  if (v >= 0) out[v] += "'";
  return out;
}

/** A text's phonemes: its words' (the pauses at its punctuation, "|" between words). */
export function phonemes(text: string): string[] {
  const s = normalize(text).toLowerCase();
  const out: string[] = [];
  for (const tok of s.match(/[a-z'’]+|[,.;:!?]/g) ?? []) {
    if (/^[,;:]$/.test(tok)) out.push(",");
    else if (/^[.!?]$/.test(tok)) out.push(".");
    else out.push(...enWord(tok.replace(/’/g, "'")), "|");
  }
  return out;
}
