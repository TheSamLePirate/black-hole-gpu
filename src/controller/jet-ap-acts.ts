// The aircraft's autopilot as an action (audit 2026-11-10, TA-03; wave 3.7): its selectors (altitude over the sea [m],
// heading [°], speed through the air [m/s]), its engagement (AP, A/THR) and the flight plan's guidance (LNAV, VNAV) —
// one place for the crew console's orders (ui/crew-exec.ts ap.set, ap.engage, ap.nav) and TARS's tool (ai/game-tools.ts
// jet_autopilot), so both take the same path as the cockpit's selectors (controller/jet.ts apSet, controller/fplan.ts
// navSet) and the same units. Never the afterburner or the throttle.

import type { CameraController } from "../controls";

type Num = number | string | undefined;
const n = (x: Num) => (x === undefined ? undefined : Number(x));

/** The selectors: altitude over the sea [m], heading [°, true], speed [m/s] — those given only. What apSet said. */
export function apSelect(c: CameraController, a: { alt?: Num; hdgDeg?: Num; spd?: Num }) {
  return c.apSet({
    ...(a.alt !== undefined ? { alt: n(a.alt) } : {}),
    ...(a.hdgDeg !== undefined ? { hdg: (n(a.hdgDeg)! * Math.PI) / 180 } : {}),
    ...(a.spd !== undefined ? { spd: n(a.spd) } : {}),
  });
}

/** The autopilot and the autothrottle engaged or let go — those given only. */
export function apEngage(c: CameraController, a: { ap?: unknown; athr?: unknown }) {
  return c.apSet({ ...(a.ap !== undefined ? { ap: !!a.ap } : {}), ...(a.athr !== undefined ? { athr: !!a.athr } : {}) });
}

/** The flight plan's lateral and vertical guidance — those given only. */
export function apNav(c: CameraController, a: { lnav?: unknown; vnav?: unknown }) {
  return c.navSet({ ...(a.lnav !== undefined ? { l: !!a.lnav } : {}), ...(a.vnav !== undefined ? { v: !!a.vnav } : {}) });
}
