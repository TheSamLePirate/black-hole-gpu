// The solar system's maps for the tracer (assets/planets, from the project's texture sets): the
// large ones (2048 × 1024) and the small ones (1024 × 512) in two mip-mapped texture arrays, each
// map's mean linear albedo measured (its body's albedo scales it), and Saturn's rings' radial profile
// (sRGB colour + opacity, inner → outer edge, 69 800 – 140 900 km: the Cassini division and the A
// ring's outer edge fall where they should).

import { MAPS_HI, MAPS_LO, type MapName } from "./solar";
import ringUrl from "../../assets/planets/saturn_ring.png";

import earth from "../../assets/planets/earth.jpg";
import moon from "../../assets/planets/moon.jpg";
import mars from "../../assets/planets/mars.jpg";
import mercury from "../../assets/planets/mercury.jpg";
import jupiter from "../../assets/planets/jupiter.jpg";
import saturn from "../../assets/planets/saturn.jpg";
import venus from "../../assets/planets/venus.jpg";
import ceres from "../../assets/planets/ceres.jpg";
import phobos from "../../assets/planets/phobos.jpg";
import deimos from "../../assets/planets/deimos.jpg";
import io from "../../assets/planets/io.jpg";
import europa from "../../assets/planets/europa.jpg";
import ganymede from "../../assets/planets/ganymede.jpg";
import callisto from "../../assets/planets/callisto.jpg";
import mimas from "../../assets/planets/mimas.jpg";
import enceladus from "../../assets/planets/enceladus.jpg";
import tethys from "../../assets/planets/tethys.jpg";
import dione from "../../assets/planets/dione.jpg";
import rhea from "../../assets/planets/rhea.jpg";
import titan from "../../assets/planets/titan.jpg";
import uranus from "../../assets/planets/uranus.jpg";
import neptune from "../../assets/planets/neptune.jpg";
import pluto from "../../assets/planets/pluto.jpg";

const URLS: Record<MapName, string> = {
  earth, moon, mars, mercury, jupiter, saturn, venus, ceres, phobos, deimos, io, europa, ganymede, callisto, mimas, enceladus,
  tethys, dione, rhea, titan, uranus, neptune, pluto,
};

export interface PlanetMaps {
  hi: GPUTexture;
  lo: GPUTexture;
  rings: GPUTexture;
  /** each map's mean albedo in linear rgb luminance (its body's albedo is divided by it) */
  mean: Map<MapName, number>;
}

const levels = (w: number, h: number) => Math.floor(Math.log2(Math.max(w, h))) + 1;
const lin = (c: number) => (c / 255) ** 2.2;

async function bitmap(url: string) {
  const blob = await (await fetch(url)).blob();
  return createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

/** A texture array of maps, every mip level resampled from the full image by the browser. */
async function mapArray(device: GPUDevice, names: MapName[], w: number, h: number, mean: Map<MapName, number>) {
  const n = levels(w, h);
  const tex = device.createTexture({
    size: [w, h, names.length], format: "rgba8unorm", mipLevelCount: n, dimension: "2d",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  await Promise.all(names.map(async (name, layer) => {
    const img = await bitmap(URLS[name]);
    for (let l = 0; l < n; l++) {
      const lw = Math.max(w >> l, 1), lh = Math.max(h >> l, 1);
      const src = await createImageBitmap(img, { resizeWidth: lw, resizeHeight: lh, resizeQuality: "high" });
      device.queue.copyExternalImageToTexture({ source: src }, { texture: tex, mipLevel: l, origin: [0, 0, layer] }, [lw, lh]);
      if (lw === 64) {
        // (its mean linear luminance, area-weighted: cos latitude)
        const cv = new OffscreenCanvas(lw, lh);
        const ctx = cv.getContext("2d")!;
        ctx.drawImage(src, 0, 0);
        const px = ctx.getImageData(0, 0, lw, lh).data;
        let sum = 0, wsum = 0;
        for (let y = 0; y < lh; y++) {
          const c = Math.cos(((y + 0.5) / lh - 0.5) * Math.PI);
          for (let x = 0; x < lw; x++) {
            const i = 4 * (y * lw + x);
            sum += c * (0.2126 * lin(px[i]!) + 0.7152 * lin(px[i + 1]!) + 0.0722 * lin(px[i + 2]!));
            wsum += c;
          }
        }
        mean.set(name, Math.max(sum / wsum, 1e-3));
      }
    }
  }));
  return tex;
}

/** The rings: the map's rows averaged into one radial profile, then box-filtered down (rgba8). */
async function ringTexture(device: GPUDevice): Promise<GPUTexture> {
  const img = await bitmap(ringUrl);
  const cv = new OffscreenCanvas(img.width, img.height);
  const ctx = cv.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, img.width, img.height).data;
  // (colour weighted by opacity, so the transparent texels' colour does not bleed in)
  let prof = new Float32Array(img.width * 4);
  for (let x = 0; x < img.width; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let y = 0; y < img.height; y++) {
      const i = 4 * (y * img.width + x);
      const w = px[i + 3]! / 255;
      r += px[i]! * w; g += px[i + 1]! * w; b += px[i + 2]! * w; a += w;
    }
    prof.set(a > 0 ? [r / a, g / a, b / a, (255 * a) / img.height] : [0, 0, 0, 0], 4 * x);
  }
  const n = levels(img.width, 1);
  const tex = device.createTexture({ size: [img.width, 1], format: "rgba8unorm", mipLevelCount: n, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  let w = img.width;
  for (let l = 0; l < n; l++) {
    const data = new Uint8Array(w * 4);
    for (let i = 0; i < w * 4; i++) data[i] = Math.round(Math.min(Math.max(prof[i]!, 0), 255));
    device.queue.writeTexture({ texture: tex, mipLevel: l }, data, { bytesPerRow: w * 4 }, [w, 1]);
    if (w === 1) break;
    const next = new Float32Array((w >> 1) * 4);
    for (let x = 0; x < w >> 1; x++) {
      const a0 = prof[8 * x + 3]!, a1 = prof[8 * x + 7]!;
      const sa = a0 + a1;
      for (let c = 0; c < 3; c++) next[4 * x + c] = sa > 0 ? (prof[8 * x + c]! * a0 + prof[8 * x + 4 + c]! * a1) / sa : 0;
      next[4 * x + 3] = 0.5 * sa;
    }
    prof = next;
    w >>= 1;
  }
  return tex;
}

/** Placeholder arrays (one black layer) until the maps are loaded. */
export function placeholderMaps(device: GPUDevice): PlanetMaps {
  const mk = (layers: number) => {
    const t = device.createTexture({ size: [1, 1, layers], format: "rgba8unorm", dimension: "2d", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    for (let l = 0; l < layers; l++) device.queue.writeTexture({ texture: t, origin: [0, 0, l] }, new Uint8Array([128, 128, 128, 255]), {}, [1, 1]);
    return t;
  };
  return { hi: mk(2), lo: mk(2), rings: mk(1), mean: new Map() };
}

export async function loadPlanetMaps(device: GPUDevice): Promise<PlanetMaps> {
  const mean = new Map<MapName, number>();
  const [hi, lo, rings] = await Promise.all([
    mapArray(device, MAPS_HI, 2048, 1024, mean),
    mapArray(device, MAPS_LO, 1024, 512, mean),
    ringTexture(device),
  ]);
  return { hi, lo, rings, mean };
}
