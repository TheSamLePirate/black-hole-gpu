// Catalogue of built-in OBC avionics scripts (scripts/obc/*).
// Includes instant shell tools + full Python 3 & Node.js CLI, interactive TUI, and real-time /dev/fb0 graphical apps.
// Served live from `/obc/scripts/*` by server.ts (dev) and copied into `_site/obc/scripts/*` (Pages).

import type { ObcScriptMeta } from "./types";

export const OBC_SCRIPTS: readonly ObcScriptMeta[] = [
  // ── Instant Shell & CLI Commands ───────────────────────────────────────────
  {
    id: "diag",
    name: "obc-diag",
    label: "Diag",
    desc: "System, WGS84 telemetry & Kerr dτ/dt diagnostic dashboard",
    cmd: "obc-diag",
    category: "cli",
    lang: "sh",
  },
  {
    id: "orbit",
    name: "obc-orbit",
    label: "Orbit",
    desc: "Keplerian orbital elements & Hohmann Δv calculator",
    cmd: "obc-orbit",
    category: "cli",
    lang: "sh",
  },
  {
    id: "reentry",
    name: "obc-reentry",
    label: "Reentry",
    desc: "Atmospheric entry corridor, dynamic pressure q & hull heating",
    cmd: "obc-reentry",
    category: "cli",
    lang: "sh",
  },
  {
    id: "ils",
    name: "obc-ils",
    label: "ILS",
    desc: "Runway Localizer & 3° Glide Slope approach guidance",
    cmd: "obc-ils",
    category: "cli",
    lang: "sh",
  },
  {
    id: "solar",
    name: "obc-solar",
    label: "Solar",
    desc: "Solar system, Gargantua & Lagrange L2/JWST synoptic",
    cmd: "obc-solar",
    category: "cli",
    lang: "sh",
  },
  {
    id: "fdr",
    name: "obc-fdr",
    label: "FDR",
    desc: "Flight Data Recorder (samples telemetry & computes flight stats)",
    cmd: "obc-fdr 3",
    category: "cli",
    lang: "sh",
  },
  {
    id: "fuel",
    name: "obc-fuel",
    label: "Fuel·Py",
    desc: "Python CLI: Tsiolkovsky Δv, jet endurance, range & bingo calculator",
    cmd: "obc-fuel",
    category: "cli",
    lang: "python",
  },
  {
    id: "nav",
    name: "obc-nav",
    label: "Nav·JS",
    desc: "Node.js CLI: WGS84 great-circle bearing, distance & ETA to airfields",
    cmd: "obc-nav",
    category: "cli",
    lang: "node",
  },
  {
    id: "kerr",
    name: "obc-kerr",
    label: "Kerr·Py",
    desc: "Python CLI: Kerr metric horizon, photon sphere, ISCO & time dilation",
    cmd: "obc-kerr",
    category: "cli",
    lang: "python",
  },
  {
    id: "auto",
    name: "obc-auto",
    label: "Auto·JS",
    desc: "Node.js CLI: Bidirectional autopilot/throttle/gear/SAS command bridge",
    cmd: "obc-auto status",
    category: "cli",
    lang: "node",
  },
  {
    id: "bh",
    name: "bh",
    label: "BH CLI",
    desc: "Universal __bh & TARS CLI (ls/get/set/call/tools/tool/search/eval/watch, JSON I/O)",
    cmd: "bh ls",
    category: "cli",
    lang: "node",
  },
  {
    id: "airports",
    name: "obc-airports",
    label: "Airports",
    desc: "World airfields, real FAA CIFP/nav.dat approaches, ILS & flight plan builder",
    cmd: "obc-airports list",
    category: "cli",
    lang: "node",
  },
  {
    id: "f35",
    name: "obc-f35",
    label: "F-35",
    desc: "Full F-35B/C tactical CLI (fly, AP, radar, weapons, lock, fire, PCD, wingmen)",
    cmd: "obc-f35 status",
    category: "cli",
    lang: "node",
  },
  {
    id: "a320",
    name: "obc-a320",
    label: "A320",
    desc: "Full Airbus A320 CLI (fly, FCU, live Captain MCDU screen/LSK/type, Lower ECAM)",
    cmd: "obc-a320 status",
    category: "cli",
    lang: "node",
  },

  // ── Real-Time Interactive TUIs ─────────────────────────────────────────────
  {
    id: "bh-tui",
    name: "bh-tui",
    label: "BH TUI",
    desc: "Interactive navigable __bh API tree & 73 TARS tools inspector/runner TUI",
    cmd: "bh-tui",
    category: "tui",
    lang: "node",
  },
  {
    id: "top",
    name: "obc-top",
    label: "Top TUI",
    desc: "Node.js interactive real-time avionics monitor (sparklines, SAS/gear/thr hotkeys)",
    cmd: "obc-top",
    category: "tui",
    lang: "node",
  },
  {
    id: "mission-tui",
    name: "obc-mission-tui",
    label: "Mission TUI",
    desc: "Python interactive orbital flight director & circularization Δv TUI",
    cmd: "obc-mission-tui",
    category: "tui",
    lang: "python",
  },
  {
    id: "fmc-tui",
    name: "obc-fmc-tui",
    label: "FMC TUI",
    desc: "Node.js interactive Airbus/Boeing FMS, ILS needles & nearest airfields TUI",
    cmd: "obc-fmc-tui",
    category: "tui",
    lang: "node",
  },
  {
    id: "f35-tui",
    name: "obc-f35-tui",
    label: "F-35 TUI",
    desc: "Real-time F-35 WSO/backseater console (stores, radar, traffic, AP/ILS 1-key controls)",
    cmd: "obc-f35-tui",
    category: "tui",
    lang: "node",
  },
  {
    id: "a320-tui",
    name: "obc-a320-tui",
    label: "A320 TUI",
    desc: "Real-time Airbus A320 FCU + live mirrored Captain MCDU + Lower ECAM TUI",
    cmd: "obc-a320-tui",
    category: "tui",
    lang: "node",
  },

  // ── Real-Time Graphical /dev/fb0 Applications ──────────────────────────────
  {
    id: "fb-demo",
    name: "obc-fb-demo",
    label: "Orbit FB0",
    desc: "Live 512×512 XRGB8888 orbital & telemetry scope on /dev/fb0 (offline + Python)",
    cmd: "obc-fb-demo",
    category: "fb",
    lang: "sh",
    graphical: true,
  },
  {
    id: "pfd-fb",
    name: "obc-pfd-fb",
    label: "PFD FB0",
    desc: "Python real-time graphical Primary Flight Display (horizon, pitch ladder, tapes)",
    cmd: "obc-pfd-fb",
    category: "fb",
    lang: "python",
    graphical: true,
  },
  {
    id: "radar-fb",
    name: "obc-radar-fb",
    label: "Radar FB0",
    desc: "Node.js real-time sweeping tactical radar & orbital ellipse scope on /dev/fb0",
    cmd: "obc-radar-fb",
    category: "fb",
    lang: "node",
    graphical: true,
  },
  {
    id: "kerr-fb",
    name: "obc-kerr-fb",
    label: "Kerr FB0",
    desc: "Python real-time Gargantua relativistic accretion disk & spacetime well on /dev/fb0",
    cmd: "obc-kerr-fb",
    category: "fb",
    lang: "python",
    graphical: true,
  },
  {
    id: "f35-fb",
    name: "obc-f35-fb",
    label: "F-35 TSD",
    desc: "Node.js real-time F-35 TSD / AN/APG-81 ±60° tactical radar & tracks on /dev/fb0",
    cmd: "obc-f35-fb",
    category: "fb",
    lang: "node",
    graphical: true,
  },
  {
    id: "a320-fb",
    name: "obc-a320-fb",
    label: "A320 ND",
    desc: "Node.js real-time Airbus A320 ARC-mode Navigation Display + route + TCAS on /dev/fb0",
    cmd: "obc-a320-fb",
    category: "fb",
    lang: "node",
    graphical: true,
  },
  {
    id: "ils-fb",
    name: "obc-ils-fb",
    label: "ILS FB0",
    desc: "Python real-time split Plan View + 3° Glidepath Profile + LOC/GS diamonds on /dev/fb0",
    cmd: "obc-ils-fb",
    category: "fb",
    lang: "python",
    graphical: true,
  },
] as const;

export const OBC_SCRIPT_FILES = [
  "bh",
  "bh-tui",
  "obc-diag",
  "obc-orbit",
  "obc-reentry",
  "obc-ils",
  "obc-solar",
  "obc-fdr",
  "obc-fb-demo",
  "obc-install",
  "obc-fuel",
  "obc-nav",
  "obc-kerr",
  "obc-auto",
  "obc-airports",
  "obc-f35",
  "obc-a320",
  "obc-top",
  "obc-mission-tui",
  "obc-fmc-tui",
  "obc-f35-tui",
  "obc-a320-tui",
  "obc-pfd-fb",
  "obc-radar-fb",
  "obc-kerr-fb",
  "obc-f35-fb",
  "obc-a320-fb",
  "obc-ils-fb",
] as const;

export const OBC_LIB_FILES = ["lib/obc.py", "lib/obc.mjs", "lib/bh-cli.mjs"] as const;

export function findObcScript(idOrName: string): ObcScriptMeta | undefined {
  const q = idOrName.trim().toLowerCase();
  return OBC_SCRIPTS.find((s) => s.id === q || s.name === q || s.label.toLowerCase() === q);
}

/** Fetch all project scripts & libraries from `/obc/scripts/*` for live 9p mounting into Linux. */
export async function loadProjectScripts(baseUrl = "/obc/scripts"): Promise<{
  scripts: Record<string, string>;
  lib: Record<string, string>;
}> {
  const scripts: Record<string, string> = {};
  const lib: Record<string, string> = {};
  const fetchText = async (path: string): Promise<string | null> => {
    try {
      const r = await fetch(`${baseUrl}/${path}`, { cache: "no-store" });
      return r.ok ? await r.text() : null;
    } catch {
      return null;
    }
  };
  await Promise.all([
    ...OBC_SCRIPT_FILES.map(async (f) => {
      const text = await fetchText(f);
      if (text !== null) scripts[f] = text;
    }),
    ...OBC_LIB_FILES.map(async (f) => {
      const text = await fetchText(f);
      if (text !== null) lib[f.slice("lib/".length)] = text;
    }),
  ]);
  return { scripts, lib };
}
