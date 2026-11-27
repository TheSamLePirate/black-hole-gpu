// Attachments in each rendered mesh's frame: x left, y up, z nose, metres.
import { MESH, type AirlinerMesh } from "../game/airtypes";
import type { Vec3 } from "../physics";

import { BOEING } from "./boeing";
export const ATTACHMENTS = {
  ...BOEING,
  a320: {
    tip: [16.7, 2.95, -3.18],
    root: [4.5, 1.95, 2.25],
    sheetEnd: [15, 2.91, -1.73],
    flap: [13.4, 2.62, -2.23],
    inlet: [5.63, 0.05, 7.45],
    exhaust: [5.63, 0.42, 2.23],
    nose: [0, -1.43, 13.65],
    main: [4.326, -1.43, 1.139],
    nav: [16.6504, 2.965012, -1.89364],
    tail: [0, 3.318205, -18.8029],
    beacon: [0, 4.59788, 3.58595],
    lower: [0, 0.14406, 3.97011],
    landing: [2.22016, 0.95766, 2.08],
  },
  a320t: {
    tip: [17, 0.84, -5.68],
    root: [4.5, 0.02, -0.07],
    sheetEnd: [15, 0.82, -4.1],
    flap: [13.4, 0.52, -4.64],
    inlet: [5.78, -1.55, 5.15],
    exhaust: [5.78, -1.3, -0.55],
    nose: [0, -3.22, 11],
    main: [3.846, -3.22, -0.97],
    nav: MESH.a320t.tip,
    tail: MESH.a320t.tail,
    beacon: MESH.a320t.beacon,
    lower: [0, -1.9, 1.5],
    landing: MESH.a320t.landing,
  },
  crj900: {
    tip: [11.6, -1.85, -4.97],
    root: [2.5, -1.846, -0.038],
    sheetEnd: [10, -1.804, -3.387],
    flap: [8, -2.0, -3.69],
    inlet: [2.251, -0.263, -7.651],
    exhaust: [2.319, -0.433, -11.547],
    nose: [0, -3.81, 16.172],
    main: [2.5, -3.81, -1.356],
    nav: MESH.crj900.tip,
    tail: MESH.crj900.tail,
    beacon: MESH.crj900.beacon,
    lower: [0, -2.386, 8.247],
    landing: MESH.crj900.landing,
  },
} as const;
export type AttachmentModel = keyof typeof ATTACHMENTS;

/** Convert an A320 effect's local point to the corresponding feature on the rendered mesh. */
export function effectPoint(model: AttachmentModel, key: string, p: readonly number[]): Vec3 {
  const a = ATTACHMENTS.a320;
  const b = ATTACHMENTS[model];
  const side = p[0]! < 0 ? -1 : 1;
  if (key.startsWith("a320v")) {
    const t = Math.min(1, Math.max(0, (Math.abs(p[0]!) - 4.5) / 10.5));
    return [
      side * (b.root[0] + (b.sheetEnd[0] - b.root[0]) * t),
      b.root[1] + (b.sheetEnd[1] - b.root[1]) * t + 0.12,
      b.root[2] + (b.sheetEnd[2] - b.root[2]) * t,
    ];
  }
  if (key.startsWith("a320f") || key.startsWith("a320t")) {
    const [x, y, z] = key.startsWith("a320f") ? b.flap : b.tip;
    return [side * x, y, z];
  }
  if (model === "a320") return [...p] as Vec3;
  if (key.startsWith("a320r")) {
    return [p[0]! + side * (b.inlet[0] - 5.63), b.inlet[1], b.inlet[2] - 2.25];
  }
  let from: readonly number[] = a.inlet,
    to: readonly number[] = b.inlet;
  if (key.startsWith("a320s") || key.startsWith("a320w")) {
    const nose = key.endsWith("0");
    from = nose ? a.nose : a.main;
    to = nose ? b.nose : b.main;
  }
  return [p[0]! + side * (to[0]! - from[0]!), p[1]! + to[1]! - from[1]!, p[2]! + to[2]! - from[2]!];
}

export function attachmentScale(mesh: AirlinerMesh, len: number, rigged: boolean) {
  const model: AttachmentModel = rigged ? "a320" : mesh;
  const scale = len / (rigged ? 37.57 : MESH[mesh].len);
  const down = rigged ? (MESH[mesh].wheels * len) / MESH[mesh].len - 1.59 * scale : 0;
  return { model, scale, down };
}

/** A model-local attachment on the traffic's body-fixed axes. Shared by lamps, exhausts and surface effects. */
export function attachmentOffset(
  a: ReturnType<typeof attachmentScale>,
  point: readonly number[],
  right: readonly number[],
  up: readonly number[],
  forward: readonly number[],
): Vec3 {
  return [0, 1, 2].map((i) => a.scale * (-right[i]! * point[0]! + up[i]! * point[1]! + forward[i]! * point[2]!) - up[i]! * a.down) as Vec3;
}
