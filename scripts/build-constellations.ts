// Builds the constellations' figures and the sky's names (bun scripts/build-constellations.ts) from
// assets/etoiles: stars.json — the Hipparcos catalogue as [x, y, z, V, B−V], unit vectors on the J2000
// equatorial axes with y towards the north pole (x the vernal equinox, z = −(ICRS y): checked on the
// bright stars to 0.02°) — and constellations.json, the figures' lines as pairs of indices into it.
//
// Out: assets/sky/constellations.json — the 88 constellations (IAU abbreviation, name, where their
// name is written: the middle of their figure), the figures' segments (ICRS unit vectors, which
// constellation), the named bright stars (ICRS unit vector, V magnitude).
//
// The figures' lines join into 87 pieces, not one per constellation: neighbours share a star (Pegasus
// and Andromeda Alpheratz, Taurus and Auriga Elnath, Carina and Puppis). A piece goes to the
// constellation whose centre is nearest its middle, a shared one is parted segment by segment, and a
// few long or split figures are named by hand (Hydra, Serpens Cauda, Telescopium).

const ROOT = new URL("..", import.meta.url).pathname;
type V3 = [number, number, number];
const stars = (await Bun.file(`${ROOT}assets/etoiles/stars.json`).json()) as number[][];
const lines = (await Bun.file(`${ROOT}assets/etoiles/constellations.json`).json()) as [number, number][];

/** [IAU abbreviation, name, the centre's right ascension [h], declination [°]] */
const CONSTELLATIONS: [string, string, number, number][] = [
  ["And", "Andromeda", 0.8, 37],
  ["Ant", "Antlia", 10.3, -32],
  ["Aps", "Apus", 16.1, -75],
  ["Aqr", "Aquarius", 22.3, -11],
  ["Aql", "Aquila", 19.7, 3],
  ["Ara", "Ara", 17.4, -53],
  ["Ari", "Aries", 2.6, 21],
  ["Aur", "Auriga", 6.0, 42],
  ["Boo", "Boötes", 14.7, 31],
  ["Cae", "Caelum", 4.7, -38],
  ["Cam", "Camelopardalis", 5.7, 69],
  ["Cnc", "Cancer", 8.6, 20],
  ["CVn", "Canes Venatici", 13.1, 40],
  ["CMa", "Canis Major", 6.8, -22],
  ["CMi", "Canis Minor", 7.6, 6],
  ["Cap", "Capricornus", 21.0, -18],
  ["Car", "Carina", 8.7, -63],
  ["Cas", "Cassiopeia", 1.3, 62],
  ["Cen", "Centaurus", 13.1, -47],
  ["Cep", "Cepheus", 22.0, 71],
  ["Cet", "Cetus", 1.7, -7],
  ["Cha", "Chamaeleon", 10.7, -79],
  ["Cir", "Circinus", 14.6, -63],
  ["Col", "Columba", 5.9, -35],
  ["Com", "Coma Berenices", 12.8, 23],
  ["CrA", "Corona Australis", 18.6, -41],
  ["CrB", "Corona Borealis", 15.8, 33],
  ["Crv", "Corvus", 12.4, -18],
  ["Crt", "Crater", 11.4, -16],
  ["Cru", "Crux", 12.4, -60],
  ["Cyg", "Cygnus", 20.6, 44],
  ["Del", "Delphinus", 20.7, 12],
  ["Dor", "Dorado", 5.2, -59],
  ["Dra", "Draco", 15.1, 67],
  ["Equ", "Equuleus", 21.2, 8],
  ["Eri", "Eridanus", 3.3, -29],
  ["For", "Fornax", 2.8, -32],
  ["Gem", "Gemini", 7.1, 23],
  ["Gru", "Grus", 22.5, -46],
  ["Her", "Hercules", 17.4, 27],
  ["Hor", "Horologium", 3.3, -53],
  ["Hya", "Hydra", 11.6, -14],
  ["Hyi", "Hydrus", 2.3, -70],
  ["Ind", "Indus", 21.9, -60],
  ["Lac", "Lacerta", 22.5, 46],
  ["Leo", "Leo", 10.7, 14],
  ["LMi", "Leo Minor", 10.2, 33],
  ["Lep", "Lepus", 5.6, -19],
  ["Lib", "Libra", 15.2, -15],
  ["Lup", "Lupus", 15.2, -43],
  ["Lyn", "Lynx", 7.9, 48],
  ["Lyr", "Lyra", 18.9, 37],
  ["Men", "Mensa", 5.4, -78],
  ["Mic", "Microscopium", 21.0, -36],
  ["Mon", "Monoceros", 7.1, 0],
  ["Mus", "Musca", 12.6, -70],
  ["Nor", "Norma", 16.1, -51],
  ["Oct", "Octans", 23.0, -83],
  ["Oph", "Ophiuchus", 17.4, -4],
  ["Ori", "Orion", 5.6, 6],
  ["Pav", "Pavo", 19.6, -65],
  ["Peg", "Pegasus", 22.7, 20],
  ["Per", "Perseus", 3.2, 45],
  ["Phe", "Phoenix", 0.9, -48],
  ["Pic", "Pictor", 5.7, -53],
  ["Psc", "Pisces", 0.5, 13],
  ["PsA", "Piscis Austrinus", 22.3, -31],
  ["Pup", "Puppis", 7.3, -31],
  ["Pyx", "Pyxis", 8.9, -27],
  ["Ret", "Reticulum", 3.9, -60],
  ["Sge", "Sagitta", 19.7, 19],
  ["Sgr", "Sagittarius", 19.1, -28],
  ["Sco", "Scorpius", 16.9, -27],
  ["Scl", "Sculptor", 0.4, -32],
  ["Sct", "Scutum", 18.7, -10],
  ["Ser", "Serpens", 16.9, 6],
  ["Sex", "Sextans", 10.3, -3],
  ["Tau", "Taurus", 4.7, 15],
  ["Tel", "Telescopium", 19.3, -51],
  ["Tri", "Triangulum", 2.2, 32],
  ["TrA", "Triangulum Australe", 16.1, -65],
  ["Tuc", "Tucana", 23.8, -65],
  ["UMa", "Ursa Major", 11.3, 51],
  ["UMi", "Ursa Minor", 15.0, 78],
  ["Vel", "Vela", 9.6, -47],
  ["Vir", "Virgo", 13.4, -4],
  ["Vol", "Volans", 7.8, -69],
  ["Vul", "Vulpecula", 20.2, 24],
];
/** the named stars: [name, right ascension, declination [°]] — matched to the catalogue within 0.3° */
const NAMES: [string, number, number][] = [
  ["Sirius", 101.29, -16.72],
  ["Canopus", 95.99, -52.7],
  ["Arcturus", 213.92, 19.18],
  ["Rigil Kentaurus", 219.9, -60.83],
  ["Vega", 279.23, 38.78],
  ["Capella", 79.17, 46.0],
  ["Rigel", 78.63, -8.2],
  ["Procyon", 114.83, 5.22],
  ["Achernar", 24.43, -57.24],
  ["Betelgeuse", 88.79, 7.41],
  ["Hadar", 210.96, -60.37],
  ["Altair", 297.7, 8.87],
  ["Acrux", 186.65, -63.1],
  ["Aldebaran", 68.98, 16.51],
  ["Antares", 247.35, -26.43],
  ["Spica", 201.3, -11.16],
  ["Pollux", 116.33, 28.03],
  ["Fomalhaut", 344.41, -29.62],
  ["Deneb", 310.36, 45.28],
  ["Mimosa", 191.93, -59.69],
  ["Regulus", 152.09, 11.97],
  ["Adhara", 104.66, -28.97],
  ["Castor", 113.65, 31.89],
  ["Shaula", 263.4, -37.1],
  ["Gacrux", 187.79, -57.11],
  ["Bellatrix", 81.28, 6.35],
  ["Elnath", 81.57, 28.61],
  ["Miaplacidus", 138.3, -69.72],
  ["Alnilam", 84.05, -1.2],
  ["Alnair", 332.06, -46.96],
  ["Alnitak", 85.19, -1.94],
  ["Alioth", 193.51, 55.96],
  ["Dubhe", 165.93, 61.75],
  ["Mirfak", 51.08, 49.86],
  ["Wezen", 107.1, -26.39],
  ["Sargas", 264.33, -43.0],
  ["Kaus Australis", 276.04, -34.38],
  ["Avior", 125.63, -59.51],
  ["Alkaid", 206.89, 49.31],
  ["Menkalinan", 89.88, 44.95],
  ["Atria", 252.17, -69.03],
  ["Alhena", 99.43, 16.4],
  ["Peacock", 306.41, -56.74],
  ["Alsephina", 131.18, -54.71],
  ["Mirzam", 95.67, -17.96],
  ["Alphard", 141.9, -8.66],
  ["Polaris", 37.95, 89.26],
  ["Hamal", 31.79, 23.46],
  ["Algieba", 154.99, 19.84],
  ["Diphda", 10.9, -17.99],
  ["Nunki", 283.82, -26.3],
  ["Menkent", 211.67, -36.37],
  ["Mirach", 17.43, 35.62],
  ["Alpheratz", 2.1, 29.09],
  ["Rasalhague", 263.73, 12.56],
  ["Kochab", 222.68, 74.16],
  ["Saiph", 86.94, -9.67],
  ["Denebola", 177.26, 14.57],
  ["Algol", 47.04, 40.96],
  ["Almach", 30.97, 42.33],
  ["Tiaki", 340.67, -46.88],
  ["Muhlifain", 190.38, -48.96],
  ["Aspidiske", 139.27, -59.28],
  ["Suhail", 136.99, -43.43],
  ["Alphecca", 233.67, 26.71],
  ["Mintaka", 83.0, -0.3],
  ["Sadr", 305.56, 40.26],
  ["Eltanin", 269.15, 51.49],
  ["Schedar", 10.13, 56.54],
  ["Naos", 120.9, -40.0],
  ["Caph", 2.29, 59.15],
  ["Izar", 221.25, 27.07],
  ["Dschubba", 240.08, -22.62],
  ["Merak", 165.46, 56.38],
  ["Ankaa", 6.57, -42.31],
  ["Enif", 326.05, 9.88],
  ["Scheat", 345.94, 28.08],
  ["Markab", 346.19, 15.21],
  ["Sabik", 257.59, -15.72],
  ["Phecda", 178.46, 53.69],
  ["Aludra", 111.02, -29.3],
  ["Alderamin", 319.64, 62.59],
  ["Cor Caroli", 194.01, 38.32],
  ["Mizar", 200.98, 54.93],
  ["Albireo", 292.68, 27.96],
  ["Unukalhai", 236.07, 6.43],
  ["Zubeneschamali", 229.25, -9.38],
  ["Zubenelgenubi", 222.72, -16.04],
  ["Vindemiatrix", 195.54, 10.96],
  ["Sadalsuud", 322.89, -5.57],
  ["Sadalmelik", 331.45, -0.32],
  ["Thuban", 211.1, 64.38],
  ["Arneb", 83.18, -17.82],
  ["Phact", 84.91, -34.07],
  ["Rasalgethi", 258.66, 14.39],
  ["Kornephoros", 247.55, 21.49],
  ["Deneb Algedi", 326.76, -16.13],
  ["Gienah", 183.95, -17.54],
  ["Zosma", 168.53, 20.52],
  ["Tarazed", 296.56, 10.61],
  ["Sheratan", 28.66, 20.81],
  ["Ruchbah", 21.45, 60.24],
];

const D = Math.PI / 180;
const icrs = (i: number): V3 => {
  const s = stars[i]!;
  return [s[0]!, -s[2]!, s[1]!];
};
const dir = (ra: number, dec: number): V3 => [Math.cos(dec * D) * Math.cos(ra * D), Math.cos(dec * D) * Math.sin(ra * D), Math.sin(dec * D)];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const sum = (vs: V3[]): V3 => unit(vs.reduce<V3>((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]));
const centre = CONSTELLATIONS.map(([, , ra, dec]) => dir(ra * 15, dec));
const nearest = (v: V3, among?: string[]) => {
  let best = -1, bd = -2;
  CONSTELLATIONS.forEach(([a], k) => {
    if (among && !among.includes(a)) return;
    const d = dot(v, centre[k]!);
    if (d > bd) (bd = d), (best = k);
  });
  return best;
};

// the figures' connected pieces
const parent = new Map<number, number>();
const find = (a: number): number => {
  let r = a;
  while ((parent.get(r) ?? r) !== r) r = parent.get(r)!;
  parent.set(a, r);
  return r;
};
for (const [a, b] of lines) parent.set(find(a), find(b));
const pieces = new Map<number, [number, number][]>();
for (const l of lines) {
  const r = find(l[0]);
  pieces.set(r, [...(pieces.get(r) ?? []), l]);
}
const mid = ([a, b]: [number, number]) => sum([icrs(a), icrs(b)]);
/** pieces joining two figures: parted segment by segment */
const SHARED: Record<string, string[]> = { Peg: ["Peg", "And"], Tau: ["Tau", "Aur"], Car: ["Car", "Pup"] };
const seg: { a: V3; b: V3; c: number }[] = [];
for (const piece of pieces.values()) {
  const pts = [...new Set(piece.flat())].map(icrs);
  let k = nearest(sum(pts));
  const ab = CONSTELLATIONS[k]![0];
  // (by hand: Hydra's middle falls near Sextans, Serpens Cauda near Ophiuchus, Telescopium's one line
  // near Corona Australis)
  if (ab === "Sex" && piece.length > 10) k = CONSTELLATIONS.findIndex((c) => c[0] === "Hya");
  else if (ab === "Oph" && dot(sum(pts), dir(18.2 * 15, -5)) > Math.cos(12 * D) && piece.length < 6) k = CONSTELLATIONS.findIndex((c) => c[0] === "Ser");
  else if (ab === "CrA" && piece.length === 1) k = CONSTELLATIONS.findIndex((c) => c[0] === "Tel");
  const shared = SHARED[CONSTELLATIONS[k]![0]];
  for (const l of piece) seg.push({ a: icrs(l[0]), b: icrs(l[1]), c: shared ? nearest(mid(l), shared) : k });
}
const used = new Set(seg.map((s) => s.c));
const missing = CONSTELLATIONS.filter((_, k) => !used.has(k)).map((c) => c[1]);
if (missing.length) throw new Error(`constellations without a figure: ${missing.join(", ")}`);

// where each name is written: the middle of its figure's stars
const label = CONSTELLATIONS.map((_, k) => sum(seg.filter((s) => s.c === k).flatMap((s) => [s.a, s.b])));

const bright = stars.map((s, i) => i).filter((i) => stars[i]![3]! < 4.5);
const named = NAMES.map(([name, ra, dec]) => {
  const v = dir(ra, dec);
  const i = bright.reduce((b, j) => (dot(icrs(j), v) > dot(icrs(b), v) ? j : b), bright[0]!);
  if (dot(icrs(i), v) < Math.cos(0.3 * D)) throw new Error(`${name}: no catalogue star within 0.3°`);
  return { name, v: icrs(i), mag: stars[i]![3]! };
});

const r5 = (v: V3) => v.map((x) => Math.round(x * 1e5) / 1e5);
await Bun.write(
  `${ROOT}assets/sky/constellations.json`,
  JSON.stringify({
    constellations: CONSTELLATIONS.map(([abbr, name], k) => ({ abbr, name, label: r5(label[k]!) })),
    segments: seg.map((s) => [...r5(s.a), ...r5(s.b), s.c]),
    stars: named.map((s) => ({ name: s.name, v: r5(s.v), mag: s.mag })),
  }),
);
console.log(`constellations.json: ${CONSTELLATIONS.length} constellations, ${seg.length} segments, ${named.length} named stars`);
