// The wheel's « Approach » sector (docs/PLAN-APPROCHES.md §5.4, AP8), the same for the F-35 and the A320: the automatic choice said
// (« Auto — LFML ILS 31R », its reason as the hint); the airfield (the plan's destination, the one selected, the nearest ahead); its
// runway's ends (length, wind, in use); its approaches (ILS, LOC, RNAV, built — their source); the way in (vectors, a published
// transition, a hold); arm or disarm, go around, cleared out of the hold; the displays (all the runways on the HUD, the approach on
// the maps, its profile, the flight director). Every item calls the controller's own actions — approachSelect, ilsStart, ilsOff,
// ilsGoAround, ilsClear — as the map, the radar, the crew and TARS do.

import type { CameraController } from "../controls";
import { type ApproachResolved, sayResolved } from "../controller/approach";
import { t, tf } from "../i18n";
import type { Settings } from "../settings";
import { fieldCached } from "../world/runways";
import { unitsFor } from "./unitsys";
import type { WheelItem } from "./wheel";

export interface ApproachWheelHost {
  camera: CameraController;
  settings: Settings;
  /** what an action said, shown */
  say(m: string | null | undefined): void;
  /** a player's setting flipped here: applied and written */
  setting(k: "hudAllRunways" | "approachPathOnMap" | "approachProfile" | "hudDirector", on: boolean): void;
}

/** A text the same in both languages (already said in the player's: `t`, a code, a number). */
const both = (s: string) => ({ fr: s, en: s });
const endOf = (s: string) => s.replace(/^0+(?=\d)/, "").toUpperCase();

/** The sector. */
export function approachWheel(H: ApproachWheelHost): WheelItem {
  const c = H.camera;
  const u = unitsFor(H.settings);
  const by = t("wheel");
  const S = c.approachSel;
  const flown = !!c.ilsRun || !!c.a320App;
  const sel = (x: Parameters<CameraController["approachSelect"]>[0]) => () => H.say(c.approachSelect(x, by));
  // (what an engagement now would fly: the auto choice's words, the airfield the lists are of)
  const pv = c.approachPreview();
  const R: ApproachResolved | null = pv !== "loading" && !("say" in pv) ? pv : null;
  const code = R ? R.field.icao || R.field.ident : S.field !== "auto" ? S.field : null;
  const f = code ? (R?.field ?? fieldCached(code)) : null;
  const card = f ? c.approachCard(f) : null;
  const autoWhat =
    R && S.field === "auto"
      ? R.approach.kind === "VIS"
        ? tf("{0} {1} built", code ?? "", R.approach.rwy)
        : `${code} ${R.approach.kind} ${R.approach.rwy}`
      : "";
  const items: WheelItem[] = [
    {
      label: autoWhat ? { fr: `Auto — ${autoWhat}`, en: `Auto — ${autoWhat}` } : { fr: "Auto", en: "Auto" },
      hint:
        R && S.field === "auto"
          ? both(sayResolved(R, u))
          : { fr: "Le terrain, la piste et l'approche choisis pour vous", en: "The airfield, runway and approach chosen for you" },
      on: S.field === "auto",
      run: sel({ field: "auto", rwy: "auto", approach: "auto", via: "auto" }),
    },
    {
      label: { fr: "Terrain", en: "Airfield" },
      on: S.field !== "auto",
      sub: [
        { label: { fr: "Auto", en: "Auto" }, on: S.field === "auto", run: sel({ field: "auto" }) },
        ...c.approachFields().map(
          (x): WheelItem => ({
            label: both(`${x.code} · ${u.fDist(x.dist, 0)}`),
            hint: both(
              `${x.name} — ${x.why === "plan" ? t("the plan's destination") : x.why === "selected" ? t("selected") : t("the nearest ahead")}`,
            ),
            on: S.field === x.code,
            run: sel({ field: x.code }),
          }),
        ),
      ],
    },
  ];
  if (f && card && code) {
    const mine = S.field === code;
    items.push({
      label: { fr: `Piste (${code})`, en: `Runway (${code})` },
      on: mine && S.rwy !== "auto",
      sub: [
        {
          label: { fr: "Auto", en: "Auto" },
          hint: card.auto ? both(card.auto.why) : undefined,
          on: mine && S.rwy === "auto" && S.approach === "auto",
          run: sel({ field: code, rwy: "auto", approach: "auto" }),
        },
        ...card.ends.map((e): WheelItem => {
          const rw = f.runways.find((r) => r.le === e.rwy || r.he === e.rwy);
          const wind =
            e.head === null ? t("calm") : e.head >= 0 ? tf("head wind {0}", u.fSpd(e.head)) : tf("tail wind {0}", u.fSpd(-e.head));
          const inUse = card.auto && card.ends.find((x) => x.approaches.some((a) => a.id === card.auto!.id))?.rwy === e.rwy;
          return {
            label: both(e.rwy),
            hint: both([rw ? u.fAlt(rw.len) : "", wind, inUse ? t("in use") : ""].filter(Boolean).join(" · ")),
            on: mine && S.rwy !== "auto" && endOf(S.rwy) === endOf(e.rwy),
            run: sel({ field: code, rwy: e.rwy, approach: "auto" }),
          };
        }),
      ],
    });
    // (the approaches: of the end chosen, else of every end)
    const list = card.ends.filter((e) => !mine || S.rwy === "auto" || endOf(e.rwy) === endOf(S.rwy)).flatMap((e) => e.approaches);
    if (list.length)
      items.push({
        label: { fr: "Approche", en: "Approach" },
        on: mine && S.approach !== "auto",
        sub: list.slice(0, 12).map((a) => ({
          label: both(a.text.split(" · ")[0]!),
          hint: both(a.text),
          on: mine && S.approach === a.id,
          run: sel({ field: code, approach: a.id }),
        })),
      });
    // (the way in: vectors, a published transition, a hold at the initial fix — the hold engages the approach)
    const chosen = mine && S.approach !== "auto" ? list.find((a) => a.id === S.approach) : undefined;
    items.push({
      label: { fr: "Entrée", en: "Way in" },
      on: mine && S.via !== "auto",
      sub: [
        { label: { fr: "Auto", en: "Auto" }, on: S.via === "auto", run: sel({ via: "auto" }) },
        {
          label: { fr: "Guidage radar", en: "Radar vectors" },
          hint: { fr: "Sans transition : vers la finale", en: "No transition: to the final" },
          on: S.via === "none",
          run: sel({ via: "none" }),
        },
        ...(chosen?.vias ?? []).map((v) => ({
          label: { fr: `Par ${v}`, en: `Via ${v}` },
          on: S.via === v,
          run: sel({ via: v }),
        })),
        {
          label: { fr: "Attente, 1 tour", en: "Hold, 1 lap" },
          hint: {
            fr: "Un tour d'hippodrome au point initial, puis l'approche",
            en: "A lap of the racetrack at the initial fix, then the approach",
          },
          run: () => H.say(c.ilsStart(undefined, { hold: 1 })),
        },
        {
          label: { fr: "Attente jusqu'à autorisation", en: "Hold until cleared" },
          run: () => H.say(c.ilsStart(undefined, { hold: Number.POSITIVE_INFINITY })),
        },
      ],
    });
  }
  items.push(
    flown
      ? { label: { fr: "Désarmer", en: "Disarm" }, on: true, run: () => (c.ilsOff(), H.say(t("ILS approach off"))) }
      : { label: { fr: "Armer l'approche", en: "Arm the approach" }, run: () => H.say(c.ilsStart()) },
  );
  if (flown) items.push({ label: { fr: "Remise de gaz", en: "Go around" }, run: () => H.say(c.ilsGoAround()) });
  if (c.ilsRun?.phase === "hold") items.push({ label: { fr: "Autorisé", en: "Cleared" }, run: () => H.say(c.ilsClear()) });
  const st = H.settings;
  const flip = (k: "hudAllRunways" | "approachPathOnMap" | "approachProfile" | "hudDirector") => () => H.setting(k, !st[k]);
  items.push({
    label: { fr: "Affichages", en: "Displays" },
    sub: [
      { label: { fr: "Toutes les pistes (HUD)", en: "All the runways (HUD)" }, on: st.hudAllRunways, run: flip("hudAllRunways") },
      { label: { fr: "Approche sur les cartes", en: "Approach on the maps" }, on: st.approachPathOnMap, run: flip("approachPathOnMap") },
      { label: { fr: "Profil vertical", en: "Vertical profile" }, on: st.approachProfile, run: flip("approachProfile") },
      { label: { fr: "Directeur de vol", en: "Flight director" }, on: st.hudDirector, run: flip("hudDirector") },
    ],
  });
  return {
    label: { fr: "Approche", en: "Approach" },
    hint: flown
      ? { fr: "L'approche volée : la changer, la remise de gaz, les affichages", en: "The approach flown: change it, go around, displays" }
      : { fr: "Choisir et armer l'approche, ses affichages", en: "Choose and arm the approach, its displays" },
    on: flown,
    sub: items,
  };
}
