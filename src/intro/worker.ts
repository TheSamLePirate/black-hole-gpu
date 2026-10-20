// The intro's Worker (PLAN-TITRE-AAA E1): the background and the loading orb drawn on the canvases the page handed
// over (OffscreenCanvas) — their frames never wait for the main thread, busy compiling the game. The page tells it
// the screen's size, the orb's state, when to stop. Built on its own: server.ts /intro-worker.js, build-pages.

import type { OrbState } from "./orb";
import { IntroPainter, type PainterInit } from "./painter";

export type IntroMessage =
  | ({ type: "init" } & PainterInit)
  | { type: "size"; w: number; h: number; dpr: number }
  | { type: "orb"; state: OrbState | null }
  | { type: "stop" };

let painter: IntroPainter | null = null;

self.onmessage = (e: MessageEvent<IntroMessage>) => {
  const m = e.data;
  if (m.type === "init") {
    painter = new IntroPainter(m);
    painter.run();
    (self as unknown as Worker).postMessage({ type: "ready", mode: painter.mode });
  } else if (m.type === "size") painter?.size(m.w, m.h, m.dpr);
  else if (m.type === "orb") painter?.setOrb(m.state);
  else if (m.type === "stop") {
    painter?.stop();
    painter = null;
    self.close();
  }
};
