// What the player is told when the game draws on a Windows laptop's integrated GPU (tier.ts windowsIntegratedGpu): Chrome
// on Windows runs WebGPU on the GPU it gave the whole browser, the integrated one on most laptops, whatever the page asks.
// The way to the dedicated GPU, in the player's language — the toast at the first image, TARS's state, the help
// (docs/PLAN-LEAN-TRACER-KERNELS.md P2).
import { t } from "../i18n";

export const gpuTipText = () =>
  t(
    "This PC draws on its integrated graphics: Chrome on Windows does not pick the dedicated GPU by itself. For it — a faster image and much shorter shader compiles —: Windows Settings › System › Display › Graphics › Google Chrome › High performance, then restart Chrome.",
  );
