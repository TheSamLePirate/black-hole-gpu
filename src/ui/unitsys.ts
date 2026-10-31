// The units shown (settings.units): metric by default — metres, metres a second, kilometres —, imperial as the
// option — feet, knots, nautical miles, feet a minute. The physics stays in SI: only what is shown and said changes.

export type UnitSys = "metric" | "imperial";

export interface Units {
  sys: UnitSys;
  /** a height [m], a speed [m/s], a distance [m], a vertical speed [m/s] in the units shown */
  alt: (m: number) => number;
  spd: (v: number) => number;
  dist: (m: number) => number;
  vs: (v: number) => number;
  /** their names (upper case: the HUD's, the PCD's) */
  altName: "M" | "FT";
  spdName: "M/S" | "KT";
  distName: "KM" | "NM";
  vsName: "M/S" | "FPM";
  /** a distance unit [m] (the PCD's range) */
  distM: number;
  /** written out (lower case: the messages', the panels'): "240 m/s", "450 kt", "12.3 km", "4500 m" */
  fSpd: (v: number) => string;
  fAlt: (m: number) => string;
  fDist: (m: number, digits?: number) => string;
  /** a pressure [Pa], a temperature [K] written out: bar and kelvin with Celsius (a giant's air — P11 D5), psi and °F */
  fPress: (pa: number) => string;
  fTemp: (k: number) => string;
}
// (a pressure's digits: three significant)
const sig3 = (x: number) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x >= 1 ? x.toFixed(2) : x.toPrecision(2));

const METRIC: Units = {
  sys: "metric",
  alt: (m) => m,
  spd: (v) => v,
  dist: (m) => m / 1000,
  vs: (v) => v,
  altName: "M",
  spdName: "M/S",
  distName: "KM",
  vsName: "M/S",
  distM: 1000,
  fSpd: (v) => `${Math.round(v)} m/s`,
  fAlt: (m) => `${Math.round(m)} m`,
  fDist: (m, d = 1) => `${(m / 1000).toFixed(d)} km`,
  fPress: (pa) => `${sig3(pa / 1e5)} bar`,
  fTemp: (k) => `${Math.round(k)} K · ${Math.round(k - 273.15)} °C`,
};

const IMPERIAL: Units = {
  sys: "imperial",
  alt: (m) => m / 0.3048,
  spd: (v) => v * 1.943844,
  dist: (m) => m / 1852,
  vs: (v) => (v / 0.3048) * 60,
  altName: "FT",
  spdName: "KT",
  distName: "NM",
  vsName: "FPM",
  distM: 1852,
  fSpd: (v) => `${Math.round(v * 1.943844)} kt`,
  fAlt: (m) => `${Math.round(m / 0.3048)} ft`,
  fDist: (m, d = 1) => `${(m / 1852).toFixed(d)} NM`,
  fPress: (pa) => `${sig3(pa / 6894.757)} psi`,
  fTemp: (k) => `${Math.round(((k - 273.15) * 9) / 5 + 32)} °F`,
};

/** The units of a system. */
export const unitsOf = (sys: UnitSys | undefined): Units => (sys === "imperial" ? IMPERIAL : METRIC);

/** The units the settings ask for (metric unless imperial is chosen). */
export const unitsFor = (s: { units?: UnitSys } | null | undefined): Units => unitsOf(s?.units);
