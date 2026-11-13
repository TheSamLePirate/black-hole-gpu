// The craft's instruments and poses for the renderer, made before its image is encoded (audit 2026-11-10, AR-12 — main() cut by
// responsibility, wave 4.8; AR-04, strategy §19.5): the cockpit's screens, the dashboard, the gear's oleos, the F-35's and the
// A320's surfaces, gear, nozzle, lights and glass, the A320's displays and deck, the taxi guidance, the F-35's PCD, the cockpit's
// controls. Out of main.ts's loop (13 Nov 2026), as it was there — each frame's `frame({ pil, info, status, dt })` —, this module
// owning the state only it reads (the last jet inputs, the A320's display set, the PCD's pending regions and pace).

import { DuSet } from "../a320/du";
import { duData } from "../a320/du/data";
import { type DeckGame, deckExterior, deckSync } from "../a320/deckgame";
import type { DeckControls } from "../a320/deckctl";
import type { DeckPoser } from "../a320/deck";
import type { Frost, Wiper } from "../a320/glass";
import type { Mcdu } from "../a320/mcdu/mcdu";
import type { A320Poser } from "../a320/pose";
import { tugVehicle } from "../a320/services";
import { poseData } from "../cockpit/controls";
import type { Chrono } from "../cockpit/chrono";
import { type ControlTravel, controlStates } from "../cockpit/state";
import type { CameraController } from "../controls";
import { pcdData } from "../f35/cockpit";
import type { Pcd, PcdRect } from "../f35/pcd";
import type { JetInputs, JetPoser } from "../f35/pose";
import { fleet } from "../fleet";
import { GEARS } from "../gear";
import type { Renderer } from "../renderer";
import type { Settings } from "../settings";
import type { Simulation } from "../sim";
import type { CockpitScreens } from "../ui/cockpitscreens";
import { alertsOf } from "../ui/hud/alerts";
import type { NetSession } from "../ui/netsession";
import type { TaxiGuide } from "../ui/taxiguide";
import { M_SECONDS } from "../units";
import { isAircraft, VESSELS } from "../vessels";
import { dateOf } from "./tools";
import type { Session } from "./session";
import type { RangerStatus } from "./status";

export interface CraftFeedDeps {
  renderer: Renderer;
  camera: CameraController;
  settings: Settings;
  sim: Simulation;
  session: Session;
  canvas: HTMLCanvasElement;
  netSession: NetSession;
  cockpitScreens: CockpitScreens;
  cockpitChrono: Chrono;
  cockpitTravel: ControlTravel;
  jetPoser: JetPoser;
  jetPcd: Pcd;
  pcdStats: { frames: number; draws: number; ms: number; max: number; up: number; read: number };
  a320Poser: A320Poser;
  a320GlassSim: { wipers: [Wiper, Wiper]; frost: Frost };
  a320Mcdus: () => [Mcdu, Mcdu];
  deckPoser: DeckPoser;
  deckGame: DeckGame;
  deckMarker: { el: HTMLElement; at: [number, number, number] | null };
  /** the deck's controls (made at the deck's first look) */
  deckCtl: () => DeckControls | null;
  taxiGuide: TaxiGuide;
}

export class CraftFeed {
  /** the F-35's pose inputs last given (the replay's, the tests') */
  jetIn: JetInputs | null = null;
  /** the A320's display units, made at the deck's first draw */
  private duSet: DuSet | null = null;
  /** the F-35's PCD: its fonts readied once; its changed regions waiting for their upload, the last upload's time */
  private pcdWarm = false;
  private pcdPending: PcdRect[] = [];
  private pcdSentAt = -Infinity;

  constructor(private d: CraftFeedDeps) {}

  /** The frame's: the craft's poses and instruments for the renderer (`pil`: a craft flown; `info`: its figures). */
  frame(pil: boolean, info: ReturnType<CameraController["flightInfo"]> | null, status: RangerStatus | null, dt: number) {
    const {
      renderer,
      camera,
      settings,
      sim,
      session,
      canvas,
      netSession,
      cockpitScreens,
      cockpitChrono,
      cockpitTravel,
      jetPoser,
      jetPcd,
      pcdStats,
      a320Poser,
      a320GlassSim,
      a320Mcdus,
      deckPoser,
      deckGame,
      deckMarker,
      taxiGuide,
    } = this.d;
    const deckCtl = this.d.deckCtl();
    if (pil && info) {
      // the cockpit's screens: the telemetry, drawn (a few times a second, while the cabin is seen)
      if (
        renderer.ship.cabinShown &&
        cockpitScreens.draw({
          info,
          status,
          settings,
          time: sim.time,
          runway: camera.runwayView(),
          chrono:
            cockpitChrono.running || cockpitChrono.seconds() > 0 ? { s: cockpitChrono.seconds(), running: cockpitChrono.running } : null,
          systems: camera.systemsInfo(),
          ticks: camera.sysTicks,
          rcs: camera.rcsMode ?? "rotate",
          met: !isAircraft(fleet.active) && Number.isFinite(camera.metT0) ? sim.time * M_SECONDS - camera.metT0 : null,
        })
      ) {
        renderer.ship.updateScreens(cockpitScreens.canvas);
        renderer.cockpitGlow = cockpitScreens.glow;
      }
      // the cockpit's dashboard: the local up and the motion on the ship's axes, the speed, the height
      {
        const S = info.S as number[][];
        const toShip = (v: number[] | null | undefined) =>
          v ? ([0, 1, 2].map((i) => S[0]![i]! * v[0]! + S[1]![i]! * v[1]! + S[2]![i]! * v[2]!) as [number, number, number]) : null;
        const up = toShip(info.dirs.radialOut as number[] | null),
          fwd = toShip(info.dirs.prograde as number[] | null);
        renderer.cockpitDash = {
          up: up ?? [0, 1, 0],
          fwd: fwd ?? [0, 0, 1],
          speed: (status?.speed ?? 0) / 1000,
          alt: status?.altKm ?? 0,
          time: performance.now() / 1000,
        };
        // (the Ranger's landing gear, drawn when out — its oleos as the gear's physics has them)
        {
          const legs = GEARS.ranger!.legs;
          const gl = camera.gearLast?.legs;
          renderer.shipGear = {
            ext: settings.vessel === "ranger" ? camera.gearExt : 0,
            comp: legs.map((L, k) => Math.min(Math.max(gl?.[k]?.comp ?? 0, 0), L.stroke)),
          };
        }
        // (the F-35's moving parts: its control surfaces as its flight controls move them, its gear, its
        // nozzle, its canopy — src/f35/pose.ts)
        if (settings.vessel === "f35") {
          const gl = camera.gearLast?.legs;
          const legs = GEARS.f35!.legs;
          const th = renderer.shipThrust;
          const L = camera.airFlight.last;
          const onGround = !!camera.gearLast && camera.gearLast.contact > 0;
          const speed = status?.speed ?? 0;
          renderer.jetPose = jetPoser.step(
            (this.jetIn = {
              dt,
              // (the pilot's: the roll left-positive — pilot.ts —; here right-positive)
              torque: th ? [th.torque[0], th.torque[1], -th.torque[2]] : [0, 0, 0],
              rates: ((r) => [camera.pilot.omega[0] / r[0], camera.pilot.omega[1] / r[1], -camera.pilot.omega[2] / r[2]])(
                VESSELS.f35.fbw!.rates,
              ) as [number, number, number],
              throttle: th?.throttle ?? 0,
              afterburner: (th?.boost ?? 1) > 1.01,
              alpha: L?.out.alpha ?? 0,
              flaps: camera.airFlight.cfg.flaps ?? 0,
              brake: camera.airFlight.cfg.brake ?? 0,
              gear: camera.gearExt,
              comp: legs.map((Lg, k) => Math.min(Math.max(gl?.[k]?.comp ?? 0, 0), Lg.stroke)) as [number, number, number],
              onGround,
              groundSpeed: speed,
              steer: onGround ? (th?.torque[1] ?? 0) : 0,
              parked: onGround && speed < 0.5 && (th?.throttle ?? 0) <= 0.02 && !camera.stovl.on,
              stovl: camera.stovl.conv,
              nozzle: camera.stovl.swivel,
              fan: camera.stovl.fan,
            }),
          );
          // (another player followed: his surfaces, his gear, his nozzle — ui/netsession.ts)
          if (netSession.followJet) renderer.jetPose = netSession.followJet;
        } else this.jetIn = null;
        // (the A320's: its surfaces as its flight controls move them, its slats and flaps by configuration, its
        // spoilers, its gear and doors, its fans, its lights — src/a320/pose.ts)
        if (settings.vessel === "a320") {
          renderer.ship.setA320Livery(settings.a320Livery);
          const gl = camera.gearLast?.legs;
          const legs = GEARS.a320!.legs;
          const th = renderer.shipThrust;
          const L = camera.airFlight.last;
          const onGround = !!camera.gearLast && camera.gearLast.contact > 0;
          const speed = status?.speed ?? 0;
          const r = VESSELS.a320.fbw!.rates;
          const cmd = (k: number, sgn: number) =>
            Math.min(Math.max(sgn * (0.55 * (th?.torque[k] ?? 0) + (0.75 * camera.pilot.omega[k]!) / r[k]!), -1, 1), 1);
          const F = camera.a320;
          const n1s: [number, number] = F ? [F.engines[0].n1, F.engines[1].n1] : [0, 0];
          const deckOut = deckExterior(deckPoser.props);
          renderer.a320Pose = a320Poser.step({
            dt,
            pitch: cmd(0, 1),
            yaw: cmd(1, 1),
            // (the pilot's roll left-positive — pilot.ts —; here right-positive)
            roll: cmd(2, -1),
            trim: 0,
            flapLever: Math.round((camera.airFlight.cfg.flaps ?? 0) * 4),
            ias: Math.sqrt((2 * (L?.out.q ?? 0)) / 1.225) * 1.9438,
            speedBrake: camera.airBrake,
            groundSpoilers: camera.groundSpoilers && onGround ? 1 : 0,
            gear: camera.gearExt,
            comp: legs.map((Lg, k) => Math.min(Math.max(gl?.[k]?.comp ?? 0, 0), Lg.stroke)) as [number, number, number],
            onGround,
            groundSpeed: speed,
            steer: onGround ? (th?.torque[1] ?? 0) : 0,
            n1: n1s,
            reverser: F ? [F.engines[0].rev, F.engines[1].rev] : [0, 0],
            fcs: F,
            alpha: ((L?.out.alpha ?? 0) * 180) / Math.PI,
            landingLights: settings.landingLights || deckOut.landingOut,
            wipers: deckOut.wipers,
            // (its doors opened by its ground services — src/a320/services.ts)
            doors: camera.a320Ground?.doors(),
          });
          // (its ground vehicles about it, the pushback's tug at its nose — controller/a320ground.ts)
          {
            const gv = camera.a320Ground?.vehicles() ?? [];
            const po = camera.a320PushOut;
            if (po && po.attach > 0) gv.push(tugVehicle(po.bar, po.attach));
            renderer.a320Ground = gv.length ? gv : null;
          }
          // (the lights its switches turn off: the taxi, turn-off and wing lights — ship.ts)
          Object.assign(renderer.a320Pose.props, {
            "deck/taxi": deckOut.taxi ? 1 : 0,
            "deck/turnoff": deckOut.turnoff ? 1 : 0,
            "deck/wing": deckOut.wing ? 1 : 0,
            // (its wings' bend under their load — src/a320/flex.ts —: the tip's rise [m])
            "sim/wing-flex": camera.a320WingTip,
          });
          // (its windshield — src/a320/glass.ts —: the wipers by their knobs on DC 1, the arms posed outside by them; the
          // frost in icing, the window heat clearing it; the rain on the glass, seen from inside)
          {
            const P = deckPoser.props;
            const G = a320GlassSim;
            // (reached by the e2e: its frost laid, its wipers read)
            (renderer as unknown as { a320GlassSim: typeof G }).a320GlassSim = G;
            const num = (k: string, d = 0) => Number(P[k] ?? d) || 0;
            const dc1 = num("systems/electrical/bus/dc-1", 28) >= 25;
            const wp = G.wipers.map((w, k) => w.step(num(`controls/switches/wiper${k ? "R" : "L"}spd`), dc1, dt)) as [number, number];
            renderer.a320Pose.props["fdm/jsbsim/fcs/left-wiper-pos-norm"] = wp[0];
            renderer.a320Pose.props["fdm/jsbsim/fcs/right-wiper-pos-norm"] = wp[1];
            const ac = Math.max(
              num("systems/electrical/bus/ac-1"),
              num("systems/electrical/bus/ac-2"),
              num("systems/electrical/bus/ac-ess"),
            );
            const rain = renderer.rain && !renderer.rain.dust ? Math.min(renderer.rain.rain, 1.3) : 0;
            const oatC = (L?.air?.T ?? 288.15) - 273.15;
            // (the de-icing truck's fluid: the frost washed off the glass too — src/a320/services.ts)
            if (camera.a320Ground?.on.has("deice") && camera.a320Ground.deiceLeft > 0) G.frost.ice = Math.max(G.frost.ice - dt / 30, 0);
            const frost = G.frost.step(
              {
                oatC,
                // (the moisture: the rain, or a cloud layer the craft is in — the weather's)
                wet: Math.max(
                  rain,
                  ...(camera.weatherNow?.layers ?? []).map((l) => {
                    const h = camera.airFlight.cfg.agl ?? 0;
                    return h >= l.base && h <= l.top ? l.cover : 0;
                  }),
                ),
                heat: num("controls/ice-protection/windowprobeheat-output") > 0.5 && ac >= 110,
                onGround,
              },
              settings.animate && !session.frozen ? dt : 0,
            );
            renderer.a320Glass = {
              rain,
              clock: renderer.rainClock,
              airspeed: L?.speed ?? 0,
              frost,
              wipers: wp,
              rates: [G.wipers[0].shaderRate, G.wipers[1].shaderRate],
            };
          }
          // (its flight deck — from inside, its switches all the time: the side stick as the pilot moves it, the levers,
          // the pedals; the game's state on its switches — src/a320/deck.ts, deckgame.ts)
          deckSync(deckGame, deckPoser.props);
          // (the ECAM's aurals: FlightGear's recordings, played by its sound files on the warnings' properties the ECAM
          // writes — src/a320/sound —; its queue emptied)
          camera.a320Ecam?.takeAurals();
          {
            const tq = th?.torque ?? [0, 0, 0];
            const c1 = (x: number) => Math.min(Math.max(x, -1), 1);
            const deckProps = deckPoser.step({
              dt,
              stick: [c1(tq[0]!), c1(-tq[2]!)],
              pedals: onGround ? 0 : c1(tq[1]!),
              tiller: onGround ? c1(tq[1]!) : 0,
              gearDown: camera.gearDown,
              fcs: F,
              lever: camera.pilot.throttle,
              reverse: camera.a320Reverse && onGround && camera.pilot.throttle <= 0.01 ? 1 : 0,
              flapLever: Math.round((camera.airFlight.cfg.flaps ?? 0) * 4),
              speedBrake: camera.airBrake,
              spoilersArmed: !!camera.groundSpoilers,
              parkBrake: camera.a320Park,
              // (the buses: the systems', once they run)
              powered: camera.a320Sys ? undefined : true,
            });
            renderer.a320Deck = settings.shipMount === "cockpit" || settings.shipMount === "cabin" ? deckProps : null;
            // (the control under the pointer lit: its objects — ship.ts deckHover)
            const hc = renderer.a320Deck && deckCtl ? deckCtl.control(deckCtl.focus) : null;
            const dm = renderer.ship.a320DeckMesh;
            renderer.ship.deckHover = hc && dm ? hc.objects.map((o) => dm.objects.indexOf(o)).filter((k) => k >= 0) : null;
            // (its displays — src/a320/du —, drawn while the deck is: two a frame at most, into the atlas)
            const deckMesh = renderer.ship.a320DeckMesh;
            if (renderer.a320Deck && deckMesh && renderer.ship.deckMats) {
              this.duSet ??= renderer.a320Du = new DuSet(deckMesh.screens, deckMesh.texts, a320Mcdus());
              renderer.ship.updateDu(this.duSet.frame(performance.now() / 1000, duData(camera, settings, deckProps, dateOf(sim.time))));
            }
            // (a checklist's item shown: a ring over its control — ui/a320page.ts)
            const mk = renderer.a320Deck && deckMarker.at ? renderer.ship.cabinProject(deckMarker.at) : null;
            if (mk && Math.abs(mk[0]) < 1.1 && Math.abs(mk[1]) < 1.1) {
              const b = canvas.getBoundingClientRect();
              deckMarker.el.style.display = "block";
              deckMarker.el.style.left = `${b.left + ((mk[0] + 1) / 2) * b.width}px`;
              deckMarker.el.style.top = `${b.top + ((1 - mk[1]) / 2) * b.height}px`;
            } else deckMarker.el.style.display = "none";
          }
        }
        // (the A320's taxi guidance in the view — ui/taxiguide.ts —: its route ahead on the ground, the next turn)
        taxiGuide.frame(
          camera,
          fleet.active === "a320" && settings.ship ? (p) => renderer.ship.cabinProject(p) : null,
          () => canvas.getBoundingClientRect(),
          settings.units,
        );
        // (the F-35 chosen: its display's fonts, canvas and mips readied while the browser idles — no stall at the
        // cockpit's first look)
        if (settings.vessel === "f35" && !this.pcdWarm) {
          this.pcdWarm = true;
          (window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 200)))(() => {
            jetPcd.warm();
            renderer.ship.warmJetScreen(jetPcd.canvas);
          });
        }
        // (the F-35's panoramic display, seen from its seat: drawn at 10 Hz, onto the dashboard)
        if (settings.vessel === "f35" && (settings.shipMount === "cockpit" || settings.shipMount === "cabin")) {
          const t0 = performance.now();
          // (its data read every 100 ms, its parts drawn in turn — one a frame —, only those uploaded)
          // (the designation cursor on a page of it: drawn there — PLAN-RADAR-AAA constat 29)
          const T = camera.tdc;
          jetPcd.tdc = T.on && T.screen?.kind === "pcd" ? { u: T.x, v: T.y } : null;
          const parts = jetPcd.frame(t0, () => {
            const al = alertsOf({ ...info, status, animate: settings.animate, fmtM: () => "" }).map((a) => ({
              text: a.text,
              level: a.level,
            }));
            const d = pcdData(camera, settings, renderer.jetPose, al, dateOf(sim.time));
            pcdStats.read += performance.now() - t0;
            return d;
          });
          renderer.pcdLook = jetPcd.look(t0, settings.f35PcdBrightness, settings.f35PcdStyle === "cinematic");
          // (the parts drawn gathered and sent together — one copy of their union, one pass of mips — every 66 ms at
          // most, at once after a touch: a third of the uploads, a delay no eye sees)
          this.pcdPending.push(...parts);
          const touched = (jetPcd.lastTouch?.at ?? -Infinity) > this.pcdSentAt;
          if (this.pcdPending.length && (touched || t0 - this.pcdSentAt >= 66)) {
            const t1 = performance.now();
            const x0 = Math.min(...this.pcdPending.map((r) => r.x)),
              y0 = Math.min(...this.pcdPending.map((r) => r.y));
            const x1 = Math.max(...this.pcdPending.map((r) => r.x + r.w)),
              y1 = Math.max(...this.pcdPending.map((r) => r.y + r.h));
            renderer.ship.updateJetScreen(jetPcd.canvas, [{ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }]);
            this.pcdPending.length = 0;
            this.pcdSentAt = t0;
            pcdStats.draws++;
            pcdStats.up += performance.now() - t1;
          }
          const dt = performance.now() - t0;
          pcdStats.frames++;
          pcdStats.ms += dt;
          pcdStats.max = Math.max(pcdStats.max, dt);
        }
        // (the cockpit's controls: each where the flight has it, lit by its mode — PLAN-COCKPIT)
        // (each moving part travelling there: a lever moved by a key or an autopilot seen going — K5)
        if (renderer.ship.cabinShown)
          renderer.cockpitControls = poseData(
            cockpitTravel.step(
              controlStates(camera, settings, cockpitChrono, {
                hover: camera.cockpit?.input.hover ?? null,
                pressed: camera.cockpit?.input.pressed ?? null,
              }),
              dt,
            ),
          );
      }
    }
  }
}
