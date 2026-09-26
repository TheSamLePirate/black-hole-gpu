// Saturn's maps for the tracer: its globe (equirectangular, sRGB, mip-mapped) and its rings' radial
// profile (sRGB colour + opacity, inner → outer edge, 69 800 – 140 900 km: the Cassini division and
// the A ring's outer edge fall where they should), both from assets/textures.

import saturnUrl from "../../assets/textures/saturn_daymap.jpg";
import ringUrl from "../../assets/textures/saturn_ring.png";

export interface PlanetMaps {
  globe: GPUTexture;
  rings: GPUTexture;
}

const levels = (w: number, h: number) => Math.floor(Math.log2(Math.max(w, h))) + 1;

async function bitmap(url: string, opts: ImageBitmapOptions = {}) {
  const blob = await (await fetch(url)).blob();
  return createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none", ...opts });
}

/** The globe, every mip level resampled from the full image by the browser. */
async function globeTexture(device: GPUDevice): Promise<GPUTexture> {
  const img = await bitmap(saturnUrl);
  const n = levels(img.width, img.height);
  const tex = device.createTexture({
    size: [img.width, img.height], format: "rgba8unorm", mipLevelCount: n,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  for (let l = 0; l < n; l++) {
    const w = Math.max(img.width >> l, 1), h = Math.max(img.height >> l, 1);
    const src = l === 0 ? img : await createImageBitmap(img, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
    device.queue.copyExternalImageToTexture({ source: src }, { texture: tex, mipLevel: l }, [w, h]);
  }
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

export async function loadPlanetMaps(device: GPUDevice): Promise<PlanetMaps> {
  const [globe, rings] = await Promise.all([globeTexture(device), ringTexture(device)]);
  return { globe, rings };
}
