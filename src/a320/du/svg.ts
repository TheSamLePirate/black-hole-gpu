// The A320's displays' pictures (docs/PLAN-A320.md, A7): FlightGear's SVGs (Models/Instruments/*/res/*.svg — Inkscape's,
// GPL v2), read once into a tree of drawables — groups, paths (Path2D), rects, circles, lines, texts — and drawn on a
// 2D canvas each refresh, their elements moved as FlightGear's canvas moves them from Nasal (canvas/api.nas): shown or
// hidden, translated, rotated about a centre, scaled, their text and colours set; an element `X` clipped by the bounds of
// a rectangle `X_clip` (the PFD's tapes: FlightGear's canvas_pfd.new). The parse is pure (a small XML reader: no DOM);
// the drawing needs a CanvasRenderingContext2D.

type M = [number, number, number, number, number, number]; // a b c d e f: x' = a x + c y + e, y' = b x + d y + f

const I: M = [1, 0, 0, 1, 0, 0];
const mul = (p: M, q: M): M => [
  p[0] * q[0] + p[2] * q[1],
  p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3],
  p[1] * q[2] + p[3] * q[3],
  p[0] * q[4] + p[2] * q[5] + p[4],
  p[1] * q[4] + p[3] * q[5] + p[5],
];
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// ------------------------------------------------------------------------------------------------ XML

interface XNode {
  tag: string;
  attrs: Record<string, string>;
  kids: XNode[];
  text: string;
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unentity = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e] ?? m),
  );

/** A well-formed XML document's tree (comments, processing instructions, the doctype and CDATA's markers dropped). */
export function parseXml(src: string): XNode {
  const root: XNode = { tag: "#root", attrs: {}, kids: [], text: "" };
  const stack = [root];
  const re =
    /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const m of src.matchAll(re)) {
    const top = stack[stack.length - 1]!;
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) {
      if (stack.length > 1) stack.pop();
    } else if (m[3]) {
      const attrs: Record<string, string> = {};
      for (const a of m[4]!.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]!] = unentity(a[2] ?? a[3] ?? "");
      const n: XNode = { tag: m[3], attrs, kids: [], text: "" };
      top.kids.push(n);
      if (!m[5]) stack.push(n);
    } else if (m[6]) top.text += unentity(m[6]);
  }
  return root;
}

// ------------------------------------------------------------------------------------------------ styles, transforms

export interface Style {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  opacity: number;
  fillOpacity: number;
  strokeOpacity: number;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  anchor: "start" | "middle" | "end";
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  dash: number[] | null;
  display: boolean;
}
const BASE: Style = {
  fill: "#000",
  stroke: null,
  strokeWidth: 1,
  opacity: 1,
  fillOpacity: 1,
  strokeOpacity: 1,
  fontSize: 16,
  fontFamily: "sans-serif",
  fontWeight: "normal",
  anchor: "start",
  lineCap: "butt",
  lineJoin: "miter",
  dash: null,
  display: true,
};

function styleOf(a: Record<string, string>, parent: Style): Style {
  const s: Style = { ...parent, opacity: 1 };
  const decl: Record<string, string> = {};
  for (const k of [
    "fill",
    "stroke",
    "stroke-width",
    "opacity",
    "fill-opacity",
    "stroke-opacity",
    "font-size",
    "font-family",
    "font-weight",
    "text-anchor",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-dasharray",
    "display",
    "visibility",
  ])
    if (a[k] !== undefined) decl[k] = a[k]!;
  for (const part of (a.style ?? "").split(";")) {
    const i = part.indexOf(":");
    if (i > 0) decl[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  const col = (v: string) => (v === "none" ? null : v);
  for (const [k, v] of Object.entries(decl)) {
    switch (k) {
      case "fill":
        s.fill = col(v);
        break;
      case "stroke":
        s.stroke = col(v);
        break;
      case "stroke-width":
        s.strokeWidth = parseFloat(v) || 0;
        break;
      case "opacity":
        s.opacity = parseFloat(v);
        break;
      case "fill-opacity":
        s.fillOpacity = parseFloat(v);
        break;
      case "stroke-opacity":
        s.strokeOpacity = parseFloat(v);
        break;
      case "font-size":
        s.fontSize = parseFloat(v) || s.fontSize;
        break;
      case "font-family":
        s.fontFamily = v.replace(/['"]/g, "");
        break;
      case "font-weight":
        s.fontWeight = v;
        break;
      case "text-anchor":
        s.anchor = v === "middle" || v === "end" ? v : "start";
        break;
      case "stroke-linecap":
        s.lineCap = v as CanvasLineCap;
        break;
      case "stroke-linejoin":
        s.lineJoin = (v === "miter-clip" || v === "arcs" ? "miter" : v) as CanvasLineJoin;
        break;
      case "stroke-dasharray":
        s.dash =
          v === "none"
            ? null
            : v
                .split(/[\s,]+/)
                .map(parseFloat)
                .filter(Number.isFinite);
        break;
      case "display":
        if (v === "none") s.display = false;
        break;
      case "visibility":
        if (v === "hidden") s.display = false;
        break;
    }
  }
  return s;
}

function transformOf(t: string | undefined): M {
  let m: M = I;
  if (!t) return m;
  for (const f of t.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const v = f[2]!
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(parseFloat);
    let q: M = I;
    switch (f[1]) {
      case "matrix":
        q = [v[0]!, v[1]!, v[2]!, v[3]!, v[4]!, v[5]!];
        break;
      case "translate":
        q = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
        break;
      case "scale":
        q = [v[0]!, 0, 0, v[1] ?? v[0]!, 0, 0];
        break;
      case "rotate": {
        const r = ((v[0] ?? 0) * Math.PI) / 180;
        const c = Math.cos(r),
          s = Math.sin(r);
        const cx = v[1] ?? 0,
          cy = v[2] ?? 0;
        q = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
        break;
      }
      case "skewX":
        q = [1, 0, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case "skewY":
        q = [1, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = mul(m, q);
  }
  return m;
}

/** A path's box from its data (its points and control points: a little loose on curves). */
function pathBox(d: string): [number, number, number, number] | null {
  const toks = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  let i = 0,
    cmd = "M",
    x = 0,
    y = 0,
    sx = 0,
    sy = 0;
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (px: number, py: number) => {
    box[0] = Math.min(box[0]!, px);
    box[1] = Math.min(box[1]!, py);
    box[2] = Math.max(box[2]!, px);
    box[3] = Math.max(box[3]!, py);
  };
  const n = () => parseFloat(toks[i++]!);
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i]!)) cmd = toks[i++]!;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0,
      oy = rel ? y : 0;
    if (C === "Z") {
      x = sx;
      y = sy;
      continue;
    }
    if (i >= toks.length || /[a-zA-Z]/.test(toks[i]!)) {
      if (C !== "Z") i++;
      continue;
    }
    switch (C) {
      case "M":
      case "L":
      case "T":
        x = ox + n();
        y = oy + n();
        if (C === "M") {
          sx = x;
          sy = y;
          cmd = rel ? "l" : "L";
        }
        break;
      case "H":
        x = ox + n();
        break;
      case "V":
        y = oy + n();
        break;
      case "C":
        add(ox + n(), oy + n());
        add(ox + n(), oy + n());
        x = ox + n();
        y = oy + n();
        break;
      case "S":
      case "Q":
        add(ox + n(), oy + n());
        x = ox + n();
        y = oy + n();
        break;
      case "A": {
        const rx = n(),
          ry = n();
        n();
        n();
        n();
        x = ox + n();
        y = oy + n();
        add(x - rx, y - ry);
        add(x + rx, y + ry);
        break;
      }
      default:
        i++;
    }
    add(x, y);
  }
  return Number.isFinite(box[0]!) ? (box as [number, number, number, number]) : null;
}

// ------------------------------------------------------------------------------------------------ the tree

export type Kind = "g" | "path" | "rect" | "circle" | "ellipse" | "line" | "poly" | "text";

/** An element: its SVG's (kind, geometry, style, transform), and FlightGear's canvas state set on it by the drivers. */
export class El {
  kids: El[] = [];
  parent: El | null = null;
  /** the geometry: a path's data, a rect's x y w h rx, a circle's cx cy r (ry), a line's / polyline's points */
  d = "";
  geo: number[] = [];
  closed = false;
  path: Path2D | null = null;
  /** a text's runs (its tspans: their x, y, text, style) */
  runs: { x: number; y: number; text: string; style: Style }[] = [];
  /** its own box in its own frame (before its transform) */
  box: [number, number, number, number] | null = null;
  // (FlightGear's canvas state)
  visible = true;
  tx = 0;
  ty = 0;
  rot = 0;
  cx = 0;
  cy = 0;
  sx = 1;
  sy = 1;
  clip: [number, number, number, number] | null = null;
  constructor(
    readonly kind: Kind,
    readonly id: string,
    public style: Style,
    readonly tf: M,
  ) {}

  hide() {
    this.visible = false;
    return this;
  }
  show() {
    this.visible = true;
    return this;
  }
  setVisible(v: boolean | number) {
    this.visible = !!v;
    return this;
  }
  setTranslation(x: number, y: number) {
    this.tx = x;
    this.ty = y;
    return this;
  }
  /** a turn [rad] about a centre (this element's frame; none: the last set — FlightGear's setCenter) */
  setRotation(r: number, c?: [number, number]) {
    this.rot = r;
    if (c) [this.cx, this.cy] = c;
    return this;
  }
  setCenter(x: number, y: number) {
    this.cx = x;
    this.cy = y;
    return this;
  }
  setScale(sx: number, sy = sx) {
    this.sx = sx;
    this.sy = sy;
    return this;
  }
  /** a text's: its first run's, the others emptied */
  setText(s: string | number) {
    const t = String(s);
    if (this.kind === "text") {
      if (!this.runs.length) this.runs.push({ x: 0, y: 0, text: t, style: this.style });
      this.runs[0]!.text = t;
      for (let i = 1; i < this.runs.length; i++) this.runs[i]!.text = "";
    } else for (const k of this.kids) if (k.kind === "text") k.setText(t);
    return this;
  }
  getText() {
    return this.runs.map((r) => r.text).join("");
  }
  /** the stroke's colour (a text's fill: FlightGear's setColor on a text), r g b 0…1 or a CSS colour */
  setColor(r: number | string, g?: number, b?: number) {
    const c = typeof r === "string" ? r : css(r, g!, b!);
    this.recolour((s, text) => (text ? (s.fill = c) : s.stroke !== null ? (s.stroke = c) : (s.fill = c)));
    return this;
  }
  setColorFill(r: number | string, g?: number, b?: number) {
    const c = typeof r === "string" ? r : css(r, g!, b!);
    this.recolour((s) => (s.fill = c));
    return this;
  }
  private recolour(f: (s: Style, text: boolean) => void) {
    this.style = { ...this.style };
    f(this.style, this.kind === "text");
    for (const r of this.runs) {
      r.style = { ...r.style };
      f(r.style, true);
    }
    for (const k of this.kids) k.recolour(f);
  }
  /** the centre of its box (its own frame) — FlightGear's getCenter */
  getCenter(): [number, number] {
    const b = this.bounds(I);
    return b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : [0, 0];
  }
  /** its box with its children's, through `m` (its own transform not applied) */
  bounds(m: M): [number, number, number, number] | null {
    let out: [number, number, number, number] | null = null;
    const grow = (b: [number, number, number, number] | null, t: M) => {
      if (!b) return;
      for (const [x, y] of [
        [b[0], b[1]],
        [b[2], b[1]],
        [b[0], b[3]],
        [b[2], b[3]],
      ] as const) {
        const [px, py] = apply(t, x, y);
        out = out ? [Math.min(out[0], px), Math.min(out[1], py), Math.max(out[2], px), Math.max(out[3], py)] : [px, py, px, py];
      }
    };
    grow(this.box, m);
    for (const k of this.kids) grow(k.bounds(I), mul(m, k.tf));
    return out;
  }
  /** its box in its parent's frame (its transform applied) — FlightGear's getTransformedBounds */
  transformedBounds() {
    return this.bounds(this.tf);
  }
  /** its local map: the SVG's transform, then FlightGear's — translation, the turn about the centre, the scale */
  local(): M {
    let m = this.tf;
    if (this.tx || this.ty) m = mul(m, [1, 0, 0, 1, this.tx, this.ty]);
    if (this.rot) {
      const c = Math.cos(this.rot),
        s = Math.sin(this.rot);
      m = mul(m, [c, s, -s, c, this.cx - c * this.cx + s * this.cy, this.cy - s * this.cx - c * this.cy]);
    }
    if (this.sx !== 1 || this.sy !== 1) m = mul(m, [this.sx, 0, 0, this.sy, 0, 0]);
    return m;
  }
}
const css = (r: number, g: number, b: number) => `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;

/** A whole SVG read: its root, its elements by id, its size (width, height in its units). */
export class SvgDoc {
  readonly root: El;
  readonly byId = new Map<string, El>();
  width = 1024;
  height = 1024;
  /** the view box's map onto the canvas */
  view: M = I;

  constructor(src: string) {
    const x = parseXml(src);
    const svg = find(x, "svg");
    this.root = new El("g", "", BASE, I);
    if (!svg) return;
    const vb = (svg.attrs.viewBox ?? "").split(/[\s,]+/).map(parseFloat);
    const w = parseFloat(svg.attrs.width ?? ""),
      h = parseFloat(svg.attrs.height ?? "");
    if (vb.length === 4 && vb.every(Number.isFinite)) {
      this.width = Number.isFinite(w) ? w : vb[2]!;
      this.height = Number.isFinite(h) ? h : vb[3]!;
      this.view = [this.width / vb[2]!, 0, 0, this.height / vb[3]!, (-vb[0]! * this.width) / vb[2]!, (-vb[1]! * this.height) / vb[3]!];
    } else if (Number.isFinite(w) && Number.isFinite(h)) {
      this.width = w;
      this.height = h;
    }
    for (const k of svg.kids) this.read(k, this.root, BASE);
    // (an element X clipped by X_clip's bounds — in X's parent's frame —, X_clip hidden: canvas_pfd.new)
    for (const [id, el] of this.byId) {
      const c = this.byId.get(`${id}_clip`);
      if (!c) continue;
      c.hide();
      el.clip = c.transformedBounds();
    }
  }

  private read(x: XNode, parent: El, ps: Style) {
    const tag = x.tag.replace(/^svg:/, "");
    if (/^(defs|metadata|title|desc|sodipodi:|inkscape:|rdf:|flowRoot)/.test(tag) || tag === "defs") return;
    const style = styleOf(x.attrs, ps);
    const tf = transformOf(x.attrs.transform);
    const id = x.attrs.id ?? "";
    const num = (k: string) => parseFloat(x.attrs[k] ?? "0") || 0;
    let el: El | null = null;
    switch (tag) {
      case "g":
      case "a":
      case "switch":
        el = new El("g", id, style, tf);
        for (const k of x.kids) this.read(k, el, style);
        break;
      case "path":
        el = new El("path", id, style, tf);
        el.d = x.attrs.d ?? "";
        el.box = pathBox(el.d);
        break;
      case "rect": {
        el = new El("rect", id, style, tf);
        const [rx, ry] = [num("x"), num("y")];
        el.geo = [rx, ry, num("width"), num("height"), num("rx") || num("ry")];
        el.box = [rx, ry, rx + num("width"), ry + num("height")];
        break;
      }
      case "circle":
      case "ellipse": {
        el = new El("circle", id, style, tf);
        const r = num("r"),
          rx = tag === "circle" ? r : num("rx"),
          ry = tag === "circle" ? r : num("ry");
        el.geo = [num("cx"), num("cy"), rx, ry];
        el.box = [num("cx") - rx, num("cy") - ry, num("cx") + rx, num("cy") + ry];
        break;
      }
      case "line":
        el = new El("line", id, style, tf);
        el.geo = [num("x1"), num("y1"), num("x2"), num("y2")];
        el.box = [
          Math.min(el.geo[0]!, el.geo[2]!),
          Math.min(el.geo[1]!, el.geo[3]!),
          Math.max(el.geo[0]!, el.geo[2]!),
          Math.max(el.geo[1]!, el.geo[3]!),
        ];
        break;
      case "polyline":
      case "polygon": {
        el = new El("poly", id, style, tf);
        el.geo = (x.attrs.points ?? "")
          .split(/[\s,]+/)
          .filter(Boolean)
          .map(parseFloat);
        el.closed = tag === "polygon";
        const xs = el.geo.filter((_, i) => i % 2 === 0),
          ys = el.geo.filter((_, i) => i % 2 === 1);
        if (xs.length) el.box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
        break;
      }
      case "text": {
        el = new El("text", id, style, tf);
        let cx = num("x"),
          cy = num("y");
        const runs: El["runs"] = [];
        if (x.text.trim()) runs.push({ x: cx, y: cy, text: x.text.trim(), style });
        for (const k of x.kids) {
          if (k.tag.replace(/^svg:/, "") !== "tspan") continue;
          const ks = styleOf(k.attrs, style);
          if (k.attrs.x !== undefined) cx = parseFloat(k.attrs.x) || 0;
          if (k.attrs.y !== undefined) cy = parseFloat(k.attrs.y) || 0;
          const txt = k.text + k.kids.map((q) => q.text).join("");
          runs.push({ x: cx, y: cy, text: txt, style: ks });
        }
        el.runs = runs;
        // (its box: each run's, by its own size and anchor — a glyph 0.6 em wide)
        for (const r of runs) {
          const fs = r.style.fontSize;
          const w = r.text.length * fs * 0.6;
          const x0 = r.style.anchor === "middle" ? r.x - w / 2 : r.style.anchor === "end" ? r.x - w : r.x;
          const b: [number, number, number, number] = [x0, r.y - fs * 0.8, x0 + w, r.y + fs * 0.2];
          el.box = el.box
            ? [Math.min(el.box[0], b[0]), Math.min(el.box[1], b[1]), Math.max(el.box[2], b[2]), Math.max(el.box[3], b[3])]
            : b;
        }
        break;
      }
      default:
        return;
    }
    el.parent = parent;
    parent.kids.push(el);
    // (Inkscape's rotation centre — its offset from the box's centre, y up —: FlightGear's parser makes it the centre)
    const icx = x.attrs["inkscape:transform-center-x"],
      icy = x.attrs["inkscape:transform-center-y"];
    if (icx !== undefined || icy !== undefined) {
      const [cx, cy] = el.getCenter();
      el.setCenter(cx + (parseFloat(icx ?? "0") || 0), cy - (parseFloat(icy ?? "0") || 0));
    }
    if (!style.display) el.visible = false;
    if (id && !this.byId.has(id)) this.byId.set(id, el);
  }

  /** An element by id — a stand-in, drawn nowhere, when the SVG has none (a driver's line for another variant) */
  get(id: string): El {
    let e = this.byId.get(id);
    if (!e) {
      e = new El("g", id, BASE, I);
      this.byId.set(id, e);
    }
    return e;
  }

  /** Drawn on ctx (its canvas cleared by the caller), the document's units scaled to (w, h). */
  draw(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    w = this.width,
    h = this.height,
    font: (family: string) => string = (f) => f,
  ) {
    const m = mul([w / this.width, 0, 0, h / this.height, 0, 0], this.view);
    drawEl(ctx, this.root, m, font);
  }
}

function find(x: XNode, tag: string): XNode | null {
  if (x.tag === tag || x.tag.endsWith(`:${tag}`)) return x;
  for (const k of x.kids) {
    const f = find(k, tag);
    if (f) return f;
  }
  return null;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function drawEl(ctx: Ctx, el: El, parent: M, font: (family: string) => string) {
  if (!el.visible) return;
  const s = el.style;
  if (el.clip) {
    ctx.save();
    ctx.setTransform(parent[0], parent[1], parent[2], parent[3], parent[4], parent[5]);
    ctx.beginPath();
    ctx.rect(el.clip[0], el.clip[1], el.clip[2] - el.clip[0], el.clip[3] - el.clip[1]);
    ctx.clip();
  }
  const m = mul(parent, el.local());
  if (el.kind === "g") for (const k of el.kids) drawEl(ctx, k, m, font);
  else {
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    if (el.kind === "text") {
      for (const r of el.runs) {
        if (!r.text) continue;
        const rs = r.style;
        ctx.font = `${rs.fontWeight === "bold" || Number(rs.fontWeight) >= 600 ? "bold " : ""}${rs.fontSize}px ${font(rs.fontFamily)}`;
        ctx.textAlign = rs.anchor === "middle" ? "center" : rs.anchor === "end" ? "right" : "left";
        ctx.textBaseline = "alphabetic";
        if (rs.fill) {
          ctx.globalAlpha = rs.opacity * rs.fillOpacity;
          ctx.fillStyle = rs.fill;
          ctx.fillText(r.text, r.x, r.y);
        }
        if (rs.stroke && rs.strokeWidth > 0) {
          ctx.globalAlpha = rs.opacity * rs.strokeOpacity;
          ctx.strokeStyle = rs.stroke;
          ctx.lineWidth = rs.strokeWidth;
          ctx.strokeText(r.text, r.x, r.y);
        }
      }
    } else {
      const p = (el.path ??= shape(el));
      if (s.fill && !s.fill.startsWith("url(")) {
        ctx.globalAlpha = s.opacity * s.fillOpacity;
        ctx.fillStyle = s.fill;
        ctx.fill(p);
      }
      if (s.stroke && s.strokeWidth > 0 && !s.stroke.startsWith("url(")) {
        ctx.globalAlpha = s.opacity * s.strokeOpacity;
        ctx.strokeStyle = s.stroke;
        ctx.lineWidth = s.strokeWidth;
        ctx.lineCap = s.lineCap;
        ctx.lineJoin = s.lineJoin;
        ctx.setLineDash(s.dash ?? []);
        ctx.stroke(p);
        if (s.dash) ctx.setLineDash([]);
      }
    }
    ctx.globalAlpha = 1;
  }
  if (el.clip) ctx.restore();
}

function shape(el: El): Path2D {
  const g = el.geo;
  if (el.kind === "path") return new Path2D(el.d);
  const p = new Path2D();
  if (el.kind === "rect") {
    if (g[4]) p.roundRect(g[0]!, g[1]!, g[2]!, g[3]!, g[4]!);
    else p.rect(g[0]!, g[1]!, g[2]!, g[3]!);
  } else if (el.kind === "circle") p.ellipse(g[0]!, g[1]!, g[2]!, g[3]!, 0, 0, Math.PI * 2);
  else if (el.kind === "line") {
    p.moveTo(g[0]!, g[1]!);
    p.lineTo(g[2]!, g[3]!);
  } else if (el.kind === "poly") {
    for (let i = 0; i + 1 < g.length; i += 2) (i ? p.lineTo : p.moveTo).call(p, g[i]!, g[i + 1]!);
    if (el.closed) p.closePath();
  }
  return p;
}
