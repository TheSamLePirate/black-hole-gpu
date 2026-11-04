// The sea's water by region (T7; the coast survey of 4 Nov 2026: the Channel and the Mont-Saint-Michel's bay drawn as a clear
// tropical lagoon, the bed seen through 20 m of water): the diffuse attenuation of the light at 490 nm, Kd490 [1/m] — ESA's Ocean
// Colour CCI v6, the geometric mean of 2020–2021's months at 1/12° (scripts/build-water-kd.ts), the coasts' and the ice's cells
// given their nearest sea's —, the log of Kd over [KD_MIN, KD_MAX] on 8 bits, 4 320 × 2 160 from −180° and from 90° N.
// On the GPU in the tracer's table (gpu-tables.ts TABLE_WATER): a header (x 1 once in, the grid's size), then the cells three a
// float (b0 + 256 b1 + 65 536 b2: integers under 2²⁴, exact — no bit pattern a NaN or a denormal), twelve a vec4. trace.wgsl
// seaKd490 reads it; seaShade turns it into the water's attenuation by colour and its colour seen from above. Until it is in,
// seaKd490 reads 0: the clear water as before.

import url from "../../assets/earth/water-kd490.png";
import { WATER_H, WATER_W, waterTable } from "./water-kd-grid";

export { KD_MAX, KD_MIN, kdOfByte, WATER_H, WATER_VEC4S, WATER_W, waterCell, waterTable } from "./water-kd-grid";

let loading: Promise<Float32Array<ArrayBuffer>> | null = null;

/** The map, loaded once and packed for the table (its red channel: a grey PNG). */
export function loadWaterKd(get: (url: string) => Promise<Response> = (u) => fetch(u)): Promise<Float32Array<ArrayBuffer>> {
  loading ??= (async () => {
    const blob = await (await get(url)).blob();
    const img = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    if (img.width !== WATER_W || img.height !== WATER_H) throw new Error(`water-kd: ${img.width} × ${img.height}`);
    const cv = new OffscreenCanvas(img.width, img.height);
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, img.width, img.height).data;
    const bytes = new Uint8Array(WATER_W * WATER_H);
    for (let i = 0; i < bytes.length; i++) bytes[i] = px[4 * i]!;
    img.close();
    return waterTable(bytes);
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}
