// The reference flights: a scene, what is set up after it (page code), how many 1/30 s steps it flies
// (golden.e2e.test.ts replays them; scripts compare them at other rates).

export interface Flight {
  scene: string;
  /** set up after the scene, before the steps (page code) */
  setup: string;
  steps: number;
}

export const FLIGHTS: Record<string, Flight> = {
  "orbit-burn": { scene: "game:artemis", setup: "__bh.camera.pilot.throttle = 1", steps: 300 },
  "orbit-retro-hold": {
    scene: "game:artemis",
    setup: `__bh.camera.pilot.setHold("retrograde"); __bh.camera.pilot.throttle = 0.4`,
    steps: 600,
  },
  "entry-glide-edwards": { scene: "game:artemis", setup: `__bh.game.glideTo("Edwards")`, steps: 900 },
  "iss-autodock": { scene: "Earth: docking to the ISS", setup: `__bh.camera.pilot.setAuto("dock")`, steps: 900 },
  "moon-takeoff": { scene: "Moon: an afternoon on the plains", setup: `__bh.camera.pilot.setAuto("takeoff")`, steps: 600 },
  "gargantua-thrust": { scene: "Ranger: approaching Gargantua", setup: "__bh.camera.pilot.throttle = 0.5", steps: 300 },
  "wormhole-coast": { scene: "Interstellar: wormhole to Gargantua", setup: "", steps: 300 },
  "miller-sea": { scene: "Miller: Gargantua over the sea", setup: "__bh.camera.pilot.throttle = 0.3", steps: 300 },
};
