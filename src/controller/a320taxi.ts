// The A320 on the ground (docs/PLAN-A320.md, A14): its taxi — the airport's network (game/airportnet.ts, from
// OpenStreetMap: game/airportfetch.ts), the route given (out: from its stand to the runway in use's holding point;
// in: once landed and slowed, from the runway to a free stand), the tower's clearance (said on the radio when the
// parking brake is let go with an engine running, or once the landing's roll is done), the guidance each frame (the
// leg rolled on, the next turn, the speed to roll at — game/taxiguide.ts) for the ND (src/a320/du/nd-data.ts) and the
// view's ground line (ui/taxiguide.ts).

import { type AirportNet, arrivalRoute, departureRoute, type Stand, type TaxiRoute } from "../game/airportnet";
import { loadAirportNet } from "../game/airportfetch";
import { type TaxiCue, taxiCue } from "../game/taxiguide";
import { runwaySitesNear } from "../world/fieldsite";
import { t, tf } from "../i18n";
import type { CameraController } from "../controls";

export interface TaxiState {
  /** the airport (its code) and its network */
  code: string;
  net: AirportNet;
  /** out: to a holding point; in: to a stand */
  kind: "out" | "in";
  /** the stand left or going to; the runway's name ("27") out */
  stand: Stand | null;
  rwy: string | null;
  route: TaxiRoute | null;
  /** the clearance's words; said yet */
  clearance: string;
  cleared: boolean;
  cue: TaxiCue | null;
  /** the route's end reached (said) */
  arrived: boolean;
}

declare module "../controls" {
  interface CameraController {
    a320Taxi: TaxiState | null;
    a320TaxiStep(onWheels: boolean): void;
    /** the network loaded and a route out made from a stand (or from where the aircraft is) to the runway in use */
    a320TaxiOut(code: string, net: AirportNet, stand: Stand | null): TaxiState | null;
  }
}

/** per controller: airborne this flight (a landing then routes in), a network loading */
const flags = new WeakMap<CameraController, { air: boolean; loading: boolean; flight: object | null }>();

const callsign = (c: CameraController) => c.a320Fmgc?.fms.fltNbr || "Kerr 320";
const rwyName = (hdg: number | undefined) => String(Math.round(((hdg ?? 0) + 360) / 10) % 36 || 36).padStart(2, "0");

function clearanceOut(c: CameraController, r: TaxiRoute | null, rwy: string): string {
  if (!r) return tf("{0}, taxi to runway {1} at your discretion", callsign(c), rwy);
  const cross = r.crosses.length ? tf(", cross runway {0}", r.crosses.join(", ")) : "";
  return tf("{0}, taxi to holding point runway {1} via {2}{3}", callsign(c), rwy, r.via.join(", ") || t("the apron"), cross);
}
function clearanceIn(c: CameraController, s: Stand | null, r: TaxiRoute | null): string {
  return tf("{0}, taxi to stand {1} via {2}", callsign(c), s?.ref ?? t("on the apron"), r?.via.join(", ") || t("the apron"));
}

function a320TaxiOut(this: CameraController, code: string, net: AirportNet, stand: Stand | null): TaxiState | null {
  // (the runway in use: the airfield's, by the wind — its threshold the take-off's start)
  const site =
    runwaySitesNear(net.origin.lat, net.origin.lon, 6000, 1200).find((s) => s.icao === code) ??
    runwaySitesNear(net.origin.lat, net.origin.lon, 6000, 1200)[0];
  if (!site) return null;
  const use = this.runwayInUse(site);
  const end = { lat: use.lat, lon: use.lon, hdg: use.rwy ?? 0 };
  let from = stand?.node;
  if (from === undefined) {
    const g = this.geoNow();
    if (!g) return null;
    const a = arrivalRoute(net, { lat: g.lat, lon: g.lon });
    from = a?.route.nodes[0];
  }
  const route = from !== undefined ? departureRoute(net, from, end) : null;
  const rwy = rwyName(use.rwy);
  this.a320Taxi = {
    code,
    net,
    kind: "out",
    stand,
    rwy,
    route,
    clearance: clearanceOut(this, route, rwy),
    cleared: false,
    cue: null,
    arrived: false,
  };
  return this.a320Taxi;
}

function a320TaxiStep(this: CameraController, onWheels: boolean) {
  const F = flags.get(this) ?? flags.set(this, { air: false, loading: false, flight: null }).get(this)!;
  // (a new flight — its systems made anew —: nothing of the last one's)
  if (F.flight !== this.a320) {
    F.flight = this.a320;
    F.air = false;
  }
  const g = this.geoNow();
  if (!g) return;
  const at = { lat: g.lat, lon: g.lon };
  const kt = g.gs * 1.943844;
  if (!onWheels && (this.a320FmgcIn?.ra ?? 0) > 50) {
    F.air = true;
    // (in the air: the way out left behind)
    if (this.a320Taxi?.kind === "out") this.a320Taxi = null;
  }
  // ---- landed and slowed on an airfield: its network, a free stand, the way there
  if (onWheels && F.air && kt < 40 && !F.loading && this.a320Taxi?.kind !== "in") {
    const site = runwaySitesNear(at.lat, at.lon, 5000, 1200)[0];
    if (site?.icao) {
      F.loading = true;
      void loadAirportNet(site.icao, site.lat, site.lon).then((net) => {
        F.loading = false;
        F.air = false;
        if (!net) return;
        const a = arrivalRoute(net, at);
        this.a320Taxi = {
          code: site.icao!,
          net,
          kind: "in",
          stand: a?.stand ?? null,
          rwy: null,
          route: a?.route ?? null,
          clearance: clearanceIn(this, a?.stand ?? null, a?.route ?? null),
          cleared: true,
          cue: null,
          arrived: false,
        };
        this.onRadio?.(this.a320Taxi.clearance, "tower");
      });
    } else F.air = false;
  }
  const T = this.a320Taxi;
  if (!T?.route || !onWheels) return;
  T.cue = taxiCue(T.route, at, T.cue?.i ?? 0);
  // ---- out: cleared once the parking brake is let go with an engine running (the tug gone: not for its pushback)
  const towed = !!this.a320Push && this.a320Push.phase !== "idle";
  if (!T.cleared && !this.a320Park && !towed && this.a320?.engines.some((e) => e.running)) {
    T.cleared = true;
    this.onRadio?.(T.clearance, "tower");
  }
  if (T.cue.done && !T.arrived && kt < 15) {
    T.arrived = true;
    this.onPilotMessage?.(
      T.kind === "out" ? tf("Holding point, runway {0}", T.rwy ?? "") : tf("Stand {0}: parking brake, engines off", T.stand?.ref ?? ""),
    );
  }
}

export function installA320Taxi(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { a320TaxiStep, a320TaxiOut });
}
