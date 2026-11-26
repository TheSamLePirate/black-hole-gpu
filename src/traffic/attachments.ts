// Attachments in each rendered mesh's frame: x left, y up, z nose, metres.
import { MESH, type AirlinerMesh } from "../game/airtypes";
import type { Vec3 } from "../physics";

export const ATTACHMENTS = {
  a320: {
    tip: [17, 2.95, -2],
    root: [4.5, 1.98, 1.3],
    flap: [13.4, 2.5, -2.7],
    inlet: [5.63, 0.05, 7.45],
    exhaust: [5.63, 0.43, 3.5],
    nose: [0, -1.43, 13.65],
    main: [4.326, -1.43, 1.139],
    nav: [16.6504, 2.965012, -1.89364],
    tail: [0, 3.318205, -18.8029],
    beacon: [0, 4.59788, 3.58595],
    lower: [0, 0.14406, 3.97011],
    landing: [2.22016, 0.95766, 2.08],
  },
  a320t: {
    tip: [16.83, 0.87, -4.14],
    root: [4.5, 0.3, 0.2],
    flap: [13.4, 0.7, -4.8],
    inlet: [5.6, -1.1, 4.8],
    exhaust: [5.6, -1.1, 0.5],
    nose: [0, -3.22, 11],
    main: [3.846, -3.22, -0.97],
    nav: MESH.a320t.tip,
    tail: MESH.a320t.tail,
    beacon: MESH.a320t.beacon,
    lower: [0, -1.9, 1.5],
    landing: MESH.a320t.landing,
  },
  crj900: {
    tip: [11.58, 1, -4.62],
    root: [2.5, -0.2, -0.8],
    flap: [8, 0.4, -4.8],
    inlet: [2.4, 1.28, -7.3],
    exhaust: [2.4, 1.28, -11.2],
    nose: [0, -2.19, 15.324],
    main: [2.085, -2.19, -1.484],
    nav: MESH.crj900.tip,
    tail: MESH.crj900.tail,
    beacon: MESH.crj900.beacon,
    lower: [0, -1.3, 2],
    landing: MESH.crj900.landing,
  },
} as const;
export type AttachmentModel = keyof typeof ATTACHMENTS;

/** Convert an A320 effect's local point to the corresponding feature on the rendered mesh. */
export function effectPoint(model: AttachmentModel, key: string, p: readonly number[]): Vec3 {
  if (model === "a320") return [...p] as Vec3;
  const a = ATTACHMENTS.a320;
  const b = ATTACHMENTS[model];
  const side = p[0]! < 0 ? -1 : 1;
  let from: readonly number[] = a.tip,
    to: readonly number[] = b.tip;
  if (key.startsWith("a320v")) {
    const t = Math.min(1, Math.max(0, (Math.abs(p[0]!) - 4.5) / 12.5));
    return [
      side * (b.root[0] + (b.tip[0] - b.root[0]) * t),
      b.root[1] + (b.tip[1] - b.root[1]) * t + 0.12,
      b.root[2] + (b.tip[2] - b.root[2]) * t,
    ];
  }
  if (key.startsWith("a320f")) {
    from = a.flap;
    to = b.flap;
  }
  if (key.startsWith("a320r")) {
    return [p[0]! + side * (b.inlet[0] - 5.63), b.inlet[1], b.inlet[2] - 2.25];
  }
  if (key.startsWith("a320i")) {
    from = a.inlet;
    to = b.inlet;
  }
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
