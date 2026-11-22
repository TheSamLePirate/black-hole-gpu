// Catalogue of built-in OBC avionics scripts (scripts/obc/*).
// Served live from `/obc/scripts/*` by server.ts (dev) and copied into `_site/obc/scripts/*` (Pages).

import type { ObcScriptMeta } from "./types";

export const OBC_SCRIPTS: readonly ObcScriptMeta[] = [
  {
    id: "diag",
    name: "obc-diag",
    label: "Diag",
    desc: "System, WGS84 telemetry & Kerr dτ/dt diagnostic dashboard",
    cmd: "obc-diag",
  },
  {
    id: "orbit",
    name: "obc-orbit",
    label: "Orbit",
    desc: "Keplerian orbital elements & Hohmann Δv calculator",
    cmd: "obc-orbit",
  },
  {
    id: "reentry",
    name: "obc-reentry",
    label: "Reentry",
    desc: "Atmospheric entry corridor, dynamic pressure q & hull heating",
    cmd: "obc-reentry",
  },
  {
    id: "ils",
    name: "obc-ils",
    label: "ILS",
    desc: "Runway Localizer & 3° Glide Slope approach guidance",
    cmd: "obc-ils",
  },
  {
    id: "solar",
    name: "obc-solar",
    label: "Solar",
    desc: "Solar system, Gargantua & Lagrange L2/JWST synoptic",
    cmd: "obc-solar",
  },
  {
    id: "fdr",
    name: "obc-fdr",
    label: "FDR",
    desc: "Flight Data Recorder (samples telemetry & computes flight stats)",
    cmd: "obc-fdr 3",
  },
  {
    id: "fb-demo",
    name: "obc-fb-demo",
    label: "FB0 Demo",
    desc: "Render live 512×512 XRGB8888 avionics graphics to /dev/fb0",
    cmd: "obc-fb-demo",
    graphical: true,
  },
] as const;

export const OBC_SCRIPT_FILES = [
  "obc-diag",
  "obc-orbit",
  "obc-reentry",
  "obc-ils",
  "obc-solar",
  "obc-fdr",
  "obc-fb-demo",
  "obc-install",
] as const;

export const OBC_LIB_FILES = ["lib/obc.py", "lib/obc.mjs"] as const;

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
