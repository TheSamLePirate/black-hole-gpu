import type { PlanetCharacter } from "../controller/character";
import type { SceneryContact } from "../system/scenery-contact";
import { sceneryFrame } from "../system/scenery-data";
import { cross, dot, unit } from "../math/vec3";
import type { Vec3 } from "../physics";
import { t } from "../i18n";

/** X-ray diagnostic of CPU collisions. Deliberately independent of the GPU scenery transform. */
export class SceneryHitboxes {
  readonly root = document.createElement("div");
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private label = document.createElement("div");
  private source: SceneryContact | null = null;
  private anchor: Vec3 = [Infinity, Infinity, Infinity];
  private geometry: ReturnType<SceneryContact["collisionLines"]> | null = null;
  private at = -Infinity;
  constructor() {
    this.root.className = "scenery-hitboxes";
    this.root.dataset.testid = "scenery-hitboxes";
    this.root.hidden = true;
    this.root.append(this.canvas, this.label);
    document.body.append(this.root);
  }
  update(now: number, c: PlanetCharacter, contact: SceneryContact | null, fov: number, visible: boolean, viewport: HTMLCanvasElement) {
    this.root.hidden = !visible || !c.active || c.body !== "earth";
    if (this.root.hidden || now - this.at < 1000 / 30) return;
    this.at = now;
    const frame = c.frame();
    if (!frame || !contact) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.label.textContent = t("Collision hitboxes — waiting for scenery");
      this.root.dataset.segments = "0";
      return;
    }
    if (this.source !== contact || Math.hypot(...c.q.map((v, i) => v - this.anchor[i]!)) > 8) {
      this.source = contact;
      this.anchor = [...c.q];
      this.geometry = contact.collisionLines(c.q);
    }
    const geometry = this.geometry!;
    const rect = viewport.getBoundingClientRect();
    const W = rect.width,
      H = rect.height,
      dpr = Math.min(devicePixelRatio, 2);
    Object.assign(this.root.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${W}px`, height: `${H}px` });
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const local = contact.local(c.q),
      sf = sceneryFrame(contact.reply.lat, contact.reply.lon);
    const up = c.up(),
      right = unit(cross(c.forward, up));
    const transform = (v: Vec3): Vec3 => {
      const weights = [dot(v, right), dot(v, up), dot(v, c.forward)];
      return [0, 1, 2].map((i) => weights.reduce((sum, w, j) => sum + w * frame.axes[j]![i]!, 0)) as Vec3;
    };
    const axes = [sf.east, sf.north, sf.up].map(transform);
    const point = (i: number): Vec3 => {
      const v = geometry.vertices;
      const x = v[i]! - local[0],
        y = v[i + 1]! - local[1],
        z = v[i + 2]! - local[2];
      return [0, 1, 2].map((k) => frame.origin[k]! + axes[0]![k]! * x + axes[1]![k]! * y + axes[2]![k]! * z) as Vec3;
    };
    const focal = H / (2 * Math.tan((fov * Math.PI) / 360)),
      near = 0.05;
    ctx.strokeStyle = "#ff42ba";
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (let i = 0; i < geometry.vertices.length; i += 6) {
      let a = point(i),
        b = point(i + 3);
      if (a[2] < near && b[2] < near) continue;
      if (a[2] < near || b[2] < near) {
        if (b[2] < near) [a, b] = [b, a];
        const k = (near - a[2]) / (b[2] - a[2]);
        a = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, near];
      }
      const ax = W / 2 + (a[0] / a[2]) * focal,
        ay = H / 2 - (a[1] / a[2]) * focal,
        bx = W / 2 + (b[0] / b[2]) * focal,
        by = H / 2 - (b[1] / b[2]) * focal;
      if (Math.max(ax, bx) < 0 || Math.min(ax, bx) > W || Math.max(ay, by) < 0 || Math.min(ay, by) > H) continue;
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    this.root.dataset.segments = String(geometry.vertices.length / 6);
    this.root.dataset.trees = String(geometry.trees);
    this.root.dataset.buildings = String(geometry.buildings);
    this.label.textContent = `${t("Pink collision hitboxes")} · ${geometry.trees} ${t("trees")} · ${geometry.buildings} ${t("buildings")} · 60 m${geometry.truncated ? " · …" : ""}`;
  }
}
