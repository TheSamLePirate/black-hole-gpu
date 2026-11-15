// The crew console's tiles (audit 2026-11-10, QA-10: src/crew/main.ts — 2 318 lines — never imported by a test): what each one shows —
// its figure, its unit, its state (ok, warn, alarm), its title — from the craft's metrics and snapshot, in the console's units and
// language. Moved out of main.ts's tiles() as it was; tested in tests/crew-tiles.test.ts.

import type { unitsOf } from "../ui/unitsys";
import { dur } from "./draw/kit";
import { eventName } from "./draw/spacestat";
import { L, locale } from "./lang";
import type { CrewModel } from "./model";
import type { TileKey } from "./profile";

export type CrewOwn = ReturnType<CrewModel["own"]>;

export interface TileShown {
  text: string;
  unit: string;
  /** "", "ok", "warn" or "alarm" */
  state: string;
  title?: string;
}

/** A tile's figure, unit (`unit`: its usual one, changed where the figure asks), state and title; its craft not heard for 3 s: "—". */
export function tileValue(k: TileKey, own: CrewOwn, u: ReturnType<typeof unitsOf>, unit0: string): TileShown {
  const live = !!own && own.age < 3;
  const m = own?.metrics ?? {},
    snap = own?.snapshot,
    f = snap?.flight,
    sys = snap?.sys;
  const fmt0 = (v: number | undefined | null, d = 0) =>
    v === undefined || v === null || !Number.isFinite(v)
      ? "—"
      : v.toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d });
  let text = "—",
    state = "",
    unit = unit0,
    title: string | undefined;
  if (live) {
    switch (k) {
      case "alt":
        text =
          m.alt !== undefined && Math.abs(m.alt) > 99_999
            ? `${fmt0(m.alt / 1000, 1)}`
            : fmt0(m.alt !== undefined ? u.alt(m.alt) : undefined);
        if (m.alt !== undefined && Math.abs(m.alt) > 99_999) unit = "km";
        break;
      case "speed": {
        const v = f?.tas ?? m.speed;
        text = fmt0(v !== undefined ? u.spd(v) : undefined);
        break;
      }
      case "vz":
        text = m.vz !== undefined ? `${m.vz > 0.5 ? "▲" : m.vz < -0.5 ? "▼" : ""}${fmt0(Math.abs(u.vs(m.vz)))}` : "—";
        state = m.vz !== undefined && m.vz < -40 ? "warn" : "";
        break;
      case "mach":
        text = fmt0(m.mach, 2);
        state = m.mach !== undefined && m.mach > 1 ? "warn" : "";
        break;
      case "g":
        text = fmt0(f?.nz ?? m.g, 1);
        state = f?.gMax && Math.abs(f.nz ?? m.g ?? 0) > f.gMax * 0.9 ? "alarm" : Math.abs(f?.nz ?? m.g ?? 1) > 5 ? "warn" : "";
        break;
      case "hdg": {
        const h = f?.hdg ?? own?.geo?.heading;
        text = h === undefined ? "—" : String(Math.round(((((h * 180) / Math.PI) % 360) + 360) % 360) % 360).padStart(3, "0");
        break;
      }
      case "fuel":
        if (sys?.fuelKg != null && sys.fuelFull) {
          text = fmt0(sys.fuelKg);
          unit = "kg";
        } else text = fmt0(m.fuel !== undefined ? m.fuel * 100 : undefined);
        {
          const frac = sys?.fuelKg != null && sys.fuelFull ? sys.fuelKg / sys.fuelFull : m.fuel;
          state = frac === undefined ? "" : frac < 0.1 ? "alarm" : frac < 0.25 ? "warn" : "ok";
        }
        break;
      case "agl": {
        // (a spacecraft's descent block first — the flight's radio altimeter else)
        const h = snap?.desc?.agl ?? f?.agl;
        text = snap?.craft?.status === "landed" ? L("posé", "landed") : h != null && h < 30_000 ? fmt0(u.alt(h)) : "—";
        state = h != null && h < 150 && (m.vz ?? 0) < -3 ? "warn" : "";
        break;
      }
      case "hs":
        text = snap?.desc ? fmt0(u.spd(snap.desc.vh), snap.desc.vh < 10 ? 1 : 0) : "—";
        state = snap?.desc && snap.desc.vh > 2 && (snap.desc.agl ?? 1e9) < 50 ? "warn" : "";
        break;
      case "ring":
        text = snap?.ring ? fmt0(snap.ring.rpm, 1) : "—";
        break;
      case "dv": {
        const dv = snap?.budget?.dv;
        // (a big one in km/s: the tile is narrow)
        text = dv === null ? "∞" : dv !== undefined && dv >= 100_000 ? fmt0(dv / 1000, 1) : fmt0(dv);
        if (dv != null && dv >= 100_000) unit = "km/s";
        state = dv != null && dv < 200 ? "warn" : "";
        break;
      }
      case "prop": {
        const pr = snap?.budget?.prop ?? (m.fuel !== undefined ? m.fuel : null);
        text = fmt0(pr !== null ? pr * 100 : null);
        state = pr === null ? "" : pr < 0.1 ? "alarm" : pr < 0.25 ? "warn" : "ok";
        break;
      }
      case "pe":
        if (snap?.craft?.status === "landed") {
          text = L("posé", "landed");
          unit = "";
          break;
        }
        text = fmt0(snap?.orbit?.pe, Math.abs(snap?.orbit?.pe ?? 0) < 100 ? 1 : 0);
        state = snap?.orbit && snap.orbit.pe < 0 ? "alarm" : "";
        break;
      case "ap":
        text = snap?.orbit
          ? snap.orbit.ecc >= 1
            ? L("libre", "escape")
            : fmt0(snap.orbit.ap, Math.abs(snap.orbit.ap) < 100 ? 1 : 0)
          : "—";
        if (snap?.orbit && snap.orbit.ecc >= 1) unit = "";
        break;
      case "period":
        text = dur(snap?.orbit?.period ?? null);
        break;
      case "next":
        // (short: the tile is narrow — 15 min, not 14 min 57)
        text = !snap?.next ? "—" : snap.next.in < 60 || snap.next.in >= 3600 ? dur(snap.next.in) : `${Math.round(snap.next.in / 60)} min`;
        unit = "";
        title = snap?.next ? `${eventName(snap.next)} ${L("dans", "in")} ${dur(snap.next.in)}` : "";
        state = snap?.next?.kind === "impact" ? "alarm" : "";
        break;
      case "dtau":
        text = fmt0(snap?.time?.dtau, 4);
        state = snap?.time && snap.time.dtau < 0.99 ? "warn" : "";
        break;
      case "link":
        text = snap?.link ? (snap.link.cut ? L("coupée", "cut") : dur(snap.link.light)) : "—";
        unit = snap?.link && !snap.link.cut ? L("lumière", "light") : "";
        state = snap?.link?.cut ? "alarm" : "";
        break;
    }
  }
  return { text, unit, state, ...(title !== undefined ? { title } : {}) };
}
