// The Earth's geoid: the height N of the mean sea surface (EGM2008's geoid) above the WGS84 ellipsoid [m],
// −107 m south of India to +86 m over New Guinea, +45 to +55 m over France, −30 m at Kennedy. The terrain's data
// are heights above the sea (Terrarium's SRTM and national surveys, ETOPO, the IGN's normal heights): the ground
// over the ellipsoid is that height plus N, and the sea's surface lies at N — what ADS-B's geometric altitudes and
// a GNSS read (heights over the ellipsoid). Altitudes shown as above the sea (the altimeters) are h − N.
//
// The map: assets/earth/geoid-egm2008-15.bin (scripts/build-geoid.py: 1440 × 720, 15′, N in centimetres, the
// heights' file format), read bilinearly (geoid-grid.ts) — within 7 cm rms of the 5′ grid, 2.5 m at worst. Until
// it is in (loadGeoid, with the Earth's maps), N reads 0: the sea on the ellipsoid, as before.

import geoidUrl from "../../assets/earth/geoid-egm2008-15.bin";
import { setGeoid } from "./geoid-grid";
import { type HeightMap, loadHeights } from "./heights-file";

export { GEOID_MAX, geoidAt, geoidDeg, geoidMap, geoidN, geoidTable, geoidUnder, setGeoid } from "./geoid-grid";

let loading: Promise<HeightMap> | null = null;

/** The geoid's map, loaded once (the same promise to every caller) and set for geoidN. */
export function loadGeoid(get?: (url: string) => Promise<Response>): Promise<HeightMap> {
  loading ??= loadHeights(geoidUrl, get).then(
    (g) => (setGeoid(g), g),
    (e) => {
      loading = null;
      throw e;
    },
  );
  return loading;
}
