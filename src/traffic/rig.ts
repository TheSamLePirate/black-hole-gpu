import anchors from "./rig-anchors.json";
// FGAddon exterior rigs evaluated by the same hierarchy and interpolation engine as the A320.
import crj900 from "../../assets/traffic/crj-fg/crj900-rig.json";
import b738 from "../../assets/traffic/boeing/b738-rig.json";
import b744 from "../../assets/traffic/boeing/b744-rig.json";
import b772 from "../../assets/traffic/boeing/b772-rig.json";
import b77w from "../../assets/traffic/boeing/b77w-rig.json";
import { rigMatrices, type A320Mesh, type RigNode } from "../a320/rig";
import type { Props } from "../a320/rig";

export interface TrafficPose {
  flap: number;
  spoiler: number;
  rev: number;
  n1: number;
  speed: number;
  time: number;
  roll: number;
  pitch: number;
}
const rigs = Object.fromEntries(
  Object.entries({ b738, b744, b772, b77w, crj900 }).map(([k, nodes]) => [k, { nodes: nodes as RigNode[] } as A320Mesh]),
);
export const TRAFFIC_PARTS = 256;
export function trafficMatrices(id: string, gear: number, pose?: TrafficPose) {
  const rig = rigs[id];
  if (!rig) return null;
  if (rig.nodes.length + 1 > TRAFFIC_PARTS) throw Error(`traffic rig too large: ${id}`);
  const p = pose ?? { flap: 0, spoiler: 0, rev: 0, n1: 20, speed: 0, time: 0, roll: 0, pitch: 0 };
  const props: Props = {},
    spins: Props = {};
  for (const n of rig.nodes) {
    const key = n.prop ?? "";
    let value = 0;
    if (/^gear\/.*position-norm/.test(key)) value = gear;
    else if (/flap|slats/.test(key)) value = p.flap;
    else if (/reverser/.test(key)) value = p.rev;
    else if (/spoiler|mfs/.test(key)) value = p.spoiler * (/deg/.test(key) ? 45 : 1);
    else if (/aileron/.test(key)) value = p.roll * (/rad/.test(key) ? 0.15 : /norm/.test(key) ? 0.25 : 8);
    else if (/elevator/.test(key)) value = -p.pitch * (/rad/.test(key) ? Math.PI / 360 : /norm/.test(key) ? 1 / 30 : 0.5);
    else if (/\/n1|\/rpm/.test(key)) value = p.n1;
    else if (/rollspeed/.test(key)) value = p.speed;
    props[key] = value;
    if (n.type === "spin") spins[key] = ((p.time * value * (n.factor ?? 1) * Math.PI) / 30) % (2 * Math.PI);
  }
  return rigMatrices(rig, props, spins);
}

/** Follow the actual flap articulation instead of emitting from the neutral mesh station. */
export function posedEmission(id: string, key: string, q: [number, number, number], maps: Float32Array | null): [number, number, number] {
  if (!maps || !key.startsWith("a320f")) return q;
  const parts = (anchors as Record<string, { part: number; point: number[] }[]>)[id];
  if (!parts) return q;
  const binding = parts[q[0] < 0 ? 1 : 0]!;
  const k = binding.part * 12;
  q = binding.point as [number, number, number];
  return [0, 1, 2].map(
    (row) => maps[k + row * 4]! * q[0] + maps[k + row * 4 + 1]! * q[1] + maps[k + row * 4 + 2]! * q[2] + maps[k + row * 4 + 3]!,
  ) as [number, number, number];
}
