import { expect, test } from "bun:test";
import { cameraFrame, setRepPose } from "../src/camera";
import { CameraController } from "../src/controls";
import { defaultSettings, presets } from "../src/settings";
import { mouth, setSceneTime } from "../src/wormhole";

// A flight plan belongs to the universe its nodes were placed in: stamped with the first node,
// forgotten with the last — the wormhole's arrival and a plan's last burn empty the same plan object.

/** A ship flown out of the wormhole: on Gargantua's side (the hole's region), or placed at ℓ. */
function flying() {
  setSceneTime(0);
  const s = { ...defaultSettings(), ...presets["Earth: the Blue Marble"]!, whOrbit: false };
  const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
  c.setPilot(true);
  const said: string[] = [];
  c.onPilotMessage = (m) => said.push(m);
  const m = mouth(s, 0);
  const place = (l: number) => setRepPose(s, { l, n: [1, 0, 0], fwd: [1, 0, 0], up: [0, 0, 1], vel: [Math.sign(l) * 0.01, 0, 0] });
  place(m.lGlue + 5);
  return { s, c, said, place, m };
}

/** The plan as the wormhole's arrival leaves it: the nodes gone, the object — and its universe — kept. */
const emptiedFromOurSide = (c: CameraController) => Object.assign(c.plan, { nodes: [], universe: "ours" });

test("a node added at Gargantua after the plan from our side emptied is flown, not suspended", () => {
  const { s, c, said } = flying();
  expect(cameraFrame(s).region).toBe("hole");
  emptiedFromOurSide(c);
  c.addNode(50);
  expect(c.plan.nodes.length).toBe(1);
  expect(c.plan.universe).toBe("gargantua");
  c.pilot.setAuto("node");
  expect(c.pilot.auto).toBe("node");
  c.nodeBurn(cameraFrame(s), 1 / 30, 1);
  expect(said.filter((m) => m.includes("other universe"))).toEqual([]);
  expect(c.pilot.auto).toBe("node");
});

test("an emptied plan forgets its universe; a planner's plan is stamped where it is first looked at", () => {
  const { s, c, place, m } = flying();
  emptiedFromOurSide(c);
  c.refreshPlan(true);
  expect(c.plan.universe).toBeUndefined();
  c.plan = { nodes: [{ t: 80, dv: [0.001, 0, 0] }], path: null, at: 0, note: "" };
  c.refreshPlan(true);
  expect(c.plan.universe).toBe("gargantua");
  // (carried back into our universe, the plan stays Gargantua's: suspended there, its nodes kept)
  place(-2 * m.lGlue);
  expect(c.planApplies(cameraFrame(s))).toBe(false);
  expect(c.plan.nodes.length).toBe(1);
  expect(c.plan.universe).toBe("gargantua");
});
