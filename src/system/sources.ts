// PLAN-REFRACTION-HORIZONS Q7 G1/G2 — every source of the Earth's ground declaring what it is: its projection, its vertical datum,
// its model (a terrain model — the bare ground —, a surface model — roofs and crowns —, a canopy's height over the ground, or
// none), its resolution, its date, how its absence shows (its validity mask) and what stands in for it (its fallback). The
// readers (earth-tiles.ts, national.ts, scenery-sources.ts, ign-canopy.ts) keep their code; this is the contract they are held
// to — tests/sources.test.ts checks every declaration whole, every fallback known, and the heights over the sea converted at
// the one boundary the WGS84 rule names: the ground over the ellipsoid max(H, 0) + N (geoid.ts, EGM2008).

export type SourceKind = "imagery" | "heights" | "surface" | "canopy" | "vector" | "landcover" | "geoid";
export type VerticalDatum =
  /** heights above the mean sea (a national levelling's or a global model's): over the ellipsoid by + N (EGM2008) */
  | "msl"
  /** heights over the WGS84 ellipsoid already */
  | "ellipsoid"
  /** heights over the local ground (a canopy, a building's) */
  | "ground"
  /** no heights */
  | "none";

export interface SourceDeclaration {
  id: string;
  kind: SourceKind;
  provider: string;
  /** its grid or tiling: e.g. "EPSG:3857 WMTS (PM)", "EPSG:4326 TMS quantized mesh" */
  projection: string;
  vertical: VerticalDatum;
  /** the datum's name where it has one (NGF-IGN69, LHN95, EGM96…) */
  verticalName?: string;
  /** "MNT" the bare ground, "MNS" the surface, "MNH" the canopy's height, "—" none */
  model: "MNT" | "MNS" | "MNH" | "—";
  /** the finest resolution it gives [m] */
  resolutionM: number;
  /** its date: a year, a period, or how each piece's is known */
  date: string;
  /** how its absence shows */
  validity: string;
  /** the source standing in where it has nothing (an id here), or "none" */
  fallback: string;
  /** where the game reads it */
  reader: string;
  licence: string;
}

export const SOURCES: readonly SourceDeclaration[] = [
  {
    id: "terrarium",
    kind: "heights",
    provider: "Mapzen Terrarium (AWS open data: SRTM, GMTED, ETOPO1, national surveys)",
    projection: "EPSG:3857 XYZ PNG tiles (z ≤ 15)",
    vertical: "msl",
    verticalName: "mean sea level (EGM96, the SRTM's)",
    model: "MNT",
    resolutionM: 30,
    date: "a compilation, ~2000 (SRTM) to 2016",
    validity: "every tile (the sea at its bathymetry, clamped at 0 for the ground)",
    fallback: "etopo2022",
    reader: "earth-tiles.ts tileUrl",
    licence: "open data (sources' attributions)",
  },
  {
    id: "etopo2022",
    kind: "heights",
    provider: "NOAA ETOPO 2022",
    projection: "equirectangular global map (earth-maps.ts)",
    vertical: "msl",
    verticalName: "EGM2008",
    model: "MNT",
    resolutionM: 4900,
    date: "2022",
    validity: "global",
    fallback: "none",
    reader: "earth-maps.ts",
    licence: "public domain",
  },
  {
    id: "eox-s2cloudless-2021",
    kind: "imagery",
    provider: "EOX Sentinel-2 cloudless 2021",
    projection: "EPSG:3857 WMTS",
    vertical: "none",
    model: "—",
    resolutionM: 10,
    date: "2021 mosaic, no per-pixel date (the satellite near 10:30 solar)",
    validity: "global land; the sea's own colour",
    fallback: "gibs-bluemarble",
    reader: "earth-tiles.ts (eoxColour)",
    licence: "CC BY-NC-SA 4.0",
  },
  {
    id: "gibs-bluemarble",
    kind: "imagery",
    provider: "NASA GIBS Blue Marble Next Generation",
    projection: "EPSG:3857 WMTS (GoogleMapsCompatible, z ≤ 8)",
    vertical: "none",
    model: "—",
    resolutionM: 500,
    date: "2004, monthly composites",
    validity: "global",
    fallback: "none",
    reader: "earth-tiles.ts (GIBS)",
    licence: "public domain",
  },
  {
    id: "ign-ortho",
    kind: "imagery",
    provider: "IGN BD ORTHO (Géoplateforme)",
    projection: "EPSG:3857 WMTS (PM), z 15–18",
    vertical: "none",
    model: "—",
    resolutionM: 0.2,
    date: "per piece (the mosaic graph's acquisition dates — not read yet: L7b's Sun found from the image), spring–summer flights near noon",
    validity: "France's box (ORTHO_BOX); out of coverage 404 — no image",
    fallback: "eox-s2cloudless-2021",
    reader: "earth-tiles.ts orthoUrl (I1)",
    licence: "Licence Ouverte 2.0",
  },
  {
    id: "ign-heights",
    kind: "heights",
    provider: "IGN RGE ALTI 1 m, LiDAR HD MNT 0.5 m from z 16 (Géoplateforme WMS-R)",
    projection: "EPSG:3857 WMS-R BIL float32",
    vertical: "msl",
    verticalName: "NGF-IGN69 (IGN78 in Corsica)",
    model: "MNT",
    resolutionM: 0.5,
    date: "RGE ALTI 2009–2021; LiDAR HD 2021– by blocks",
    validity: "NaN where none (the sea, abroad)",
    fallback: "terrarium",
    reader: "earth-tiles.ts IGN (I2)",
    licence: "Licence Ouverte 2.0",
  },
  {
    id: "ign-surface",
    kind: "surface",
    provider: "IGN LiDAR HD MNS 0.5 m, RGE ALTI MNS",
    projection: "EPSG:3857 WMS-R BIL float32",
    vertical: "msl",
    verticalName: "NGF-IGN69",
    model: "MNS",
    resolutionM: 0.5,
    date: "LiDAR HD 2021– by blocks",
    validity: "NaN where none; over the sea noise — read over the IGN's own ground only (T7)",
    fallback: "none",
    reader: "earth-tiles.ts ignGround (I6: the far silhouettes' overground)",
    licence: "Licence Ouverte 2.0",
  },
  {
    id: "ign-canopy",
    kind: "canopy",
    provider: "IGN LiDAR HD MNH 0.5 m",
    projection: "EPSG:3857 WMS-R BIL float32 (z 14 blocks, 512²)",
    vertical: "ground",
    model: "MNH",
    resolutionM: 0.5,
    date: "LiDAR HD 2021– by blocks",
    validity: "where flown; NaN or none elsewhere",
    fallback: "worldcover",
    reader: "ign-canopy.ts (I4)",
    licence: "Licence Ouverte 2.0",
  },
  {
    id: "swissimage",
    kind: "imagery",
    provider: "swisstopo SWISSIMAGE",
    projection: "EPSG:3857 WMTS",
    vertical: "none",
    model: "—",
    resolutionM: 0.1,
    date: "current (by flight year, 3-year cycle)",
    validity: "Switzerland and Liechtenstein's outlines",
    fallback: "eox-s2cloudless-2021",
    reader: "national.ts SWISSTOPO (I7)",
    licence: "OGD (free geodata)",
  },
  {
    id: "swissalti3d",
    kind: "heights",
    provider: "swisstopo swissALTI3D (terrain service)",
    projection: "EPSG:4326 TMS quantized mesh",
    vertical: "msl",
    verticalName: "LHN95",
    model: "MNT",
    resolutionM: 0.5,
    date: "current",
    validity: "its meshes over Switzerland; none elsewhere",
    fallback: "terrarium",
    reader: "national.ts SWISSTOPO (I7)",
    licence: "OGD (free geodata)",
  },
  {
    id: "usgs-imagery",
    kind: "imagery",
    provider: "USGS The National Map, USGSImageryOnly (NAIP-based)",
    projection: "EPSG:3857 cached tiles (ArcGIS MapServer)",
    vertical: "none",
    model: "—",
    resolutionM: 2,
    date: "by state, NAIP's cycles (2–3 years)",
    validity: "the contiguous states' outline; z ≤ 16 (404 beyond: the coarser shows)",
    fallback: "eox-s2cloudless-2021",
    reader: "earth-tiles.ts USA (lot D)",
    licence: "public domain (USGS)",
  },
  {
    id: "mapterhorn-3dep",
    kind: "heights",
    provider: "Mapterhorn (USGS 3DEP 1 m over the USA)",
    projection: "EPSG:3857 Terrarium WebP 512²",
    vertical: "msl",
    verticalName: "NAVD88",
    model: "MNT",
    resolutionM: 1.2,
    date: "3DEP's acquisitions (by project)",
    validity: "the contiguous states' outline; z ≤ 16 (our 17); 404 where none (Terrarium fills)",
    fallback: "terrarium",
    reader: "earth-tiles.ts USA (lot D)",
    licence: "Mapterhorn: its sources' terms (USGS public domain)",
  },
  {
    id: "mapterhorn-world",
    kind: "heights",
    provider: "Mapterhorn (151 national surveys: Europe, Japan, New Zealand…)",
    projection: "EPSG:3857 Terrarium WebP 512²",
    vertical: "msl",
    verticalName: "each survey's national datum",
    model: "MNT",
    resolutionM: 1,
    date: "each survey's",
    validity: "Europe, Japan and New Zealand's boxes; 404 where it has none (Terrarium fills)",
    fallback: "terrarium",
    reader: "earth-tiles.ts MAPTERHORN_* (lot E)",
    licence: "its sources' (CC BY 4.0, dl-de/by-2-0, OGL…): mapterhorn.com/attribution",
  },
  {
    id: "bdtopo",
    kind: "vector",
    provider: "IGN BD TOPO (buildings)",
    projection: "EPSG:3857 MVT z 15",
    vertical: "ground",
    verticalName: "hauteur: ground to roof",
    model: "—",
    resolutionM: 1,
    date: "current edition",
    validity: "France; an absent tile: OSM's",
    fallback: "osm",
    reader: "bdtopo.ts, scenery-worker.ts (I5)",
    licence: "Licence Ouverte 2.0",
  },
  {
    id: "osm",
    kind: "vector",
    provider: "OpenStreetMap (OpenMapTiles), Overture abroad",
    projection: "EPSG:3857 MVT / PMTiles",
    vertical: "ground",
    verticalName: "height or levels × 3 m",
    model: "—",
    resolutionM: 1,
    date: "current",
    validity: "global, uneven",
    fallback: "none",
    reader: "scenery-worker.ts",
    licence: "ODbL",
  },
  {
    id: "worldcover",
    kind: "landcover",
    provider: "ESA WorldCover 2021 (Terrascope WMS)",
    projection: "EPSG:4326 WMS, fixed cells",
    vertical: "none",
    model: "—",
    resolutionM: 10,
    date: "2021",
    validity: "global land",
    fallback: "none",
    reader: "scenery-sources.ts",
    licence: "CC BY 4.0",
  },
  {
    id: "egm2008",
    kind: "geoid",
    provider: "EGM2008 geoid (15′ grid)",
    projection: "geodetic grid 1440 × 720",
    vertical: "ellipsoid",
    verticalName: "N: the mean sea over the WGS84 ellipsoid",
    model: "—",
    resolutionM: 27800,
    date: "2008",
    validity: "global",
    fallback: "none",
    reader: "geoid.ts, geoid-grid.ts",
    licence: "public domain (NGA)",
  },
];

export const sourceById = (id: string) => SOURCES.find((s) => s.id === id) ?? null;

/** A height read from a source into the ground over the WGS84 ellipsoid [m] — the one boundary (CLAUDE.md: max(H, 0) + N for
 *  heights over the sea; a ground-relative one needs its ground) */
export function overEllipsoid(src: SourceDeclaration, h: number, geoidN: number, groundOverEllipsoid = 0): number {
  switch (src.vertical) {
    case "msl":
      return Math.max(h, 0) + geoidN;
    case "ellipsoid":
      return h;
    case "ground":
      return groundOverEllipsoid + h;
    default:
      return Number.NaN;
  }
}
