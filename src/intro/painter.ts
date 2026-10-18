// The intro's pictures (PLAN-TITRE-AAA E1): the procedural background — a few layers of stars drifting, a faint
// galactic haze in the disk's amber and night blue, a warm light behind the title's mark (the black hole itself is
// that mark: the game's own, rendered — assets/title/kerr-mark.webp) — and the loading orb. Drawn in the
// intro's Worker (src/intro/worker.ts, on OffscreenCanvas: never held up by the main thread compiling), or in the
// page where there is no OffscreenCanvas. WebGL2 for the background; a 2D sky where there is none.

import { drawOrb, type OrbState } from "./orb";

type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

/** the background drawn at this share of the screen's pixels (soft by nature: a haze, a few stars) */
export const BG_SCALE = 0.5;
/** the background's frame rate cap: it drifts, nothing in it needs more */
const BG_FPS = 30;

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uT;
out vec4 o;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}
// one layer of stars: a few cells of a grid lit, each a soft point, its colour by its temperature
vec3 stars(vec2 p, float scale, float density) {
  vec2 g = p * scale, id = floor(g), f = fract(g) - 0.5;
  if (h21(id) > density) return vec3(0.0);
  vec2 off = vec2(h21(id + 3.1), h21(id + 7.7)) - 0.5;
  float d = length(f - off * 0.7);
  float mag = pow(h21(id + 1.3), 6.0);
  float sig = 0.03 + 0.045 * mag;
  float tw = 0.78 + 0.22 * sin(uT * (0.7 + 2.5 * h21(id + 5.0)) + h21(id) * 60.0);
  vec3 tint = mix(vec3(1.0, 0.86, 0.7), vec3(0.74, 0.84, 1.0), h21(id + 9.0));
  return tint * exp(-d * d / (2.0 * sig * sig)) * (0.3 + 1.4 * mag) * tw;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  // (the sky drifting slowly; the black hole itself is the title's mark — the game's own, rendered)
  vec2 src = p;
  vec2 drift = vec2(uT * 0.0016, uT * 0.0004);

  vec3 col = vec3(0.0);
  // the galaxy's band: a slow haze, the disk's amber where it thickens, night blue elsewhere
  vec2 q = src + drift * 2.0;
  float band = exp(-pow(dot(q, normalize(vec2(0.42, 1.0))) * 2.4, 2.0));
  float n = fbm(q * 1.6 + vec2(3.0, uT * 0.003));
  float n2 = fbm(q * 4.2 - vec2(uT * 0.002, 1.0));
  col += mix(vec3(0.018, 0.03, 0.075), vec3(0.2, 0.1, 0.035), smoothstep(0.45, 0.85, n)) * band * (0.4 + 0.9 * n * n2);
  col += vec3(0.006, 0.01, 0.022) * (0.5 + n);
  // the stars, three depths
  col += stars(src + drift, 70.0, 0.10) * 0.55;
  col += stars(src + drift * 1.8 + 11.3, 38.0, 0.07) * 0.8;
  col += stars(src + drift * 3.0 + 27.1, 22.0, 0.035) * 0.8;
  // a warm light behind the title's mark (the hero, above the centre)
  col += vec3(1.0, 0.55, 0.22) * 0.05 * exp(-length((p - vec2(0.0, 0.1)) * vec2(0.8, 1.6)) / 0.22);

  // the film: a vignette, a grain, a soft shoulder
  vec2 v = uv - 0.5;
  col *= 1.0 - 0.9 * dot(v, v);
  col = 1.0 - exp(-col * 1.35);
  col += (h21(gl_FragCoord.xy + fract(uT) * 97.0) - 0.5) * 0.018;
  o = vec4(max(col, 0.0), 1.0);
}`;

/** The background: WebGL2, its one full-screen triangle. */
class GlSky {
  private gl: WebGL2RenderingContext;
  private uRes: WebGLUniformLocation | null;
  private uT: WebGLUniformLocation | null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "intro shader");
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "intro program");
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.uRes = gl.getUniformLocation(prog, "uRes");
    this.uT = gl.getUniformLocation(prog, "uT");
  }

  draw(w: number, h: number, t: number) {
    const gl = this.gl;
    gl.viewport(0, 0, w, h);
    gl.uniform2f(this.uRes, w, h);
    gl.uniform1f(this.uT, t);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

/** Where there is no WebGL2: a still sky in 2D — the haze and the stars, drawn once per size. */
function drawFlatSky(ctx: Canvas2D, w: number, h: number) {
  const g = ctx.createRadialGradient(w * 0.5, h * 0.4, 0, w * 0.5, h * 0.4, Math.max(w, h) * 0.8);
  g.addColorStop(0, "#1a1008");
  g.addColorStop(0.3, "#070a14");
  g.addColorStop(1, "#010205");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < (w * h) / 900; i++) {
    const a = rnd() ** 4;
    ctx.fillStyle = `rgba(255,${230 + 25 * rnd()},${200 + 55 * rnd()},${0.2 + 0.8 * a})`;
    ctx.fillRect(rnd() * w, rnd() * h, 1 + a, 1 + a);
  }
}

export interface PainterInit {
  bg: AnyCanvas;
  orb: AnyCanvas;
  /** the page's size in CSS pixels, its device pixel ratio, the orb's size in CSS pixels */
  w: number;
  h: number;
  dpr: number;
  orbPx: number;
}

/** The intro's two pictures and their loop. */
export class IntroPainter {
  private sky: GlSky | null = null;
  private flat: Canvas2D | null = null;
  private flatDrawn = "";
  private orbCtx: Canvas2D;
  private state: OrbState | null = null;
  private orbFade = 0;
  private t0 = performance.now();
  private lastBg = -1e9;
  private raf = 0;
  private stopped = false;
  private o: PainterInit;
  /** what drew the background: "webgl2", "2d", or "none" */
  readonly mode: "webgl2" | "2d" | "none";

  constructor(o: PainterInit) {
    this.o = o;
    const gl = o.bg.getContext("webgl2", { alpha: false, antialias: false, powerPreference: "low-power" }) as WebGL2RenderingContext | null;
    let mode: "webgl2" | "2d" | "none" = "none";
    if (gl) {
      try {
        this.sky = new GlSky(gl);
        mode = "webgl2";
      } catch {
        this.sky = null;
      }
    }
    if (!this.sky) {
      this.flat = o.bg.getContext("2d") as Canvas2D | null;
      if (this.flat) mode = "2d";
    }
    this.mode = mode;
    this.orbCtx = o.orb.getContext("2d") as Canvas2D;
    this.size(o.w, o.h, o.dpr);
  }

  size(w: number, h: number, dpr: number) {
    Object.assign(this.o, { w, h, dpr });
    const k = Math.min(dpr, 2) * BG_SCALE;
    this.o.bg.width = Math.max(1, Math.round(Math.min(w * k, 1600)));
    this.o.bg.height = Math.max(1, Math.round((h * this.o.bg.width) / Math.max(w, 1)));
    this.o.orb.width = this.o.orb.height = Math.round(this.o.orbPx * Math.min(dpr, 2));
    this.lastBg = -1e9;
  }

  /** The orb's state (null: none — it fades out). */
  setOrb(state: OrbState | null) {
    if (state) this.state = state;
    this.orbTarget = state ? 1 : 0;
  }
  private orbTarget = 1;

  /** One frame at `now` [ms]. */
  frame(now: number) {
    const t = (now - this.t0) / 1000;
    if (now - this.lastBg >= 1000 / BG_FPS - 2) {
      this.lastBg = now;
      const { width: w, height: h } = this.o.bg;
      if (this.sky) this.sky.draw(w, h, t);
      else if (this.flat && this.flatDrawn !== `${w}×${h}`) {
        drawFlatSky(this.flat, w, h);
        this.flatDrawn = `${w}×${h}`;
      }
    }
    const ctx = this.orbCtx;
    const s = this.o.orb.width;
    ctx.clearRect(0, 0, s, s);
    this.orbFade += (this.orbTarget - this.orbFade) * 0.08;
    if (this.state && this.orbFade > 0.01) drawOrb(ctx, this.state, 0, 0, s, t, this.orbFade);
  }

  /** Runs the loop (requestAnimationFrame where the scope has it — a Worker in Chrome does —, else a timer). */
  run() {
    const raf: (f: (t: number) => void) => number =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (f) => setTimeout(() => f(performance.now()), 16) as unknown as number;
    const loop = (now: number) => {
      if (this.stopped) return;
      this.frame(now);
      this.raf = raf(loop);
    };
    this.raf = raf(loop);
  }

  stop() {
    this.stopped = true;
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.raf);
  }
}
