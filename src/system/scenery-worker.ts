// Worldwide data preparation is isolated from the render loop. No complete COG download.
import { VectorTile, classifyRings } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { earthDetail, toHalf } from "../terrain";
import { forestFrame, forestVec4s, growForest } from "./forest";
import { BDTOPO_Z, bdtopoHeight, bdtopoStands, bdtopoUrl, clipRing } from "./bdtopo";
import { CANOPY_NEAR, IgnLand } from "./ign-canopy";
import { fetchRange, OVERTURE_LIST, OVERTURE_Z, overtureReleases, overtureUrl, PmTiles } from "./pmtiles";
import { SwissGround } from "./national";
import {
  bdtopoTiles as bdtopoWanted,
  COVER_CELL,
  COVER_ROWS,
  coverCells,
  coverUrl,
  coverWidth,
  demTile,
  OVERTURE_REACH_M,
  STACKS_M,
  osmTiles,
  osmUrl,
  sceneryBox,
  sceneryDemZoom,
  surveyOf,
  surveyReach,
} from "./scenery-sources";
import { roadWidth, surfaceSegment, polygonPrimitive, stripPolygon, surfaceContains } from "./scenery-geometry";
import { buildingMesh } from "./roof-mesh";
import {
  osmColour,
  partyEdges,
  planBuilding,
  stacksOf,
  type RoofInput,
  type RoofPart,
  type Pt,
  regionOf,
  roofColour,
  overtureRoofMaterial,
  overtureShape,
  overtureWallMaterial,
  RoofMaterial,
  roofMaterial,
  wallColour,
  WallMaterial,
  wallMaterial,
} from "./roofs";
import {
  BUILDING_MESH_M,
  BUILDING_PARTS_M,
  buildingPacked,
  PARAPET_M,
  D,
  localPoint,
  packScenery,
  sceneryFrame,
  sceneryGrid,
  SCENERY_BYTES,
  wrapLon,
  sceneryExcluded,
  seed,
  type Primitive,
  type SceneryRequest,
  type SceneryReply,
} from "./scenery-data";

/** the water polygons of a river's kind (OpenMapTiles' water class): drawn in a river's style, not a lake's */
const RIVER_CLASSES = new Set(["river", "canal", "stream", "ditch", "drain"]);
/** their colour — its blue under 0.05: trace.wgsl sceneryWaterAt tells a river by it */
const RIVER_COLOUR = [0.02, 0.05, 0.04];
/** the sea's polygons near the coast (class "ocean") — their blue under 0.035: the sea's style, not a lake's */
const OCEAN_COLOUR = [0.018, 0.05, 0.03];

const g = globalThis as unknown as { onmessage: unknown; postMessage(v: SceneryReply, t?: Transferable[]): void };
const tx = (lon: number, z = 14) => ((lon + 180) / 360) * 2 ** z;
const ty = (lat: number, z = 14) => ((1 - Math.asinh(Math.tan(lat * D)) / Math.PI) / 2) * 2 ** z;

async function prepare(q: SceneryRequest): Promise<SceneryReply> {
  const started = performance.now(),
    signal = AbortSignal.timeout(60_000);
  // (the detail's reach: the box, its raster — ~10 m a pixel kept —, its budgets this many times the normal ones)
  const k = q.reach ?? 1,
    k2 = k * k,
    N = sceneryGrid(k),
    budget = q.budget ?? SCENERY_BYTES,
    room = budget / SCENERY_BYTES;
  const { radius, bounds } = sceneryBox(q.lat, q.lon, q.mode, k);
  const frame = sceneryFrame(q.lat, q.lon),
    pixels = new Uint32Array(N * N),
    classes = new Uint8Array(N * N);
  let networkBytes = 0,
    rgbPixels = 0;
  // (the responses an offline zone served — the Service Worker marks them —, and the others)
  const served = { zone: 0, other: 0 };
  const count = (r: Response) => {
    if (r.headers.get("x-kerr-zone") === "1") served.zone++;
    else served.other++;
  };
  const errors: string[] = [];
  const fetchCount = async (url: string, within = signal) => {
    const r = await fetch(url, { signal: within });
    count(r);
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
    const b = await r.arrayBuffer();
    networkBytes += b.byteLength;
    return b;
  };
  const index = (lat: number, lon: number) => {
    const x = Math.floor(((lon - bounds[0]) / (bounds[2] - bounds[0])) * N),
      y = Math.floor(((bounds[3] - lat) / (bounds[3] - bounds[1])) * N);
    return x >= 0 && x < N && y >= 0 && y < N ? y * N + x : -1;
  };
  // Official CORS-enabled WMS, already colour-rendered: this is visual guidance, not scientific classification.
  const palette = [
    [10, 0, 100, 0],
    [20, 255, 187, 34],
    [30, 255, 255, 76],
    [40, 240, 150, 255],
    [50, 250, 0, 0],
    [60, 180, 180, 180],
    [70, 240, 240, 240],
    [80, 0, 100, 200],
    [90, 0, 150, 160],
    [95, 0, 207, 117],
    [100, 250, 230, 160],
  ];
  // (the land cover's fixed cells — scenery-sources.ts — drawn over the scene's box, nearest pixel: its classes' colours
  // kept exact; a cell failed left transparent, the scene's error said)
  async function raster(rgb: boolean) {
    try {
      const canvas = new OffscreenCanvas(N, N),
        ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.imageSmoothingEnabled = false;
      const sx = N / (bounds[2] - bounds[0]),
        sy = N / (bounds[3] - bounds[1]);
      const cells = coverCells(bounds);
      let next = 0,
        failed: unknown = null;
      const run = async () => {
        while (next < cells.length) {
          const c = cells[next++]!;
          try {
            const bytes = await fetchCount(coverUrl(rgb, c.col, c.row));
            const image = await createImageBitmap(new Blob([bytes]), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
            if (image.width !== coverWidth(c.row) || image.height !== COVER_ROWS) throw new Error(`cell ${image.width}×${image.height}`);
            ctx.drawImage(image, (c.west - bounds[0]) * sx, (bounds[3] - c.south - COVER_CELL) * sy, COVER_CELL * sx, COVER_CELL * sy);
            image.close();
          } catch (e) {
            failed ??= e;
          }
        }
      };
      await Promise.all(Array.from({ length: 6 }, run));
      if (failed) errors.push(String(failed).slice(0, 220));
      const data = ctx.getImageData(0, 0, N, N).data;
      for (let i = 0; i < N * N; i++) {
        const r = data[i * 4]!,
          g0 = data[i * 4 + 1]!,
          b = data[i * 4 + 2]!;
        if (data[i * 4 + 3]! < 200) continue;
        if (rgb) {
          pixels[i] = (pixels[i]! & 0xff000000) | r | (g0 << 8) | (b << 16);
          rgbPixels++;
        } else {
          let distance = Infinity,
            cls = 0;
          for (const c of palette) {
            const d = (r - c[1]!) ** 2 + (g0 - c[2]!) ** 2 + (b - c[3]!) ** 2;
            if (d < distance) {
              distance = d;
              cls = c[0]!;
            }
          }
          if (distance < 1600) {
            classes[i] = cls;
            pixels[i] = (pixels[i]! & 0xffffff) | (cls << 24);
          }
        }
      }
    } catch (e) {
      errors.push(String(e).slice(0, 220));
    }
  }
  // (over France, the IGN's survey — I4 —: its canopy and its ground over the forest's disc, fetched beside the land cover
  // within its own time — the blocks late past it left to the land cover —, the scene's sources not held back by it)
  const surveyed = AbortSignal.timeout(45_000);
  const fetchSurvey = async (url: string) => {
    const r = await fetch(url, { signal: surveyed });
    count(r);
    if (!r.ok) throw new Error(`HTTP ${r.status} (${(await r.text()).replace(/\s+/g, " ").slice(0, 160)}): ${url}`);
    const b = await r.arrayBuffer();
    networkBytes += b.byteLength;
    return b;
  };
  // (over Switzerland, swisstopo's ground under the trees and the buildings — I7 —, its canopy none: the land cover's)
  const survey = surveyOf(q);
  const land: IgnLand | SwissGround | null =
    survey === "ign" ? new IgnLand(fetchSurvey) : survey === "swisstopo" ? new SwissGround(fetchSurvey) : null;
  const landReady = land?.prepare(q.lat, q.lon, surveyReach(radius));
  await raster(false);
  if (q.satellite) await raster(true);
  // Keep each DEM tile at least 1.8 km wide at high latitudes, bounding root-data memory.
  const demZoom = sceneryDemZoom(q.lat);
  const heights = new Map<string, Promise<Uint8ClampedArray>>();
  // (the sea's surface over the ellipsoid — the geoid's plane round the centre —: the ground as the tracer has it)
  const [n0, nLat, nLon] = q.geoid ?? [0, 0, 0];
  const sea = (lat: number, lon: number) => n0 + nLat * (lat - q.lat) + nLon * wrapLon(lon - q.lon);
  const height = async (lat: number, lon: number) => {
    // (the IGN's ground where it has one: the tracer's over France since I2 — its normal heights over the sea's surface)
    if (land) {
      await landReady;
      const h = land.ground(lat, lon);
      if (Number.isFinite(h)) return Math.max(0, h) + sea(lat, lon);
    }
    const xx = tx(wrapLon(lon), demZoom),
      yy = ty(lat, demZoom),
      { x, y } = demTile(lat, lon, demZoom),
      key = `${x}/${y}`;
    let p = heights.get(key);
    if (!p) {
      p = fetchCount(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${demZoom}/${key}.png`).then(async (b) => {
        const im = await createImageBitmap(new Blob([b]), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
        const c = new OffscreenCanvas(256, 256),
          ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(im, 0, 0);
        im.close();
        return ctx.getImageData(0, 0, 256, 256).data;
      });
      heights.set(key, p);
    }
    const px = await p,
      fx = (xx - x) * 256 - 0.5,
      fy = (yy - y) * 256 - 0.5;
    const weights = (t: number) => [
      (1 - t) ** 3 / 6,
      (4 - 6 * t * t + 3 * t * t * t) / 6,
      (1 + 3 * t + 3 * t * t - 3 * t * t * t) / 6,
      (t * t * t) / 6,
    ];
    const wx = weights(fx - Math.floor(fx)),
      wy = weights(fy - Math.floor(fy));
    let h0 = 0;
    for (let j = 0; j < 4; j++)
      for (let k = 0; k < 4; k++) {
        const ix = Math.min(255, Math.max(0, Math.floor(fx) + k - 1)),
          iy = Math.min(255, Math.max(0, Math.floor(fy) + j - 1)),
          i = (iy * 256 + ix) * 4;
        h0 += wx[k]! * wy[j]! * toHalf(px[i]! * 256 + px[i + 1]! + px[i + 2]! / 256 - 32768);
      }
    // Match the terrain's filtered DEM plus its existing fine relief; otherwise short buildings vanish under it.
    const a = lat * D,
      b = lon * D,
      res = Math.max(25, (40075016 * Math.cos(a)) / (2 ** demZoom * 256));
    return Math.max(0, h0 + earthDetail([Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)], h0, 0.5, res)) + sea(lat, lon);
  };
  const excluded = (lat: number, lon: number) => sceneryExcluded(lat, lon, q.exclusions);
  const prims: Primitive[] = [];
  // (the forest's grid: its bytes held from the start — the networks' and buildings' budgets after it)
  const reach = radius + 250;
  const ff = forestFrame(q.lat, q.lon, reach, (lat, lon) => localPoint(frame, lat, lon, 0));
  let storedBytes = 64 + pixels.byteLength + forestVec4s(ff) * 16,
    budgetLimited = false;
  let trees = 0,
    buildings = 0,
    vertices = 0;
  let bridges = 0,
    bridgePiers = 0;
  const surfaces: Primitive[] = [];
  const bridgeLines: { line: { lat: number; lon: number }[]; width: number; layer: number; d: number; water: boolean }[] = [];
  const bridgeAreas: { rings: { lat: number; lon: number }[][]; footprint: Primitive; layer: number; d: number }[] = [];
  const osmLayers: NonNullable<SceneryReply["osmLayers"]> = {};
  const surfaceDistance = (p: Primitive) => Math.hypot(Math.max(p.min[0], 0, -p.max[0]), Math.max(p.min[1], 0, -p.max[1]));
  // All source layers/fields remain inspectable in telemetry. Only physical geometry is rendered.
  const readNetworks = (layers: VectorTile["layers"], x: number, y: number) => {
    for (const [name, l] of Object.entries(layers)) {
      const entry = (osmLayers[name] ??= { features: 0, fields: [] });
      entry.features += l.length;
      const fields = new Set(entry.fields);
      for (let i = 0; i < l.length; i++) for (const field of Object.keys(l.feature(i).properties)) fields.add(field);
      entry.fields = [...fields].sort();
    }
    for (const name of ["water", "waterway", "transportation", "aeroway"]) {
      const l = layers[name];
      if (!l) continue;
      for (let i = 0; i < l.length; i++) {
        const f = l.feature(i),
          props = f.properties;
        if (props.brunnel === "tunnel" || props.indoor === 1 || Number(props.level) < 0) continue;
        const e = f.extent;
        const geo = (v: { x: number; y: number }) => ({
          lon: ((x + v.x / e) / 2 ** 14) * 360 - 180,
          lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + v.y / e)) / 2 ** 14))) / D,
        });
        const point = (v: { x: number; y: number }) => {
          const g0 = geo(v);
          return localPoint(frame, g0.lat, g0.lon, 0);
        };
        const cls = String(props.class ?? ""),
          subclass = String(props.subclass ?? "");
        const water = name === "water" || name === "waterway";
        if (f.type === 3 && (name === "water" || name === "aeroway" || name === "transportation")) {
          for (const rings of classifyRings(f.loadGeometry())) {
            const total = rings.reduce((sum, r) => sum + r.length, 0);
            if (total > 4096) {
              budgetLimited = true;
              continue;
            }
            const p = polygonPrimitive(
              rings.map((r) => r.map(point)),
              0,
              0,
              water ? 4 : 5,
              // (a river's polygon — OpenMapTiles' class — told from a lake's by its colour's blue: trace.wgsl sceneryWaterAt —
              // the material's inland water, a river's style or a lake's)
              water
                ? cls === "ocean"
                  ? OCEAN_COLOUR
                  : RIVER_CLASSES.has(cls)
                    ? RIVER_COLOUR
                    : [0.018, 0.052, 0.055]
                : [0.12, 0.12, 0.115],
            );
            if (p && surfaceDistance(p) <= radius + 500) {
              if (props.brunnel === "bridge" || cls === "bridge") {
                const outer = rings[0]!;
                const cx = outer.reduce((sum, v) => sum + v.x, 0) / outer.length,
                  cy = outer.reduce((sum, v) => sum + v.y, 0) / outer.length;
                if (cx >= 0 && cx < e && cy >= 0 && cy < e)
                  bridgeAreas.push({
                    rings: rings.map((r) => r.map(geo)),
                    footprint: p,
                    layer: Math.max(1, Math.min(5, Number(props.layer) || 1)),
                    d: surfaceDistance(p),
                  });
              } else surfaces.push(p);
            }
          }
        } else if (f.type === 2 && (name === "transportation" || name === "waterway")) {
          if (["ferry", "aerialway"].includes(cls)) continue;
          const rail =
            cls === "rail" ||
            cls === "transit" ||
            ["tram", "light_rail", "narrow_gauge", "monorail", "funicular", "preserved"].includes(subclass);
          const width = water
            ? cls === "river"
              ? 14
              : cls === "canal"
                ? 8
                : cls === "stream"
                  ? 3
                  : 1.5
            : roadWidth(rail ? "rail" : cls.replace("_construction", ""), subclass) * (props.ramp === 1 ? 0.65 : 1);
          const color = water
            ? [0.018, 0.052, 0.055]
            : rail
              ? [0.1, 0.085, 0.06]
              : props.surface === "unpaved" || cls === "track"
                ? [0.19, 0.145, 0.095]
                : [0.095, 0.098, 0.1];
          for (const line of f.loadGeometry()) {
            const locals = line.map(point);
            if (props.brunnel === "bridge") {
              // Buffered whole lines are owned by their midpoint's tile; omit duplicate volumes.
              const mid = line[Math.floor(line.length / 2)];
              if (mid && mid.x >= 0 && mid.x < e && mid.y >= 0 && mid.y < e && line.length < 512) {
                const d = Math.min(...locals.map((p) => Math.hypot(p[0], p[1])));
                if (d < radius + 250)
                  bridgeLines.push({ line: line.map(geo), width, layer: Math.max(1, Math.min(5, Number(props.layer) || 1)), d, water });
              }
              if (!water) continue; // Ground markings must not appear underneath a raised deck.
            }
            for (let j = 0; j < locals.length - 1; j++) {
              const a = locals[j]!,
                b = locals[j + 1]!,
                aa = line[j]!,
                bb = line[j + 1]!;
              const mx = (aa.x + bb.x) / 2,
                my = (aa.y + bb.y) / 2;
              if (mx < 0 || mx >= e || my < 0 || my >= e || Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.1) continue;
              const p = surfaceSegment(a, b, width, water ? 3 : rail ? 2 : 1, color);
              if (surfaceDistance(p) <= radius + 500) surfaces.push(p);
            }
          }
        }
      }
    }
    if (surfaces.length > 48000 * k2) {
      surfaces.sort((a, b) => surfaceDistance(a) - surfaceDistance(b));
      surfaces.length = Math.round(48000 * k2);
      budgetLimited = true;
    }
  };
  // Buildings use actual OSM footprints, all rings including courtyard holes.
  const n = 2 ** 14;
  const osm = osmTiles(q.lat, q.lon, bounds, k);
  if (osm.limited) budgetLimited = true;
  const limit = Math.round((q.mode === "high" ? 8000 : 5000) * k2);
  // (what the data say of a building: its height — the BD TOPO's to the eave, OSM's to the top —, its roof's measured height,
  // its storeys and materials, its use; roofs.ts plans its roof from them)
  type Attr = {
    top: boolean;
    roof: number | null;
    storeys: number | null;
    roofMat: RoofMaterial;
    wallMat: WallMaterial;
    usage?: string;
    nature?: string;
    light?: boolean;
    colour?: unknown;
    /** the roof's colour and shape as the data name them (Overture's roof_color, roof_shape…) */
    roofColour?: unknown;
    hint?: RoofInput["hint"];
  };
  type Choice = { geo: { lat: number; lon: number }[][]; lat: number; lon: number; h: number; low: number; d: number; a: Attr };
  const choices: Choice[] = [];
  const distance = (lat: number, lon: number) => Math.hypot((lat - q.lat) * 111320, wrapLon(lon - q.lon) * 111320 * Math.cos(q.lat * D));
  // ---- over France, the IGN's buildings (I5, bdtopo.ts): the BD TOPO's footprints and measured heights for OSM's, its z 15
  // tiles nearest first until the nearest `limit` buildings are in; OSM's kept only where a BD TOPO tile failed
  const bdKey = (lat: number, lon: number) => {
    const t = 2 ** BDTOPO_Z;
    return `${Math.floor(((lon + 180) / 360) * t)}/${Math.floor(((1 - Math.asinh(Math.tan(lat * D)) / Math.PI) / 2) * t)}`;
  };
  const surveyErrors: string[] = [];
  const region = regionOf(q.lat, q.lon);
  const bdtopoTiles = async () => {
    const out: Choice[] = [],
      covered = new Set<string>();
    let tileCount = 0;
    const want = bdtopoWanted(q.lat, q.lon, radius, k);
    const t = 2 ** BDTOPO_Z;
    const one = async (x: number, y: number) => {
      let raw: ArrayBuffer | null = null;
      for (let attempt = 0; attempt < 3 && !raw; attempt++)
        try {
          raw = await fetchCount(bdtopoUrl(x, y), surveyed);
        } catch (e) {
          // (a tile failed: OSM's buildings there — the scene not degraded for it)
          if (attempt === 2) {
            if (surveyErrors.length < 4) surveyErrors.push(String(e).slice(0, 320));
          } else await new Promise((done) => setTimeout(done, 1000 * 2 ** attempt));
        }
      if (!raw) return;
      covered.add(`${x}/${y}`);
      tileCount++;
      const layer = new VectorTile(new PbfReader(raw)).layers.batiment;
      if (!layer) return;
      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i);
        if (feature.type !== 3 || !bdtopoStands(feature.properties)) continue;
        const e = feature.extent,
          pr = feature.properties,
          h = bdtopoHeight(pr);
        // (the roof's measured height: its ridge less its eave, both over the sea — I5's `hauteur` is to the eave)
        const ridge = pr.altitude_maximale_toit,
          eave = pr.altitude_minimale_toit;
        const a: Attr = {
          top: false,
          roof: typeof ridge === "number" && typeof eave === "number" && ridge >= eave ? Math.min(30, ridge - eave) : null,
          storeys: typeof pr.nombre_d_etages === "number" && pr.nombre_d_etages > 0 ? pr.nombre_d_etages : null,
          roofMat: roofMaterial(pr.materiaux_de_la_toiture, region),
          wallMat: wallMaterial(pr.materiaux_des_murs),
          usage: typeof pr.usage_1 === "string" ? pr.usage_1 : undefined,
          nature: typeof pr.nature === "string" ? pr.nature : undefined,
          light: pr.construction_legere === true,
        };
        for (const rings of classifyRings(feature.loadGeometry())) {
          // (its part in this tile: the copy in the next one makes the rest)
          const clipped = rings.map((r) => clipRing(r, e));
          if (clipped[0]!.length < 4) continue;
          const geo = clipped
            .filter((r) => r.length >= 4)
            .map((r) =>
              r.map((v) => ({
                lon: ((x + v.x / e) / t) * 360 - 180,
                lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + v.y / e)) / t))) / D,
              })),
            );
          const outer = geo[0]!;
          // (a footprint of thousands of corners simplified within 256 — roofs.ts simplifyFootprint —, not left out)
          if (geo.reduce((s, r) => s + r.length, 0) > 8192) continue;
          const lat = outer.reduce((s, v) => s + v.lat, 0) / outer.length,
            lon = outer.reduce((s, v) => s + v.lon, 0) / outer.length;
          if (index(lat, lon) < 0 || excluded(lat, lon)) continue;
          out.push({ geo, lat, lon, h, low: 0, d: distance(lat, lon), a });
        }
      }
    };
    for (let k0 = 0; k0 < want.length; k0 += 4) {
      // (enough: the nearest `limit` closer than every tile left)
      if (out.length >= limit) {
        out.sort((a, b) => a.d - b.d);
        if (out[limit - 1]!.d < want[k0]!.d) break;
      }
      await Promise.all(want.slice(k0, k0 + 4).map((w) => one(w.x, w.y)));
    }
    return { out, covered, tileCount };
  };
  const bdtopo = survey === "ign" ? bdtopoTiles() : null;
  // ---- elsewhere, Overture Maps' buildings near the centre (B7, pmtiles.ts): OSM's with the ML footprints of Microsoft's
  // and Google's, their roofs' shapes, heights, colours and materials where mapped — a z 14 tile 0.5–1.6 MB, so within
  // OVERTURE_REACH_M alone; OSM's own buildings kept beyond, and where an Overture tile failed
  const fetchRanged = async (url: string, init: RequestInit) => {
    const r = await fetch(url, { ...init, signal });
    count(r);
    networkBytes += Number(r.headers.get("content-length")) || 0;
    return r;
  };
  const overtureTiles = async () => {
    const out: Choice[] = [],
      covered = new Set<string>();
    let tileCount = 0;
    let pm: PmTiles | null = null;
    try {
      const list = await fetch(OVERTURE_LIST, { signal });
      count(list);
      if (!list.ok) throw new Error(`HTTP ${list.status}: ${OVERTURE_LIST}`);
      // (the latest release whose archive answers: the bucket keeps three, the one a zone holds among them)
      for (const r of overtureReleases(await list.text())) {
        const p = new PmTiles(overtureUrl(r), fetchRange(fetchRanged));
        try {
          await p.header();
          pm = p;
          break;
        } catch (e) {
          if (surveyErrors.length < 4) surveyErrors.push(String(e).slice(0, 240));
        }
      }
    } catch (e) {
      if (surveyErrors.length < 4) surveyErrors.push(String(e).slice(0, 240));
    }
    if (!pm) return { out, covered, tileCount };
    const n14 = 2 ** OVERTURE_Z;
    const want = osm.tiles.filter((t) => t.d <= OVERTURE_REACH_M);
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const one = async (x: number, y: number) => {
      const raw = await pm!.tile(OVERTURE_Z, ((x % n14) + n14) % n14, y);
      covered.add(`${x}/${y}`);
      tileCount++;
      if (!raw) return;
      const layers = new VectorTile(new PbfReader(raw)).layers;
      // (a building with its parts in the tile: its parts drawn — a tower, a nave, a spire —, not its outline)
      const parted = new Set<string>();
      const part = layers.building_part;
      if (part) for (let i = 0; i < part.length; i++) parted.add(String(part.feature(i).properties.building_id));
      const add = (layer: (typeof layers)[string] | undefined, parts: boolean) => {
        if (!layer) return;
        for (let i = 0; i < layer.length; i++) {
          const feature = layer.feature(i);
          const pr = feature.properties;
          if (feature.type !== 3 || pr.is_underground === true) continue;
          if (!parts && pr.has_parts === true && parted.has(String(pr.id))) continue;
          for (const rings of classifyRings(feature.loadGeometry())) {
            const e = feature.extent;
            const centre = rings[0];
            if (!centre?.length) continue;
            const cx = centre.reduce((t, v) => t + v.x, 0) / centre.length,
              cy = centre.reduce((t, v) => t + v.y, 0) / centre.length;
            if (cx < 0 || cx >= e || cy < 0 || cy >= e) continue;
            const geo = rings.map((r) =>
              r.map((v) => ({
                lon: ((x + v.x / e) / n14) * 360 - 180,
                lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + v.y / e)) / n14))) / D,
              })),
            );
            const outer = geo[0]!;
            if (geo.reduce((t, r) => t + r.length, 0) > 8192) continue;
            const lat = outer.reduce((t, v) => t + v.lat, 0) / outer.length,
              lon = outer.reduce((t, v) => t + v.lon, 0) / outer.length;
            if (index(lat, lon) < 0 || excluded(lat, lon)) continue;
            const floors = num(pr.num_floors);
            const top = Math.min(500, Math.max(2, num(pr.height) ?? (floors !== null ? floors * 3.2 + 1 : 6)));
            const low = Math.min(top - 1, Math.max(0, num(pr.min_height) ?? (num(pr.min_floor) ?? 0) * 3.2));
            // (a measured roof: the walls under it, the roof its own — as the BD TOPO's —; else OSM's way, all to the top)
            const rh = num(pr.roof_height);
            const measured = rh !== null && rh > 0 && rh < top - low - 1;
            const shape = overtureShape(pr.roof_shape);
            out.push({
              geo,
              lat,
              lon,
              h: measured ? top - rh! : top,
              low,
              d: distance(lat, lon),
              a: {
                top: !measured,
                roof: measured ? rh! : null,
                storeys: floors,
                roofMat: overtureRoofMaterial(pr.roof_material),
                wallMat: overtureWallMaterial(pr.facade_material),
                colour: pr.facade_color,
                roofColour: pr.roof_color,
                hint: shape
                  ? { shape, across: pr.roof_orientation === "across", direction: num(pr.roof_direction) ?? undefined }
                  : undefined,
              },
            });
          }
        }
      };
      add(layers.building, false);
      add(part, true);
    };
    for (let k0 = 0; k0 < want.length; k0 += 4)
      await Promise.all(
        want.slice(k0, k0 + 4).map((w) =>
          one(w.x, w.y).catch((e) => {
            // (a tile failed: OSM's buildings there — the scene not degraded for it)
            covered.delete(`${w.x}/${w.y}`);
            if (surveyErrors.length < 4) surveyErrors.push(String(e).slice(0, 240));
          }),
        ),
      );
    return { out, covered, tileCount };
  };
  const overture = !bdtopo && q.overture ? overtureTiles() : null;
  const osmChoices: Choice[] = [];
  for (const { x, y } of osm.tiles) {
    try {
      const raw = await fetchCount(osmUrl(x, y));
      const layers = new VectorTile(new PbfReader(raw)).layers;
      readNetworks(layers, x, y);
      const layer = layers.building;
      if (!layer) continue;
      // (with the BD TOPO's, OSM's set aside: kept where it failed)
      const into = bdtopo || overture ? osmChoices : choices;
      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i);
        if (feature.type !== 3 || feature.properties.hide_3d === true) continue;
        // Low-zoom tiles group many disconnected buildings with identical heights into one feature.
        for (const rings of classifyRings(feature.loadGeometry())) {
          const e = feature.extent;
          const centre = rings[0];
          if (!centre?.length) continue;
          const cx = centre.reduce((s, v) => s + v.x, 0) / centre.length,
            cy = centre.reduce((s, v) => s + v.y, 0) / centre.length;
          if (cx < 0 || cx >= e || cy < 0 || cy >= e) continue; // Discard buffered copies owned by an adjacent tile.
          const geo = rings.map((r) =>
            r.map((v) => ({
              lon: ((x + v.x / e) / n) * 360 - 180,
              lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + v.y / e)) / n))) / D,
            })),
          );
          const outer = geo[0];
          if (!outer?.length || geo.reduce((s, r) => s + r.length, 0) > 8192) continue;
          const lat = outer.reduce((s, v) => s + v.lat, 0) / outer.length,
            lon = outer.reduce((s, v) => s + v.lon, 0) / outer.length;
          if (index(lat, lon) < 0 || excluded(lat, lon)) continue;
          const h = Math.min(500, Math.max(2, Number(feature.properties.render_height) || 6));
          const low = Math.min(h - 1, Math.max(0, Number(feature.properties.render_min_height) || 0));
          into.push({
            geo,
            lat,
            lon,
            h,
            low,
            d: distance(lat, lon),
            a: {
              top: true,
              roof: null,
              storeys: null,
              roofMat: RoofMaterial.Unknown,
              wallMat: WallMaterial.Unknown,
              colour: feature.properties.colour,
            },
          });
        }
      }
      choices.sort((a, b) => a.d - b.d);
      if (choices.length > limit) {
        choices.length = limit;
        budgetLimited = true;
      }
    } catch (e) {
      errors.push(String(e).slice(0, 220));
    }
  }
  let bdtopoBuildings = 0,
    bdtopoTileCount = 0;
  if (bdtopo) {
    const b = await bdtopo;
    bdtopoTileCount = b.tileCount;
    // (one by one: Paris's tens of thousands would overflow a spread's arguments)
    for (const v of b.out) choices.push(v);
    for (const v of osmChoices) if (!b.covered.has(bdKey(v.lat, v.lon))) choices.push(v);
    choices.sort((a, b) => a.d - b.d);
    if (choices.length > limit) {
      choices.length = limit;
      budgetLimited = true;
    }
    bdtopoBuildings = choices.filter((v) => b.covered.has(bdKey(v.lat, v.lon))).length;
  }
  let overtureBuildings = 0,
    overtureTileCount = 0;
  if (overture) {
    const o = await overture;
    overtureTileCount = o.tileCount;
    const z14 = (lat: number, lon: number) =>
      `${Math.floor(((lon + 180) / 360) * 2 ** OVERTURE_Z)}/${Math.floor(((1 - Math.asinh(Math.tan(lat * D)) / Math.PI) / 2) * 2 ** OVERTURE_Z)}`;
    for (const v of o.out) choices.push(v);
    for (const v of osmChoices) if (!o.covered.has(z14(v.lat, v.lon))) choices.push(v);
    choices.sort((a, b) => a.d - b.d);
    if (choices.length > limit) {
      choices.length = limit;
      budgetLimited = true;
    }
    overtureBuildings = choices.filter((v) => o.covered.has(z14(v.lat, v.lon))).length;
  }
  // Estimated bridge elevation is explicit: tile data provides layer, not surveyed deck/pier geometry.
  bridgeLines.sort((a, b) => a.d - b.d);
  const bridgeLimit = Math.round((q.mode === "high" ? 256 : 128) * k2);
  if (bridgeLines.length + bridgeAreas.length > bridgeLimit) budgetLimited = true;
  // (a bridge's part with its triangles — a flat-topped prism, buildingMesh's —: the trees' and buildings' shadow map draws it
  // as it is, whatever its outline — a deck's OSM area, a strip —, scenery-raster.ts; the view leaves it to the tracer's test)
  const addSolid = (p: Primitive | null, rings?: number[][][]) => {
    const mesh =
      p && rings
        ? buildingMesh(
            rings.map((r) => r.map((v) => [v[0]!, v[1]!] as [number, number])),
            p.data[0]!,
            p.data[0]!,
            [[0, 0, p.data[1]! - p.data[0]!]],
          )
        : null;
    const meshB = mesh ? mesh.positions.length * 4 + mesh.triangles.length * 4 : 0;
    if (!p || storedBytes + 64 + p.data.length * 4 + meshB > budget - 6 * 1024 * 1024 * room) {
      budgetLimited = true;
      return false;
    }
    if (mesh && mesh.triangles.length) p.mesh = mesh;
    prims.push(p);
    storedBytes += 64 + p.data.length * 4 + meshB;
    return true;
  };
  const selectedAreas: Primitive[] = [];
  bridgeAreas.sort((a, b) => a.d - b.d);
  for (const v of bridgeAreas.slice(0, bridgeLimit)) {
    try {
      const outer = v.rings[0]!;
      const lat = outer.reduce((sum, p) => sum + p.lat, 0) / outer.length,
        lon = outer.reduce((sum, p) => sum + p.lon, 0) / outer.length;
      // (its deck over its banks — the highest of its outline's ground, as a bridge line's —, not over the water at its middle:
      // a deck 4 m over the river, under its quays, its shadow hidden beneath it)
      let base = localPoint(frame, lat, lon, await height(lat, lon))[2];
      const step = Math.max(1, Math.floor(outer.length / 16));
      for (let i = 0; i < outer.length; i += step)
        base = Math.max(base, localPoint(frame, outer[i]!.lat, outer[i]!.lon, await height(outer[i]!.lat, outer[i]!.lon))[2]);
      const rings = v.rings.map((r) => r.map((at) => localPoint(frame, at.lat, at.lon, 0)));
      const p = polygonPrimitive(rings, base + 4 * v.layer - 1.2, base + 4 * v.layer, 2, [0.095, 0.098, 0.1]);
      if (addSolid(p, rings)) {
        bridges++;
        selectedAreas.push(v.footprint);
      }
    } catch (e) {
      if (!errors.length) errors.push(String(e).slice(0, 220));
    }
  }
  for (const v of bridgeLines) {
    if (bridges >= bridgeLimit) break;
    try {
      const mid = v.line[Math.floor(v.line.length / 2)]!;
      const at = localPoint(frame, mid.lat, mid.lon, 0);
      if (selectedAreas.some((p) => surfaceContains(at, p))) continue;
      const points = [];
      for (const at of v.line) points.push(localPoint(frame, at.lat, at.lon, await height(at.lat, at.lon)));
      const top = Math.max(...points.map((p) => p[2])) + 4 * v.layer;
      let made = false,
        distance = 0;
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!,
          b = points[i + 1]!,
          length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length < 0.5) continue;
        made =
          addSolid(
            polygonPrimitive(
              [stripPolygon(a, b, v.width)],
              top - 1.2,
              top,
              v.water ? 4 : 2,
              v.water ? [0.018, 0.052, 0.055] : [0.095, 0.098, 0.1],
            ),
          ) || made;
        for (const side of [-1, 1])
          addSolid(polygonPrimitive([stripPolygon(a, b, 0.28, (side * v.width) / 2)], top, top + 1, 3, [0.28, 0.27, 0.25]));
        // Generic piers every 40 m, excluding the short spans. Anchored below the filtered DEM.
        for (let d = 20 - (distance % 40); d < length; d += 40) {
          if (d < 2 || d > length - 2) continue;
          const t = d / length,
            p: [number, number, number] = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
          if (
            addSolid(
              polygonPrimitive(
                [stripPolygon([p[0] - 1, p[1], 0], [p[0] + 1, p[1], 0], Math.min(3, v.width * 0.5))],
                p[2] - 5,
                top - 1.2,
                3,
                [0.27, 0.26, 0.24],
              ),
            )
          )
            bridgePiers++;
        }
        distance += length;
      }
      if (made) bridges++;
    } catch (e) {
      if (!errors.length) errors.push(String(e).slice(0, 220));
    }
  }
  // Reserve the planar network before vegetation; analytic distance tests keep even narrow paths sharp.
  surfaces.sort((a, b) => surfaceDistance(a) - surfaceDistance(b));
  const surfaceLimit = Math.round((q.mode === "high" ? 24000 : 16000) * k2);
  if (surfaces.length > surfaceLimit) {
    surfaces.length = surfaceLimit;
    budgetLimited = true;
  }
  const keptSurfaces: Primitive[] = [];
  for (const v of surfaces) {
    const bytes = 64 + v.data.length * 4;
    if (storedBytes + bytes > budget - 4 * 1024 * 1024 * room) {
      budgetLimited = true;
      continue;
    }
    keptSurfaces.push(v);
    storedBytes += bytes;
  }
  const surfaceCells = new Map<string, Primitive[]>();
  for (const v of [...keptSurfaces, ...prims.filter((p) => p.data[3] === 2 || p.data[3] === 4)]) {
    for (let y = Math.floor((v.min[1] - 7) / 64); y <= Math.floor((v.max[1] + 7) / 64); y++)
      for (let x = Math.floor((v.min[0] - 7) / 64); x <= Math.floor((v.max[0] + 7) / 64); x++) {
        const key = `${x}:${y}`,
          cell = surfaceCells.get(key) ?? [];
        cell.push(v);
        surfaceCells.set(key, cell);
      }
  }
  const networkExcluded = (lat: number, lon: number) => {
    const p = localPoint(frame, lat, lon, 0);
    return surfaceCells.get(`${Math.floor(p[0] / 64)}:${Math.floor(p[1] / 64)}`)?.some((v) => surfaceContains(p, v, 7)) ?? false;
  };
  // ---- the forests: at most one tree a cell of the world-fixed grid (forest.ts), decided here once —
  // the same tree at the same place whichever scenery holds it (the class, the roads, the ground at its foot)
  // (the survey's canopy holds the buildings too — its surface less its ground —: none of its trees in an OSM footprint)
  const houses = new Map<string, Primitive[]>();
  if (land) {
    await landReady;
    for (const v of choices) {
      const p = polygonPrimitive(
        v.geo.map((r) => r.map((at) => localPoint(frame, at.lat, at.lon, 0))),
        0,
        1,
        1,
        [0, 0, 0],
      );
      if (!p) continue;
      for (let y = Math.floor((p.min[1] - 2) / 32); y <= Math.floor((p.max[1] + 2) / 32); y++)
        for (let x = Math.floor((p.min[0] - 2) / 32); x <= Math.floor((p.max[0] + 2) / 32); x++) {
          const key = `${x}:${y}`;
          const cell = houses.get(key) ?? [];
          cell.push(p);
          houses.set(key, cell);
        }
    }
  }
  const housed = (lat: number, lon: number) => {
    if (!houses.size) return false;
    const p = localPoint(frame, lat, lon, 0);
    return houses.get(`${Math.floor(p[0] / 32)}:${Math.floor(p[1] / 32)}`)?.some((v) => surfaceContains(p, v, 1.5)) ?? false;
  };
  const grown = await growForest(ff, {
    cover: (lat, lon) => {
      const k = index(lat, lon);
      return k < 0 ? 0 : classes[k]!;
    },
    excluded: (lat, lon) => excluded(lat, lon) || networkExcluded(lat, lon) || housed(lat, lon),
    canopy: land instanceof IgnLand ? (lat, lon, r) => land.canopyNear(lat, lon, r) : undefined,
    ground: height,
    sea,
    local: (lat, lon, h) => localPoint(frame, lat, lon, h),
    error: (e) => void (errors.length < 12 && errors.push(String(e).slice(0, 220))),
  });
  const cells = grown.cells;
  const shapes: Record<string, number> = {};
  trees = grown.trees;
  const surveyedTrees = grown.surveyed;
  // Select individual buildings by distance, so a dense tile cannot consume the budget before closer neighbours.
  // (their footprints in the scene's metres first — the party walls are found among them all —, then each roof planned
  // — roofs.ts —, packed with its planes, and the nearer ones' meshes for the raster — roof-mesh.ts)
  const local = choices.map((v) =>
    v.geo.map((ring) => ring.slice(0, -1).map((at) => localPoint(frame, at.lat, at.lon, 0).slice(0, 2) as Pt)),
  );
  const party = partyEdges(local);
  // (the bytes before the buildings: the forest, the land cover's raster, the networks, the bridges)
  const bytesBefore = storedBytes;
  let meshBytes = 0,
    meshed = 0;
  const meshBudget = budget / 4;
  // (in two passes within the budget: every building first as one leaf — a complex outline's roof flat —, the nearest
  // first until the budget is spent: the count as before; then the nearer ones' detail — their outlines cut into convex
  // parts each with its roof, their triangles for the shadow map — nearest first, while it fits)
  // (a terrace — a building flat whole, not a shed nor a hut —: its parapet round its roof)
  const parapetOf = (v: Choice, plans: RoofPart[]) =>
    plans.length === 1 && plans[0]!.shape === "flat" && !v.a.light && v.a.usage !== "Annexe" && plans[0]!.wall > 4;
  type Planned = {
    i: number;
    base: number;
    seed: number;
    input: RoofInput;
    plans: RoofPart[];
    mesh: (Primitive["mesh"] | undefined)[];
    bytes: number;
  };
  const room4 = budget - 4 * 1024 * 1024 * room;
  const leafBytes = (plans: RoofPart[]) =>
    plans.reduce((t, p) => t + 112 + p.rings.reduce((e, r) => e + r.length, 0) * 16 + 16 + p.planes.length * 16, 0);
  // (B6: a BD TOPO roof without its ridge — Paris's — measured by the IGN's canopy model, its surface over its ground
  // (I4: ~3 m a texel within CANOPY_NEAR, a texel the mean over it): its footprint's inner points, 1.5 m in from its walls,
  // the 85th percentile of their heights its top — the roof the eave's to it; a measure of fewer than six points none)
  const lidarRoof = (rings: Pt[][], lat: number, lon: number, eave: number): number | null => {
    if (!(land instanceof IgnLand)) return null;
    const outer = rings[0]!;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const [x, y] of outer) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const [cx, cy] = localPoint(frame, lat, lon, 0);
    const step = Math.max(1.5, Math.max(x1 - x0, y1 - y0) / 7);
    const inside = (x: number, y: number) => {
      let c = false,
        near = Infinity;
      for (const r of rings)
        for (let k = 0, j = r.length - 1; k < r.length; j = k++) {
          const a = r[k]!,
            b = r[j]!;
          if (a[1] > y !== b[1] > y && x < a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) c = !c;
          const dx = b[0] - a[0],
            dy = b[1] - a[1];
          const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
          near = Math.min(near, Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy));
        }
      return c && near > 1.5;
    };
    const hs: number[] = [];
    for (let y = y0 + step / 2; y < y1; y += step)
      for (let x = x0 + step / 2; x < x1; x += step) {
        if (!inside(x, y)) continue;
        const h = land.canopy(lat + (y - cy) / 111320, lon + (x - cx) / (111320 * Math.cos(lat * D)));
        if (Number.isFinite(h) && h < 50) hs.push(h);
      }
    if (hs.length < 6) return null;
    hs.sort((p, q) => p - q);
    const top = hs[Math.floor(0.85 * (hs.length - 1))]!;
    const roof = top - eave;
    return roof > 0.8 && roof < 12 ? roof : roof <= 0.8 && roof > -2 ? 0 : null;
  };
  let lidarRoofs = 0;
  const planned: Planned[] = [];
  for (const [i, v] of choices.entries()) {
    try {
      const { lat, lon, h, low, a } = v;
      const rings = local[i]!.filter((r) => r.length >= 3);
      if (!rings.length) continue;
      const base = localPoint(frame, lat, lon, await height(lat, lon))[2];
      const s = seed(Math.round(lat * 1e5), Math.round(lon * 1e5));
      // (its ridge measured by the LiDAR where the BD TOPO has none — the near ones)
      let roofH = a.roof;
      if (roofH === null && !a.top && v.d < CANOPY_NEAR) {
        roofH = lidarRoof(rings, lat, lon, h);
        if (roofH !== null) lidarRoofs++;
      }
      const input: RoofInput = {
        rings,
        party: party[i]![0],
        height: h - low,
        top: a.top,
        roof: roofH,
        storeys: a.storeys,
        roofMat: a.roofMat,
        wallMat: a.wallMat,
        usage: a.usage,
        nature: a.nature,
        light: a.light,
        region,
        seed: s,
        hint: a.hint,
      };
      const plans = planBuilding(input, 1);
      const bytes = leafBytes(plans);
      if (storedBytes + bytes > room4) {
        budgetLimited = true;
        break;
      }
      storedBytes += bytes;
      planned.push({ i, base, seed: s, input, plans, mesh: [], bytes });
    } catch (e) {
      if (!errors.length) errors.push(String(e).slice(0, 220));
    }
  }
  for (const b of planned) {
    const v = choices[b.i]!;
    if (v.d >= BUILDING_MESH_M && v.d >= BUILDING_PARTS_M) break;
    try {
      const floor = b.base + v.low,
        bottom = b.base + v.low - 1;
      const plans = v.d < BUILDING_PARTS_M ? planBuilding(b.input, 24) : b.plans;
      const bytes = leafBytes(plans);
      const mesh =
        v.d < BUILDING_MESH_M && meshBytes < meshBudget
          ? plans.map((p) => buildingMesh(p.rings, bottom, floor, p.planes, parapetOf(v, plans) ? PARAPET_M : 0))
          : [];
      const mb = mesh.reduce((t, m) => t + m.positions.length * 4 + (m.triangles.length / 3) * 12, 0);
      if (storedBytes + bytes - b.bytes + mb > room4) continue;
      storedBytes += bytes - b.bytes + mb;
      meshBytes += mb;
      b.plans = plans;
      b.bytes = bytes;
      b.mesh = mesh.map((m) => (m.triangles.length ? m : undefined));
    } catch (e) {
      if (!errors.length) errors.push(String(e).slice(0, 220));
    }
  }
  // (the chimneys' brick, weathered; their count)
  const stackColour = wallColour(WallMaterial.Brick, region, 0.7);
  let stacks = 0;
  for (const b of planned) {
    const v = choices[b.i]!;
    const a = v.a;
    const floor = b.base + v.low,
      bottom = b.base + v.low - 1;
    const wall = osmColour(a.colour) ?? wallColour(a.wallMat, region, b.seed);
    const roof = osmColour(a.roofColour) ?? roofColour(b.plans[0]!.roofMat, region, (b.seed * 7.31) % 1);
    for (const [k, plan] of b.plans.entries()) {
      const edges: number[] = [];
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const ring of plan.rings)
        for (let j = 0; j < ring.length; j++) {
          const p = ring[j]!,
            n = ring[(j + 1) % ring.length]!;
          edges.push(p[0], p[1], n[0], n[1]);
          minX = Math.min(minX, p[0]);
          maxX = Math.max(maxX, p[0]);
          minY = Math.min(minY, p[1]);
          maxY = Math.max(maxY, p[1]);
        }
      const mesh = b.mesh[k];
      const lip = parapetOf(v, b.plans) ? PARAPET_M : 0;
      prims.push({
        min: [minX, minY, bottom],
        max: [maxX, maxY, floor + plan.top + lip],
        data: [
          bottom,
          floor + plan.top + lip,
          edges.length / 4,
          1,
          minX,
          minY,
          maxX,
          maxY,
          ...wall,
          buildingPacked(plan.roofMat, a.wallMat, plan.storeys, plan.planes.length, plan.shape, !!mesh, lip > 0),
          ...edges,
          ...roof,
          floor + plan.wall,
          ...plan.planes.flatMap(([pa, pb, pc]) => [pa, pb, pc + floor, 0]),
        ],
        mesh,
      });
      shapes[plan.shape] = (shapes[plan.shape] ?? 0) + 1;
      vertices += edges.length / 4;
      if (mesh) meshed++;
      // (its chimneys near the camera — B9 —: a leaf a stack, its render's or brick's colour, no window)
      if (v.d < STACKS_M && storedBytes + 400 < room4)
        for (const st of stacksOf(plan, (b.seed * 13.7 + k * 0.31) % 1, plan.shape === "mansard")) {
          const se: number[] = [];
          for (let j = 0; j < 4; j++) se.push(st.ring[j]![0], st.ring[j]![1], st.ring[(j + 1) % 4]![0], st.ring[(j + 1) % 4]![1]);
          const xs = st.ring.map((p) => p[0]),
            ys = st.ring.map((p) => p[1]);
          const sb = floor + plan.top - 1.5;
          prims.push({
            min: [Math.min(...xs), Math.min(...ys), sb],
            max: [Math.max(...xs), Math.max(...ys), floor + st.top],
            data: [
              sb,
              floor + st.top,
              4,
              1,
              Math.min(...xs),
              Math.min(...ys),
              Math.max(...xs),
              Math.max(...ys),
              ...stackColour,
              buildingPacked(RoofMaterial.Concrete, WallMaterial.Brick, 1, 1, "stack", false),
              ...se,
              0.12,
              0.11,
              0.1,
              floor + st.top,
              0,
              0,
              floor + st.top,
              0,
            ],
          });
          storedBytes += 112 + 64 + 32;
          stacks++;
        }
    }
    buildings++;
  }
  const buffer = packScenery(prims, pixels, keptSurfaces, { frame: ff, cells, trees }, N, budget);
  return {
    id: q.id,
    lat: q.lat,
    lon: q.lon,
    bounds,
    buffer,
    trees,
    surveyedTrees,
    bdtopoBuildings,
    bdtopoTiles: bdtopoTileCount,
    overtureBuildings,
    overtureTiles: overtureTileCount,
    surveyRequests: land?.requests ?? 0,
    // (a block failed: its trees the land cover's — the scene not degraded for it)
    surveyError: land?.errors[0] ?? surveyErrors[0],
    forestCells: ff.w * ff.h,
    forestCellM: ff.cell,
    buildings,
    vertices,
    roofShapes: shapes,
    meshedBuildings: meshed,
    lidarRoofs,
    stacks,
    meshBytes,
    bytes: {
      forest: forestVec4s(ff) * 16,
      raster: pixels.byteLength,
      before: bytesBefore,
      buildings: storedBytes - bytesBefore - meshBytes,
      budget,
    },
    roads: keptSurfaces.filter((v) => v.data.length === 12 && v.data[5] === 1).length,
    railways: keptSurfaces.filter((v) => v.data.length === 12 && v.data[5] === 2).length,
    waterways: keptSurfaces.filter((v) => v.data.length === 12 && v.data[5] === 3).length,
    waterPolygons: keptSurfaces.filter((v) => v.data.length > 12 && v.data[3] === 4).length,
    pavedPolygons: keptSurfaces.filter((v) => v.data.length > 12 && v.data[3] === 5).length,
    bridges,
    bridgePiers,
    osmLayers,
    coverPixels: classes.reduce((s, v) => s + Number(v > 0), 0),
    rgbPixels,
    networkBytes,
    zoneResponses: served.zone,
    otherResponses: served.other,
    workerMs: performance.now() - started,
    errors: errors.slice(0, 12),
    budgetLimited,
  };
}
g.onmessage = async (e: MessageEvent<SceneryRequest>) => {
  try {
    const r = await prepare(e.data);
    g.postMessage(r, [r.buffer!]);
  } catch (e0) {
    g.postMessage({ id: e.data.id, lat: e.data.lat, lon: e.data.lon, error: String(e0).slice(0, 240) });
  }
};
