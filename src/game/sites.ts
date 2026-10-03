// Places to come down on: each world's runways, landing sites and the film's — latitude and east
// longitude [°] (our bodies: on their own turning axes; Gargantua's worlds: on their frames' axes, x away
// from Gargantua, z their pole). The entry autopilot flies to one (the nearest, unless chosen).

export interface Site {
  body: string;
  name: string;
  lat: number;
  lon: number;
  /** a runway (the Ranger glides onto it) or a pad */
  runway?: boolean;
  /** the runway's landing heading [° from north] (its threshold at the place) */
  rwy?: number;
}

export const SITES: Site[] = [
  { body: "earth", name: "Kennedy Space Center, Shuttle Landing Facility", lat: 28.615, lon: -80.695, runway: true, rwy: 150 },
  { body: "earth", name: "Edwards Air Force Base", lat: 34.905, lon: -117.884, runway: true, rwy: 220 },
  { body: "earth", name: "Kourou, Guiana Space Centre", lat: 5.24, lon: -52.77, runway: true, rwy: 70 },
  { body: "earth", name: "Baikonur, Yubileyniy", lat: 46.0, lon: 63.3, runway: true, rwy: 60 },
  { body: "earth", name: "Paris – Le Bourget", lat: 48.96, lon: 2.44, runway: true, rwy: 270 },
  { body: "earth", name: "Tanegashima", lat: 30.4, lon: 130.97, runway: true, rwy: 340 },
  { body: "earth", name: "Woomera", lat: -31.16, lon: 136.8, runway: true, rwy: 0 },
  { body: "mars", name: "Jezero crater", lat: 18.44, lon: 77.45 },
  { body: "mars", name: "Gale crater", lat: -5.4, lon: 137.8 },
  { body: "mars", name: "Utopia Planitia", lat: 47.6, lon: 118.0 },
  { body: "moon", name: "Tranquility Base", lat: 0.674, lon: 23.473 },
  { body: "moon", name: "Shackleton crater's rim", lat: -89.5, lon: 0 },
  { body: "titan", name: "Huygens' landing site", lat: -10.25, lon: 192.32 },
  { body: "miller", name: "Miller's shallows (the Ranger's landing)", lat: 0, lon: 20 },
  { body: "mann", name: "Mann's camp", lat: 12, lon: -35 },
  { body: "edmunds", name: "Edmunds' plain (Brand's camp)", lat: 6, lon: 55, runway: true, rwy: 90 },
];

export const sitesOf = (body: string) => SITES.filter((s) => s.body === body);

/** A site's unit direction on its body's own axes. */
export function siteDir(s: { lat: number; lon: number }): [number, number, number] {
  const D = Math.PI / 180;
  return [Math.cos(s.lat * D) * Math.cos(s.lon * D), Math.cos(s.lat * D) * Math.sin(s.lon * D), Math.sin(s.lat * D)];
}

/**
 * How much of a runway a point of the Earth is on (0…1; unit direction on the Earth's own axes): from
 * 500 m before each runway's threshold to 4.5 km past it, 60 m either side of its axis — faded to none
 * 60 m further across and 300 m further along. There the ground is graded: the relief's base, without
 * the drawn detail (the gear rolls on a runway, not on the procedural bumps between the map's texels).
 */
const RUNWAYS = SITES.filter((s) => s.body === "earth" && s.runway).map((s) => {
  const D = Math.PI / 180;
  const la = s.lat * D,
    lo = s.lon * D;
  const p: [number, number, number] = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const north: [number, number, number] = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const east: [number, number, number] = [-Math.sin(lo), Math.cos(lo), 0];
  const h = (s.rwy ?? 0) * D;
  const along = north.map((n, i) => n * Math.cos(h) + east[i]! * Math.sin(h)) as [number, number, number];
  const across = north.map((n, i) => -n * Math.sin(h) + east[i]! * Math.cos(h)) as [number, number, number];
  return { p, along, across };
});
const R_EARTH = 6371e3;
export function runwayWeight(q: [number, number, number]): number {
  let w = 0;
  for (const r of RUNWAYS) {
    const d: [number, number, number] = [q[0] - r.p[0], q[1] - r.p[1], q[2] - r.p[2]];
    // (more than ~6 km off: not this one)
    if (d[0] * d[0] + d[1] * d[1] + d[2] * d[2] > 1e-6) continue;
    const a = (d[0] * r.along[0] + d[1] * r.along[1] + d[2] * r.along[2]) * R_EARTH;
    const c = Math.abs(d[0] * r.across[0] + d[1] * r.across[1] + d[2] * r.across[2]) * R_EARTH;
    const wa = a < -500 ? Math.max(0, 1 + (a + 500) / 300) : a > 4500 ? Math.max(0, 1 - (a - 4500) / 300) : 1;
    const wc = c < 60 ? 1 : Math.max(0, 1 - (c - 60) / 60);
    w = Math.max(w, wa * wc);
  }
  return w;
}
