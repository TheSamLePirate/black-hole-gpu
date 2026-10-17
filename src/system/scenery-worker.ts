// Worldwide data preparation is isolated from the render loop. No complete COG download.
import { VectorTile, classifyRings } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { earthDetail, toHalf } from "../terrain";
import { forestFrame, forestVec4s, growForest } from "./forest";
import { roadWidth, surfaceSegment, polygonPrimitive, stripPolygon, surfaceContains } from "./scenery-geometry";
import {
  D,
  localPoint,
  packScenery,
  sceneryFrame,
  sceneryGrid,
  SCENERY_BYTES,
  wrapLon,
  rasterParts,
  sceneryExcluded,
  type Primitive,
  type SceneryRequest,
  type SceneryReply,
} from "./scenery-data";

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
  const radius = (q.mode === "high" ? 3000 : 2000) * k,
    span = (radius + 650) / 111320;
  const lonSpan = span / Math.max(Math.cos(q.lat * D), 0.12);
  const bounds: [number, number, number, number] = [q.lon - lonSpan, q.lat - span, q.lon + lonSpan, q.lat + span];
  const frame = sceneryFrame(q.lat, q.lon),
    pixels = new Uint32Array(N * N),
    classes = new Uint8Array(N * N);
  let networkBytes = 0,
    rgbPixels = 0;
  const errors: string[] = [];
  const fetchCount = async (url: string) => {
    const r = await fetch(url, { signal });
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
  async function raster(rgb: boolean) {
    try {
      const layer = rgb ? "esa-worldcover-s2rgbnir-10m-2021-v2_tcc" : "esa-worldcover-map-10m-2021-v2_map";
      const canvas = new OffscreenCanvas(N, N),
        ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      for (const part of rasterParts(bounds, N)) {
        const query = new URLSearchParams({
          SERVICE: "WMS",
          VERSION: "1.1.1",
          REQUEST: "GetMap",
          LAYERS: layer,
          STYLES: "",
          SRS: "EPSG:4326",
          BBOX: part.bounds.join(","),
          WIDTH: String(part.width),
          HEIGHT: String(N),
          FORMAT: "image/png",
          TRANSPARENT: "TRUE",
        });
        const bytes = await fetchCount("https://mapproxy.terrascope.be/mapproxy/service?" + query);
        const image = await createImageBitmap(new Blob([bytes]), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
        ctx.drawImage(image, part.x, 0);
        image.close();
      }
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
  await raster(false);
  if (q.satellite) await raster(true);
  // Keep each DEM tile at least 1.8 km wide at high latitudes, bounding root-data memory.
  const demZoom = Math.min(13, Math.max(6, Math.floor(Math.log2((40075016 * Math.cos(q.lat * D)) / 1800))));
  const heights = new Map<string, Promise<Uint8ClampedArray>>();
  const height = async (lat: number, lon: number) => {
    const xx = tx(wrapLon(lon), demZoom),
      yy = ty(lat, demZoom),
      x = Math.floor(xx),
      y = Math.floor(yy),
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
    return Math.max(0, h0 + earthDetail([Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)], h0, 0.5, res));
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
              water ? [0.018, 0.052, 0.055] : [0.12, 0.12, 0.115],
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
  const z = 14,
    n = 2 ** z,
    urls: string[] = [];
  for (let y = Math.floor(ty(bounds[3])); y <= Math.floor(ty(bounds[1])); y++)
    for (let x = Math.floor(tx(bounds[0])); x <= Math.floor(tx(bounds[2])); x++) if (y >= 0 && y < n) urls.push(`${x}/${y}`);
  const tileDistance = (key: string) => {
    const [x, y] = key.split("/").map(Number);
    return (
      ((0.98 * 40075016 * Math.cos(q.lat * D)) / n) *
      Math.hypot(Math.max(x! - tx(q.lon), 0, tx(q.lon) - x! - 1), Math.max(y! - ty(q.lat), 0, ty(q.lat) - y! - 1))
    );
  };
  urls.sort((a, b) => tileDistance(a) - tileDistance(b));
  const tiles = Math.ceil(64 * k2);
  if (urls.length > tiles) budgetLimited = true;
  const limit = Math.round((q.mode === "high" ? 8000 : 5000) * k2);
  const choices: { geo: { lat: number; lon: number }[][]; lat: number; lon: number; h: number; low: number; d: number }[] = [];
  for (const key of urls.slice(0, tiles)) {
    try {
      const [x, y] = key.split("/").map(Number) as [number, number];
      const raw = await fetchCount(`https://tiles.openfreemap.org/planet/latest/14/${((x % n) + n) % n}/${y}.pbf`);
      const layers = new VectorTile(new PbfReader(raw)).layers;
      readNetworks(layers, x, y);
      const layer = layers.building;
      if (!layer) continue;
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
          if (!outer?.length || geo.reduce((s, r) => s + r.length, 0) > 256) continue;
          const lat = outer.reduce((s, v) => s + v.lat, 0) / outer.length,
            lon = outer.reduce((s, v) => s + v.lon, 0) / outer.length;
          if (index(lat, lon) < 0 || excluded(lat, lon)) continue;
          const h = Math.min(500, Math.max(2, Number(feature.properties.render_height) || 6));
          const low = Math.min(h - 1, Math.max(0, Number(feature.properties.render_min_height) || 0));
          const d = Math.hypot((lat - q.lat) * 111320, wrapLon(lon - q.lon) * 111320 * Math.cos(q.lat * D));
          choices.push({ geo, lat, lon, h, low, d });
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
  // Estimated bridge elevation is explicit: tile data provides layer, not surveyed deck/pier geometry.
  bridgeLines.sort((a, b) => a.d - b.d);
  const bridgeLimit = Math.round((q.mode === "high" ? 256 : 128) * k2);
  if (bridgeLines.length + bridgeAreas.length > bridgeLimit) budgetLimited = true;
  const addSolid = (p: Primitive | null) => {
    if (!p || storedBytes + 64 + p.data.length * 4 > budget - 6 * 1024 * 1024 * room) {
      budgetLimited = true;
      return false;
    }
    prims.push(p);
    storedBytes += 64 + p.data.length * 4;
    return true;
  };
  const selectedAreas: Primitive[] = [];
  bridgeAreas.sort((a, b) => a.d - b.d);
  for (const v of bridgeAreas.slice(0, bridgeLimit)) {
    try {
      const outer = v.rings[0]!;
      const lat = outer.reduce((sum, p) => sum + p.lat, 0) / outer.length,
        lon = outer.reduce((sum, p) => sum + p.lon, 0) / outer.length;
      const base = localPoint(frame, lat, lon, await height(lat, lon))[2];
      const p = polygonPrimitive(
        v.rings.map((r) => r.map((at) => localPoint(frame, at.lat, at.lon, 0))),
        base + 4 * v.layer - 1.2,
        base + 4 * v.layer,
        2,
        [0.095, 0.098, 0.1],
      );
      if (addSolid(p)) {
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
  const grown = await growForest(ff, {
    cover: (lat, lon) => {
      const k = index(lat, lon);
      return k < 0 ? 0 : classes[k]!;
    },
    excluded: (lat, lon) => excluded(lat, lon) || networkExcluded(lat, lon),
    ground: height,
    local: (lat, lon, h) => localPoint(frame, lat, lon, h),
    error: (e) => void (errors.length < 12 && errors.push(String(e).slice(0, 220))),
  });
  const cells = grown.cells;
  trees = grown.trees;
  // Select individual buildings by distance, so a dense tile cannot consume the budget before closer neighbours.
  for (const v of choices) {
    try {
      const { geo, lat, lon, h, low } = v;
      const base = localPoint(frame, lat, lon, await height(lat, lon))[2];
      const edges: number[] = [];
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const ring of geo)
        for (let j = 0; j < ring.length - 1; j++) {
          const a = localPoint(frame, ring[j]!.lat, ring[j]!.lon, 0),
            b = localPoint(frame, ring[j + 1]!.lat, ring[j + 1]!.lon, 0);
          edges.push(a[0], a[1], b[0], b[1]);
          minX = Math.min(minX, a[0], b[0]);
          maxX = Math.max(maxX, a[0], b[0]);
          minY = Math.min(minY, a[1], b[1]);
          maxY = Math.max(maxY, a[1], b[1]);
        }
      if (!edges.length) continue;
      const bytes = 112 + edges.length * 4;
      if (storedBytes + bytes > budget) {
        budgetLimited = true;
        continue;
      }
      storedBytes += bytes;
      prims.push({
        min: [minX, minY, base + low - 1],
        max: [maxX, maxY, base + h],
        data: [base + low - 1, base + h, edges.length / 4, 1, minX, minY, maxX, maxY, 0.38, 0.36, 0.32, 0, ...edges],
      });
      vertices += edges.length / 4;
      buildings++;
    } catch (e) {
      if (!errors.length) errors.push(String(e).slice(0, 220));
    }
  }
  const buffer = packScenery(prims, pixels, keptSurfaces, { frame: ff, cells, trees }, N, budget);
  return {
    id: q.id,
    lat: q.lat,
    lon: q.lon,
    bounds,
    buffer,
    trees,
    forestCells: ff.w * ff.h,
    forestCellM: ff.cell,
    buildings,
    vertices,
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
