import type { App } from "./app";

/** two shots compared in the page: the mean absolute difference over RGB [0–255], the share of pixels apart by more than 8 and 24, and
 *  the difference ×4 as a PNG (base64) */
export async function diffShots(app: App, a: string, b: string, out: string) {
  const b64 = async (f: string) => Buffer.from(await Bun.file(f).arrayBuffer()).toString("base64");
  const r = await app.js<{ mean: number; over8: number; over24: number; png: string }>(`(async () => {
    const load = async (s) => createImageBitmap(await (await fetch("data:image/png;base64," + s)).blob());
    const A = await load(${JSON.stringify(await b64(a))}), B = await load(${JSON.stringify(await b64(b))});
    const W = A.width, H = A.height, read = (im) => { const c = new OffscreenCanvas(W, H), x = c.getContext("2d"); x.drawImage(im, 0, 0); return x.getImageData(0, 0, W, H).data; };
    const pa = read(A), pb = read(B), d = new Uint8ClampedArray(pa.length);
    let sum = 0, o8 = 0, o24 = 0;
    for (let i = 0; i < pa.length; i += 4) {
      const e = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
      sum += (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2])) / 3;
      if (e > 8) o8++; if (e > 24) o24++;
      d[i] = d[i + 1] = d[i + 2] = Math.min(255, 4 * e); d[i + 3] = 255;
    }
    const c = new OffscreenCanvas(W, H); c.getContext("2d").putImageData(new ImageData(d, W, H), 0, 0);
    const bytes = new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer());
    let s = ""; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
    const n = pa.length / 4;
    return { mean: +(sum / n).toFixed(3), over8: +(o8 / n).toFixed(5), over24: +(o24 / n).toFixed(5), png: btoa(s) };
  })()`);
  await Bun.write(out, Buffer.from(r.png, "base64"));
  return { mean: r.mean, over8: r.over8, over24: r.over24, heat: out };
}
