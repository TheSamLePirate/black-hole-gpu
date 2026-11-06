// The auroras' emission lines (PLAN-AURORES-MAGNETOSPHERES AM2, § 7.3): each line's luminance per kilorayleigh [cd/m²] and its
// colour in the game's linear RGB (Rec. 709 primaries), from its wavelength alone — CIE 1931's colour-matching functions (the
// multi-lobe fit of Wyman, Sloan & Shirley 2013, within ~1 % of the tables over 420–660 nm), XYZ → linear sRGB, the
// spectral colour (outside the gamut) brought in by adding white until no channel is negative, then scaled to a luminance
// of 1. Alex picks his tints by hand (AV:116–122); his luminances per kR for 557.7 and 630 — 1.9·10⁻⁴, 4.5·10⁻⁵ — are what
// this gives (tests/aurora-lines.test.ts); for N₂⁺ 427.8 V(λ) = 0.0097 gives 2.4·10⁻⁶, not his 3.4·10⁻⁶ (V = 0.0135, 432 nm's).
//
// 1 R = 10¹⁰/4π photons m⁻² s⁻¹ sr⁻¹ (a column's emission seen through it); a line's luminance = that × hc/λ × 683 lm/W ×
// V(λ) (photopic: the CIE table, below). The shader takes `tint × cdPerKR` (trace.wgsl AUR_*: a test holds them equal) and turns cd/m² into
// the scene's radiance by the full sunlight's 100 000 lux (renderer NIGHT_ILLUMINANCE's scale): L = cd/m² × 10⁻⁵ × |E|.
//
// Its altitude profile: a Gaussian under the peak (exp(−(h − peak)²/σ²)), an exponential over it (scale H), none under the
// floor; a column's kR spread over 0.886·σ + H km.

export interface AuroraLine {
  name: string;
  /** wavelength [nm] */
  nm: number;
  /** the profile [km]: peak height, Gaussian width under it, scale height over it, floor */
  peak: number;
  sigma: number;
  H: number;
  floor: number;
}

export const AURORA_LINES = {
  green: { name: "O 557.7", nm: 557.7, peak: 110, sigma: 7, H: 24, floor: 80 },
  red: { name: "O 630.0", nm: 630.0, peak: 240, sigma: 50, H: 90, floor: 150 },
  blue: { name: "N2+ 427.8", nm: 427.8, peak: 104, sigma: 6, H: 18, floor: 80 },
  pink: { name: "N2 1P", nm: 670, peak: 96, sigma: 3, H: 7, floor: 80 },
  // the giants' (AM3, Jupiter: Alex's § 7.3 starting values over the 1 bar level — not measurements): H-α, and H₂'s visible
  // violet taken at 455 nm (his tint (0.55, 0.30, 1))
  halpha: { name: "H-alpha 656.3", nm: 656.3, peak: 245, sigma: 30, H: 120, floor: 120 },
  h2: { name: "H2 violet", nm: 455, peak: 245, sigma: 30, H: 150, floor: 120 },
} satisfies Record<string, AuroraLine>;

const g = (x: number, mu: number, s1: number, s2: number) => {
  const t = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
};

/** CIE 1931 2° colour-matching functions at λ [nm] (Wyman, Sloan & Shirley 2013, the multi-lobe fit) */
export function cie1931(nm: number): [number, number, number] {
  const x = 1.056 * g(nm, 599.8, 37.9, 31.0) + 0.362 * g(nm, 442.0, 16.0, 26.7) - 0.065 * g(nm, 501.1, 20.4, 26.2);
  const y = 0.821 * g(nm, 568.8, 46.9, 40.5) + 0.286 * g(nm, 530.9, 16.3, 31.1);
  const z = 1.217 * g(nm, 437.0, 11.8, 36.0) + 0.681 * g(nm, 459.0, 26.0, 13.8);
  return [x, y, z];
}

/** linear sRGB's luminance (Rec. 709) */
export const luma = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** a line's colour in linear RGB, its luminance 1 (white added until no channel is negative) */
export function lineTint(nm: number): [number, number, number] {
  const [X, Y, Z] = cie1931(nm);
  const c: [number, number, number] = [
    3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    0.0557 * X - 0.204 * Y + 1.057 * Z,
  ];
  const lo = Math.min(...c);
  if (lo < 0) for (let i = 0; i < 3; i++) c[i]! -= lo;
  const l = luma(c);
  return [c[0] / l, c[1] / l, c[2] / l];
}

/** the photopic luminosity function V(λ) (CIE 1924 = CIE 1931 ȳ), 400–700 nm every 5 nm: the fit above is ~40 % low in the
 *  violet (427.8 nm), where the luminance of N₂⁺ is read */
const V_TABLE = [
  0.0004, 0.00064, 0.0012, 0.00218, 0.004, 0.0073, 0.0116, 0.01684, 0.023, 0.0298, 0.038, 0.048, 0.06, 0.0739, 0.09098, 0.1126, 0.13902,
  0.1693, 0.20802, 0.2586, 0.323, 0.4073, 0.503, 0.6082, 0.71, 0.7932, 0.862, 0.91485, 0.954, 0.9803, 0.99495, 1.0, 0.995, 0.9786, 0.952,
  0.9154, 0.87, 0.8163, 0.757, 0.6949, 0.631, 0.5668, 0.503, 0.4412, 0.381, 0.321, 0.265, 0.217, 0.175, 0.1382, 0.107, 0.0816, 0.061,
  0.04458, 0.032, 0.0232, 0.017, 0.01192, 0.00821, 0.005723, 0.004102,
];
export function photopicV(nm: number): number {
  const u = Math.min(Math.max((nm - 400) / 5, 0), V_TABLE.length - 1.000001);
  const i = Math.floor(u);
  return V_TABLE[i]! + (u - i) * (V_TABLE[i + 1]! - V_TABLE[i]!);
}

/** photons m⁻² s⁻¹ sr⁻¹ in a kilorayleigh */
export const KR_PHOTONS = 1e13 / (4 * Math.PI);

/** a line's luminance per kR seen [cd/m²] */
export function cdPerKR(nm: number): number {
  const E = (6.62607015e-34 * 299792458) / (nm * 1e-9);
  return KR_PHOTONS * E * 683 * photopicV(nm);
}

/** a line's radiance per kR in the shader's units before the sunlight's scale: tint × cd/m² per kR (trace.wgsl AUR_*) */
export function lineRGB(nm: number): [number, number, number] {
  const t = lineTint(nm),
    k = cdPerKR(nm);
  return [t[0] * k, t[1] * k, t[2] * k];
}

/** the profile (1 at the peak) at a height [km] */
export function lineProfile(L: AuroraLine, h: number): number {
  if (h < L.floor) return 0;
  return h < L.peak ? Math.exp(-((h - L.peak) ** 2) / (L.sigma * L.sigma)) : Math.exp(-(h - L.peak) / L.H);
}

/** the column the profile spreads a kR over [km]: 0.886·σ + H */
export const lineColumn = (L: AuroraLine) => 0.886 * L.sigma + L.H;

/**
 * The main arc's green brightness [kR] at a Kp — its column's, a photometer looking up the arc (the IBC's measure): the International Brightness Coefficients' steps — IBC I
 * 1 kR, II 10, III 100 (Chamberlain 1961; `auroras.md` § 1.5) —, a quiet oval at a few kR, Kp 3 about IBC II, a storm
 * (Kp 7) near IBC III: 2 × 10^(0.24·Kp).
 */
export const arcKR = (kp: number) => 2 * 10 ** (0.24 * kp);

/** the other lines' kR over the green's (§ 7.3's weights): red 0.15·(1 + 0.25 Kp), N₂⁺ 0.3, N₂ 1P 0.6·clamp((Kp − 3)/4) */
export function lineRatios(kp: number) {
  return { green: 1, red: 0.15 * (1 + 0.25 * kp), blue: 0.3, pink: 0.6 * Math.min(Math.max((kp - 3) / 4, 0), 1) };
}
