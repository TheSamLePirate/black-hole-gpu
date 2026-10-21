// The globe's Earth, photographed: NASA's Blue Marble (its shaded relief and bathymetry) by day and Black Marble (the
// cities' lights) by night, from GIBS (CORS, equirectangular, fetched once the globe is first shown). Drawn per pixel —
// the orthographic globe undone to a latitude and a longitude —, lit by the Sun where the pilot's simulator has it (the
// terminator, the night's lights), its limb darkened, its air's rim and glow. WebGPU when the device has it (the
// textures' mipmaps, sharp at any size); else the same imagery on the processor, a frame rendered when the view
// changes; else (offline, refused) nothing — the vector globe stays.

/** the imagery at two sizes: 2 048 pixels first (quick: the server draws them on demand), 4 096 then for WebGPU */
export const EARTH_DAY = (w: number) => wms("BlueMarble_ShadedRelief_Bathymetry", w, w / 2);
import { L } from "../lang";
export const EARTH_NIGHT = (w: number) => wms("VIIRS_Black_Marble", w, w / 2);
export const EARTH_CREDIT = () => L("Imagerie NASA Blue Marble · Black Marble (GIBS)", "NASA Blue Marble · Black Marble imagery (GIBS)");

function wms(layer: string, w: number, h: number) {
  return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${layer}&STYLES=&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=${w}&HEIGHT=${h}&FORMAT=image/jpeg`;
}

/** what the globe is drawn about: its centre [°], its radius and centre on the canvas [CSS px], the Sun's point [°] */
export interface GlobeView {
  lat: number;
  lon: number;
  R: number;
  cx: number;
  cy: number;
  sun: { lat: number; lon: number } | null;
}

const D = Math.PI / 180;
/** the view's axes on the Earth's: east, north, toward the eye (the orthographic globe's) */
function axes(lat: number, lon: number) {
  const p = lat * D,
    l = lon * D;
  return {
    ex: [-Math.sin(l), Math.cos(l), 0],
    ey: [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)],
    ez: [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)],
  };
}
const sunVec = (s: { lat: number; lon: number }) => [
  Math.cos(s.lat * D) * Math.cos(s.lon * D),
  Math.cos(s.lat * D) * Math.sin(s.lon * D),
  Math.sin(s.lat * D),
];

const WGSL = /* wgsl */ `
struct U { center: vec2f, radius: f32, sunOn: f32, ex: vec4f, ey: vec4f, ez: vec4f, sun: vec4f, tex: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var dayT: texture_2d<f32>;
@group(0) @binding(3) var nightT: texture_2d<f32>;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));
  return vec4f(p[i], 0.0, 1.0);
}

@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let q = (pos.xy - u.center) / u.radius;
  let r = length(q);
  let z = sqrt(max(0.0, 1.0 - r * r));
  // the point of the Earth under the pixel (view: x east, y north, z toward the eye)
  let n = normalize(u.ex.xyz * q.x - u.ey.xyz * q.y + u.ez.xyz * z);
  let lat = asin(clamp(n.z, -1.0, 1.0));
  let lon = atan2(n.y, n.x);
  let uv = vec2f(lon / 6.2831853 + 0.5, 0.5 - lat / 3.1415927);
  // (the texels a pixel covers, foreshortened toward the limb: the mip level — explicit, no seam at the antimeridian)
  let lod = clamp(log2(u.tex.x / (6.2831853 * u.radius * max(z, 0.06))), 0.0, u.tex.z);
  let day = textureSampleLevel(dayT, samp, uv, lod).rgb;
  let night = textureSampleLevel(nightT, samp, uv, lod).rgb;
  let d = dot(n, u.sun.xyz);
  let lit = select(1.0, smoothstep(-0.10, 0.12, d), u.sunOn > 0.5);
  let sunk = select(1.0, 0.28 + 0.9 * max(d, 0.0), u.sunOn > 0.5);
  var col = mix(night * 1.5 + vec3f(0.006, 0.010, 0.024), day * sunk, lit);
  col *= 0.52 + 0.48 * pow(z, 0.55);
  col += vec3f(0.16, 0.40, 0.95) * pow(1.0 - z, 2.4) * (0.2 + 0.8 * lit) * 0.75;
  // the air's glow off the limb, the edge antialiased
  let a = exp(-max(r - 1.0, 0.0) * 24.0) * 0.5 * (0.35 + 0.65 * lit);
  let glow = vec4f(vec3f(0.22, 0.52, 1.0) * a, a);
  let e = clamp((1.0 - r) * u.radius + 0.5, 0.0, 1.0);
  return mix(glow, vec4f(col, 1.0), e);
}
`;

/** a bitmap's mip chain (each level half the last, smoothed by the canvas) */
function mips(img: ImageBitmap): (HTMLCanvasElement | ImageBitmap)[] {
  const out: (HTMLCanvasElement | ImageBitmap)[] = [img];
  let w = img.width,
    h = img.height;
  let src: HTMLCanvasElement | ImageBitmap = img;
  while (w > 1 || h > 1) {
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const x = c.getContext("2d")!;
    x.imageSmoothingQuality = "high";
    x.drawImage(src, 0, 0, w, h);
    out.push(c);
    src = c;
  }
  return out;
}

class GlobeGpu {
  readonly canvas = document.createElement("canvas");
  private ctx: GPUCanvasContext;
  private uniforms: GPUBuffer;
  private group!: GPUBindGroup;
  private pipeline: GPURenderPipeline;
  private levels = 0;
  private constructor(
    private device: GPUDevice,
    day: ImageBitmap,
    night: ImageBitmap,
  ) {
    const format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx = this.canvas.getContext("webgpu") as GPUCanvasContext;
    this.ctx.configure({ device, format, alphaMode: "premultiplied" });
    const module = device.createShaderModule({ code: WGSL });
    this.pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });
    this.uniforms = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "clamp-to-edge",
      maxAnisotropy: 1,
    });
    this.setImages(day, night);
  }
  private sampler: GPUSampler;
  private width = 2048;
  /** the day's and the night's imagery given (again, sharper), their mip chains with them */
  setImages(day: ImageBitmap, night: ImageBitmap) {
    const device = this.device;
    const tex = (img: ImageBitmap) => {
      const chain = mips(img);
      const t = device.createTexture({
        size: [img.width, img.height],
        format: "rgba8unorm",
        mipLevelCount: chain.length,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      chain.forEach((level, mipLevel) =>
        device.queue.copyExternalImageToTexture({ source: level }, { texture: t, mipLevel }, [level.width, level.height]),
      );
      return { t, n: chain.length };
    };
    const d = tex(day),
      n = tex(night);
    this.levels = Math.min(d.n, n.n) - 1;
    this.width = day.width;
    this.group = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniforms } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: d.t.createView() },
        { binding: 3, resource: n.t.createView() },
      ],
    });
  }
  /** WebGPU's device, if this one has it (null: none, refused, or lost) */
  static async create(day: ImageBitmap, night: ImageBitmap): Promise<GlobeGpu | null> {
    try {
      const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
      const adapter = await gpu?.requestAdapter();
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      return new GlobeGpu(device, day, night);
    } catch {
      return null;
    }
  }
  /** the globe drawn to its canvas, `w`×`h` device pixels, the view in those pixels */
  render(w: number, h: number, v: GlobeView, dpr: number) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const a = axes(v.lat, v.lon);
    const s = v.sun ? sunVec(v.sun) : [0, 0, 1];
    const U = new Float32Array(28);
    U.set([v.cx * dpr, v.cy * dpr, v.R * dpr, v.sun ? 1 : 0]);
    U.set([...a.ex, 0], 4);
    U.set([...a.ey, 0], 8);
    U.set([...a.ez, 0], 12);
    U.set([...s, 0], 16);
    U.set([this.width, this.width / 2, this.levels, 0], 20);
    this.device.queue.writeBuffer(this.uniforms, 0, U);
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [
        { view: this.ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.group);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }
}

/** the same globe on the processor (no WebGPU): 2 048-pixel textures, a frame rendered when the view changes */
class GlobeCpu {
  readonly canvas = document.createElement("canvas");
  private day: ImageData;
  private night: ImageData;
  private key = "";
  private at = 0;
  constructor(day: ImageBitmap, night: ImageBitmap) {
    const read = (img: ImageBitmap) => {
      const c = document.createElement("canvas");
      c.width = 2048;
      c.height = 1024;
      const x = c.getContext("2d", { willReadFrequently: true })!;
      x.imageSmoothingQuality = "high";
      x.drawImage(img, 0, 0, 2048, 1024);
      return x.getImageData(0, 0, 2048, 1024);
    };
    this.day = read(day);
    this.night = read(night);
  }
  /** rendered anew at most every 120 ms while the view changes (its scale capped near a megapixel); true: fresh */
  render(w: number, h: number, v: GlobeView, dpr: number): boolean {
    const k = Math.min(1, Math.sqrt(1.1e6 / (w * h)));
    const W = Math.max(1, Math.round(w * k)),
      H = Math.max(1, Math.round(h * k));
    const key = [
      W,
      H,
      v.lat.toFixed(2),
      v.lon.toFixed(2),
      v.R.toFixed(1),
      v.cx.toFixed(0),
      v.cy.toFixed(0),
      v.sun?.lat.toFixed(1),
      v.sun?.lon.toFixed(1),
    ].join();
    const now = performance.now();
    if (key === this.key || (now - this.at < 120 && this.key)) return key === this.key;
    this.key = key;
    this.at = now;
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    const x = this.canvas.getContext("2d")!;
    const img = x.createImageData(W, H);
    const o = img.data,
      dd = this.day.data,
      nd = this.night.data;
    const a = axes(v.lat, v.lon);
    const s = v.sun ? sunVec(v.sun) : null;
    const sc = dpr * k;
    const cx = v.cx * sc,
      cy = v.cy * sc,
      R = v.R * sc;
    const y0 = Math.max(0, Math.floor(cy - R - 2)),
      y1 = Math.min(H, Math.ceil(cy + R + 2));
    const x0 = Math.max(0, Math.floor(cx - R - 2)),
      x1 = Math.min(W, Math.ceil(cx + R + 2));
    for (let py = y0; py < y1; py++) {
      const qy = (py + 0.5 - cy) / R;
      for (let px = x0; px < x1; px++) {
        const qx = (px + 0.5 - cx) / R;
        const r2 = qx * qx + qy * qy;
        if (r2 > 1) continue;
        const z = Math.sqrt(1 - r2);
        const nx = a.ex[0]! * qx - a.ey[0]! * qy + a.ez[0]! * z,
          ny = a.ex[1]! * qx - a.ey[1]! * qy + a.ez[1]! * z,
          nz = a.ex[2]! * qx - a.ey[2]! * qy + a.ez[2]! * z;
        const u = ((Math.atan2(ny, nx) / (2 * Math.PI) + 0.5) * 2048) | 0;
        const t = ((0.5 - Math.asin(Math.max(-1, Math.min(1, nz))) / Math.PI) * 1024) | 0;
        const i = (Math.min(1023, t) * 2048 + (u & 2047)) * 4;
        let lit = 1,
          sunk = 1;
        if (s) {
          const d = nx * s[0]! + ny * s[1]! + nz * s[2]!;
          const e = Math.max(0, Math.min(1, (d + 0.1) / 0.22));
          lit = e * e * (3 - 2 * e);
          sunk = 0.28 + 0.9 * Math.max(d, 0);
        }
        const limb = 0.52 + 0.48 * z ** 0.55,
          rim = (1 - z) ** 2.4 * (0.2 + 0.8 * lit) * 0.75 * 255;
        const j = (py * W + px) * 4;
        for (let c = 0; c < 3; c++) {
          const day = dd[i + c]! * sunk,
            night = nd[i + c]! * 1.5 + [1.5, 2.5, 6][c]!;
          o[j + c] = (night + (day - night) * lit) * limb + rim * [0.16, 0.4, 0.95][c]!;
        }
        o[j + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    return true;
  }
}

/** the globe's Earth: its imagery fetched once asked, its renderer the best this device has */
export class EarthGlobe {
  state: "idle" | "loading" | "ready" | "failed" = "idle";
  kind: "webgpu" | "cpu" | "" = "";
  private gpu: GlobeGpu | null = null;
  private cpu: GlobeCpu | null = null;
  constructor(private onReady: () => void) {}
  /** the imagery and the renderer, once (the globe's first showing) */
  start() {
    if (this.state !== "idle") return;
    this.state = "loading";
    const get = async (url: string) => {
      const r = await fetch(url, { mode: "cors" });
      if (!r.ok) throw new Error(String(r.status));
      return createImageBitmap(await r.blob());
    };
    void Promise.all([get(EARTH_DAY(2048)), get(EARTH_NIGHT(2048))])
      .then(async ([day, night]) => {
        this.gpu = await GlobeGpu.create(day, night);
        if (!this.gpu) this.cpu = new GlobeCpu(day, night);
        this.kind = this.gpu ? "webgpu" : "cpu";
        this.state = "ready";
        this.onReady();
        // (WebGPU: the 4 096-pixel imagery then, in the background — its mips keep it sharp zoomed in)
        if (this.gpu) {
          const [d4, n4] = await Promise.all([get(EARTH_DAY(4096)), get(EARTH_NIGHT(4096))]);
          this.gpu.setImages(d4, n4);
          this.sharp = true;
          this.onReady();
        }
      })
      .catch(() => {
        if (this.state !== "ready") this.state = "failed";
      });
  }
  /** the 4 096-pixel imagery in place (WebGPU) */
  sharp = false;
  /** the globe drawn into the 2D view's rectangle; false: not ready (the vector globe stands in) */
  draw(c: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }, v: GlobeView, dpr: number): boolean {
    if (this.state !== "ready") return false;
    const w = Math.max(1, Math.round(r.w * dpr)),
      h = Math.max(1, Math.round(r.h * dpr));
    const local: GlobeView = { ...v, cx: v.cx - r.x, cy: v.cy - r.y };
    if (this.gpu) {
      this.gpu.render(w, h, local, dpr);
      c.drawImage(this.gpu.canvas, r.x, r.y, r.w, r.h);
    } else if (this.cpu) {
      // (the air's glow, drawn here: the processor's image is the disc alone)
      const halo = c.createRadialGradient(v.cx, v.cy, v.R * 0.98, v.cx, v.cy, v.R * 1.09);
      halo.addColorStop(0, "#3f9cff70");
      halo.addColorStop(1, "#00000000");
      c.fillStyle = halo;
      c.beginPath();
      c.arc(v.cx, v.cy, v.R * 1.09, 0, Math.PI * 2);
      c.fill();
      this.cpu.render(w, h, local, dpr);
      c.imageSmoothingQuality = "high";
      c.drawImage(this.cpu.canvas, r.x, r.y, r.w, r.h);
    }
    return true;
  }
}
