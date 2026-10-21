// The common symbology (docs/PLAN-RADAR-AAA.md RD3): one palette and one way of drawing a track, used by every radar
// and map — the HUD's scope, the panoramic display's TSD, FCR and DAS, the crew's console —, so a track looks the same
// everywhere. The NATO shapes simplified (APP-6): an aircraft's open below (a friend's arc, a hostile's chevron, an
// unknown's or a neutral's open box), a ship's or a ground unit's whole (circle, diamond, square); the civil traffic an
// open TCAS diamond; a missile a dart along its way, its target's line and time to go; a flare an orange star, chaff a
// cloud of grey dots. Their states: measured (plain), carried on (hollow, dimmer), from the datalink (dashed), known
// to the game only (the crew's « Partagé »: faded). The lock ringed, the selection an amber dashed ring. Pure (a
// canvas's 2D context in): the crew's bundle takes it too.

export type SymSide = "friend" | "hostile" | "unknown" | "neutral" | "traffic" | "carrier" | "player" | "dead";
export type SymKind = "air" | "sea" | "ground" | "missile" | "flare" | "chaff";
export type SymState = "firm" | "coast" | "datalink" | "truth";
/** A 2D context, on screen or off it (the panoramic display draws offscreen). */
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** The palette (display sRGB): one colour per side, the decoys', the selection's. */
export const PAL = {
  friend: "#5fd2ff",
  hostile: "#ff4b3c",
  unknown: "#ffd23f",
  neutral: "#eef2f6",
  traffic: "#b9c4cf",
  carrier: "#5fd2ff",
  player: "#5fd2ff",
  dead: "#7d858d",
  flare: "#ffaa3c",
  chaff: "#c8ccd6",
  select: "#ffb43c",
  /** the TCAS's traffic advisory (amber) and resolution advisory (red) — RD4 */
  ta: "#ffb000",
  ra: "#ff3030",
} as const;

export interface Sym {
  kind: SymKind;
  /** the side drawn: the IFF as known (the pilot's screens, the crew's « Capteur ») or the truth (« Partagé ») */
  side: SymSide;
  state?: SymState;
  /** a player's own colour (over the side's) */
  colour?: string;
  /** its way on the screen [rad, 0 up, clockwise] (null: none known) */
  trk?: number | null;
  locked?: boolean;
  selected?: boolean;
  /** a decoy's age [s] (it fades over its last two of five) */
  age?: number;
  /** a missile at us: drawn blinking */
  atUs?: boolean;
  /** the TCAS's grading (RD4): the civil traffic's diamond filled when proximate, an amber disc for a TA, a red
   *  square for an RA (TCAS II's own); another side's shape ringed so */
  tcas?: "proximate" | "TA" | "RA" | "other";
}

/** A track's colour. */
export const symColour = (s: Pick<Sym, "side" | "colour" | "kind">): string =>
  s.kind === "flare" ? PAL.flare : s.kind === "chaff" ? PAL.chaff : (s.colour ?? PAL[s.side] ?? PAL.unknown);

/** The side a picture's track is drawn by: its IFF as known (sensors), or its truth. */
export function sideFor(T: { side: string; iff: string; colour?: string }, truth: boolean): SymSide {
  if (truth || T.side === "dead") return (T.side as SymSide) ?? "unknown";
  if (T.side === "traffic" && T.iff !== "hostile") return "traffic";
  if (T.side === "player" && T.iff !== "hostile") return "player";
  return T.iff as SymSide;
}

/**
 * A track drawn at (x, y) on a canvas: its shape `k` px across its half, lines `lw` px; its way's stick, its lock's
 * ring, its selection's. The canvas's state is left as it was.
 */
export function drawSym(g: Ctx2D, x: number, y: number, s: Sym, k: number, lw: number) {
  const col = symColour(s);
  const st = s.state ?? "firm";
  g.save();
  g.translate(x, y);
  g.strokeStyle = col;
  g.fillStyle = col;
  g.lineWidth = lw;
  g.lineJoin = "round";
  g.globalAlpha = st === "truth" ? 0.38 : st === "coast" ? 0.62 : 1;
  if (st === "datalink") g.setLineDash([lw * 2.6, lw * 1.8]);
  if (s.kind === "flare" || s.kind === "chaff") {
    const fade = Math.max(0, 1 - Math.max((s.age ?? 0) - 3, 0) / 2);
    g.globalAlpha *= fade;
    if (s.kind === "flare") {
      g.beginPath();
      for (let j = 0; j < 4; j++) {
        const a = (j * Math.PI) / 4;
        g.moveTo(-Math.cos(a) * k * 0.7, -Math.sin(a) * k * 0.7);
        g.lineTo(Math.cos(a) * k * 0.7, Math.sin(a) * k * 0.7);
      }
      g.stroke();
    } else {
      const sp = k * (0.3 + Math.min(s.age ?? 0, 3) * 0.25);
      for (let j = 0; j < 7; j++)
        g.fillRect(Math.cos(j * 2.1 + 0.4) * sp - lw * 0.6, Math.sin(j * 2.1 + 0.4) * sp - lw * 0.6, lw * 1.2, lw * 1.2);
    }
    g.restore();
    return;
  }
  if (s.kind === "missile") {
    if (s.atUs && Math.floor(performance.now() / 250) % 2 === 1) g.globalAlpha *= 0.35;
    g.rotate(s.trk ?? 0);
    g.beginPath();
    g.moveTo(0, k * 1.1);
    g.lineTo(0, -k * 0.6);
    g.stroke();
    g.beginPath();
    g.moveTo(0, -k * 1.2);
    g.lineTo(k * 0.45, -k * 0.4);
    g.lineTo(-k * 0.45, -k * 0.4);
    g.closePath();
    g.fill();
    g.restore();
    return;
  }
  const air = s.kind === "air";
  g.beginPath();
  if (s.side === "dead") {
    g.moveTo(-k * 0.8, -k * 0.8);
    g.lineTo(k * 0.8, k * 0.8);
    g.moveTo(k * 0.8, -k * 0.8);
    g.lineTo(-k * 0.8, k * 0.8);
  } else if (s.side === "traffic") {
    // (the TCAS's diamond — open, filled when proximate —, its TA's amber disc, its RA's red square)
    if (s.tcas === "TA") {
      g.fillStyle = PAL.ta;
      g.strokeStyle = PAL.ta;
      g.arc(0, 0, k * 0.8, 0, 2 * Math.PI);
      g.fill();
    } else if (s.tcas === "RA") {
      g.fillStyle = PAL.ra;
      g.strokeStyle = PAL.ra;
      g.rect(-k * 0.75, -k * 0.75, k * 1.5, k * 1.5);
      g.fill();
    } else {
      g.moveTo(0, -k * 0.85);
      g.lineTo(k * 0.85, 0);
      g.lineTo(0, k * 0.85);
      g.lineTo(-k * 0.85, 0);
      g.closePath();
      if (s.tcas === "proximate") g.fill();
    }
  } else if (air) {
    if (s.side === "friend" || s.side === "player" || s.side === "carrier") g.arc(0, k * 0.35, k, Math.PI, 2 * Math.PI);
    else if (s.side === "hostile") {
      g.moveTo(-k, k * 0.5);
      g.lineTo(0, -k * 0.65);
      g.lineTo(k, k * 0.5);
    } else {
      g.moveTo(-k * 0.8, k * 0.6);
      g.lineTo(-k * 0.8, -k * 0.6);
      g.lineTo(k * 0.8, -k * 0.6);
      g.lineTo(k * 0.8, k * 0.6);
    }
  } else if (s.side === "friend" || s.side === "player" || s.side === "carrier") g.arc(0, 0, k * 0.8, 0, 2 * Math.PI);
  else if (s.side === "hostile") {
    g.moveTo(0, -k);
    g.lineTo(k, 0);
    g.lineTo(0, k);
    g.lineTo(-k, 0);
    g.closePath();
  } else g.rect(-k * 0.75, -k * 0.75, k * 1.5, k * 1.5);
  g.stroke();
  g.setLineDash([]);
  // (its way: a stick from its centre)
  if (s.trk !== null && s.trk !== undefined && s.side !== "dead") {
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.sin(s.trk) * k * 2.2, -Math.cos(s.trk) * k * 2.2);
    g.stroke();
  }
  g.globalAlpha = 1;
  // (another side's craft graded by the TCAS: ringed in the advisory's colour)
  if (s.side !== "traffic" && (s.tcas === "TA" || s.tcas === "RA")) {
    g.strokeStyle = s.tcas === "TA" ? PAL.ta : PAL.ra;
    g.lineWidth = lw * 1.2;
    g.beginPath();
    if (s.tcas === "TA") g.arc(0, 0, k * 1.35, 0, 2 * Math.PI);
    else g.rect(-k * 1.3, -k * 1.3, k * 2.6, k * 2.6);
    g.stroke();
    g.strokeStyle = col;
  }
  if (s.locked) {
    g.lineWidth = lw * 0.9;
    g.beginPath();
    g.arc(0, 0, k * 1.65, 0, 2 * Math.PI);
    g.stroke();
  }
  if (s.selected) {
    g.strokeStyle = PAL.select;
    g.lineWidth = lw * 0.9;
    g.setLineDash([lw * 2.5, lw * 2]);
    g.beginPath();
    g.arc(0, 0, k * 2.05, 0, 2 * Math.PI);
    g.stroke();
  }
  g.restore();
}
