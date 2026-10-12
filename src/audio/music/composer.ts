// The composer: a theme (music/themes.ts) played bar by bar — where the bar falls in the form (its section, the
// form looped from its verse once through), its chord (the section's progression, voiced near the last), its
// energy (the section's, raised or lowered by the flight's intensity) and the band's notes for it: the drums by
// their style (the hats and shakers first, the kick, the snare, fills before a stronger section, a crash and a
// boom at a drop, a riser at the end of a build), the sub bass on the chord's root, the pads and the organ held,
// the choir on the chord's top, the arpeggio, the ethereal guitar (an arpeggio in dotted eighths, swells, high
// harmonics), the lead (a motif of two bars, answered, on the chord's tones at its strong beats). Pure and
// deterministic: the same theme, bar, intensity and variation, the same notes.

import type { Layer, Section, Theme } from "./themes";
import { chordOn, degreeNote, Rng, seedOf, voiceLead } from "./theory";

/** A note of the bar: its layer and instrument, its start and length [beats from the bar's start], its pitch (MIDI;
 *  the drums: none), its velocity 0 … 1, its place in the stereo field (−1 … 1). */
export interface NoteEvent {
  layer: Layer;
  inst: string;
  beat: number;
  dur: number;
  note: number;
  vel: number;
  pan?: number;
}

export interface BarPlan {
  bar: number;
  section: Section;
  /** the bar's place in its section, the section's index in the form */
  inSection: number;
  sectionIndex: number;
  /** the bar's energy 0 … 1 and its chord (MIDI, root first) */
  energy: number;
  chord: number[];
  /** the chord's root (its name's; the voicing may be inverted) */
  root: number;
  events: NoteEvent[];
}

/** Each layer's entry: the energy from which it plays. */
export const ENTRY: Record<string, number> = {
  pad: 0,
  organ: 0,
  guitar: 0.1,
  choir: 0.3,
  bass: 0.22,
  shaker: 0.3,
  hat: 0.42,
  kick: 0.5,
  snare: 0.6,
  arp: 0.52,
  lead: 0.72,
  fill: 0.55,
};

/** Where a bar falls in the form: the section, its index, the bar in it (the form looped from loopFrom). */
export function placeInForm(theme: Theme, bar: number): { section: Section; index: number; inSection: number } {
  const F = theme.form;
  const total = F.reduce((a, s) => a + s.bars, 0);
  let b = bar;
  let start = 0;
  if (b >= total) {
    const loop = F.slice(theme.loopFrom).reduce((a, s) => a + s.bars, 0);
    b = (b - total) % Math.max(loop, 1);
    start = theme.loopFrom;
  }
  for (let i = start; i < F.length; i++) {
    if (b < F[i]!.bars) return { section: F[i]!, index: i, inSection: b };
    b -= F[i]!.bars;
  }
  return { section: F[F.length - 1]!, index: F.length - 1, inSection: 0 };
}

/** The next section after one (its energy: a fill before a stronger one). */
function nextSection(theme: Theme, index: number): Section {
  return theme.form[index + 1] ?? theme.form[theme.loopFrom]!;
}

/** The bar's energy: the section's, the flight's intensity (0.5: as written) raising or lowering it. */
export function barEnergy(section: Section, intensity: number): number {
  return Math.min(1, Math.max(0, section.energy * (0.45 + 1.1 * intensity)));
}

/** The chord of a bar: its section's progression, its steps each so many bars, looped. */
export function chordStepOf(theme: Theme, section: Section, inSection: number) {
  const key = section.prog ?? ((section.name === "build" || section.name === "drop") && theme.progressions.b ? "b" : "a");
  const prog = theme.progressions[key] ?? theme.progressions.a!;
  const len = prog.reduce((a, s) => a + (s.bars ?? 1), 0);
  let b = inSection % len;
  for (const s of prog) {
    const n = s.bars ?? 1;
    if (b < n) return { step: s, first: b === 0 };
    b -= n;
  }
  return { step: prog[0]!, first: true };
}

const pat = (s: string) => [...s].map((c, i) => (c === "x" ? i : c === "o" ? -i - 1 : null)).filter((x) => x !== null) as number[];

/** The drums' patterns by style: per piece, the sixteenths struck ("x"; "o": a ghost note). */
const DRUMS: Record<string, Record<string, string>> = {
  four: {
    kick: "x...x...x...x...",
    snare: "....x.......x...",
    hat: "..x...x...x...x.",
    hat16: "x.xxx.xxx.xxx.xx",
    shaker: "x.x.x.x.x.x.x.x.",
  },
  half: {
    kick: "x.........x.....",
    snare: "........x.......",
    hat: "x.x.x.x.x.x.x.x.",
    hat16: "x.xxx.xxx.xxx.xx",
    shaker: "..x...x...x...x.",
  },
  break: {
    kick: "x.....x...x.....",
    snare: "....x..o....x..o",
    hat: "x.x.x.x.x.x.x.x.",
    hat16: "xxxxxxxxxxxxxxxx",
    shaker: "x.x.x.x.x.x.x.x.",
  },
  epic: {
    kick: "x.......x.......",
    snare: "....x.......x...",
    tom: "......x.x.....xx",
    hat: "x...x...x...x...",
    hat16: "x.x.x.x.x.x.x.x.",
    shaker: "x.x.x.x.x.x.x.x.",
  },
  pulse: {
    kick: "x.......x.......",
    snare: "............x...",
    hat: "..x...x...x...x.",
    hat16: "x.x.x.x.x.x.x.x.",
    shaker: "x.x.x.x.x.x.x.x.",
  },
  tribal: {
    kick: "x.......x.......",
    snare: "....x.......x...",
    tom: "x..x..x...x.x...",
    hat: "x.x.x.x.x.x.x.x.",
    hat16: "xxxxxxxxxxxxxxxx",
    shaker: "xxxxxxxxxxxxxxxx",
  },
  booms: { kick: "", snare: "", hat: "", hat16: "", shaker: "" },
};

/** The lead's motif for a theme and variation: two bars of (sixteenth, scale step from the chord's root, length). */
export function leadMotif(theme: Theme, seed: number): { at: number; step: number; len: number }[] {
  const r = new Rng(seedOf(theme.id, "motif", seed));
  const n = Math.max(2, Math.min(10, Math.round((theme.lead?.density ?? 4) * 1.6 + r.int(-1, 1))));
  // (its rhythm: n onsets among the 32 sixteenths of two bars, on the beat more often than not)
  const slots = new Set<number>([0]);
  while (slots.size < n) {
    const beat = r.int(0, 7);
    const off = r.pick([0, 0, 0, 2, 2, 3]);
    slots.add(Math.min(31, beat * 4 + off));
  }
  const at = [...slots].sort((a, b) => a - b);
  // (its contour: steps of the scale, mostly by step, a leap now and then, back towards the middle)
  let step = r.pick([0, 2, 4]);
  return at.map((a, i) => {
    if (i > 0) step += r.pick([-2, -1, -1, 1, 1, 2, r.pick([-4, 3, 4])]);
    step = Math.max(-3, Math.min(9, step));
    const next = at[i + 1] ?? 32;
    return { at: a, step, len: Math.max(1, Math.min(next - a, 8)) };
  });
}

/**
 * The bar's notes. `intensity` 0 … 1 (0.5: as written), `seed` the variation, `prev` the last bar's chord voicing
 * (the voices led from it).
 */
export function composeBar(theme: Theme, bar: number, intensity: number, seed = 0, prev: number[] | null = null): BarPlan {
  const { section, index, inSection } = placeInForm(theme, bar);
  const e = barEnergy(section, intensity);
  const r = new Rng(seedOf(theme.id, bar, seed));
  const { step, first } = chordStepOf(theme, section, inSection);
  const chord = chordOn(theme.root, theme.scale, step.deg, step.kind ?? "triad");
  const voiced = voiceLead(prev, chord, 50, 76);
  const ev: NoteEvent[] = [];
  const push = (n: NoteEvent) => ev.push(n);
  const lastOfSection = inSection === section.bars - 1;
  const next = nextSection(theme, index);
  const swing = theme.swing ?? 0;
  const sx = (s: number) => s / 4 + (s % 2 === 1 ? swing / 4 : 0);
  const rootLow = (() => {
    let n = chord[0]!;
    while (n > 45) n -= 12;
    while (n < 33) n += 12;
    return n;
  })();

  // ---- the drums
  const D = theme.drums ? DRUMS[theme.drums]! : null;
  if (D) {
    const hit = (inst: string, s: number, vel: number, pan = 0) =>
      push({ layer: "drums", inst, beat: sx(Math.abs(s < 0 ? -s - 1 : s)), dur: 0.25, note: 0, vel: (s < 0 ? 0.35 : 1) * vel, pan });
    const fill = lastOfSection && e >= ENTRY.fill! && next.energy >= section.energy;
    if (e >= ENTRY.shaker!) for (const s of pat(D.shaker!)) hit("shaker", s, 0.25 + 0.15 * r.next(), 0.3);
    if (e >= ENTRY.hat!) {
      const h = e > 0.85 ? D.hat16! : D.hat!;
      for (const s of pat(h)) hit(e > 0.9 && s % 8 === 2 ? "openhat" : "hat", s, 0.35 + 0.35 * r.next() * (s % 4 === 0 ? 1 : 0.7), -0.25);
    }
    if (e >= ENTRY.kick!) for (const s of pat(D.kick!)) if (!(fill && s >= 12)) hit("kick", s, 0.9 + 0.1 * r.next());
    if (e >= ENTRY.snare!) {
      for (const s of pat(D.snare!))
        if (!(fill && Math.abs(s) >= 8)) hit(theme.drums === "four" && e > 0.8 ? "clap" : "snare", s, 0.8 + 0.2 * r.next());
      if (D.tom) for (const s of pat(D.tom)) hit("tom", s, 0.7 + 0.3 * r.next(), r.next() * 1.2 - 0.6);
    }
    if (fill) {
      // (a roll into the stronger section: sixteenths on the last two beats, rising)
      for (let s = 8; s < 16; s++) hit(s % 3 === 2 ? "tom" : "snare", s, 0.45 + (0.5 * (s - 8)) / 8, (s - 12) / 5);
    }
  }
  // (a drop's first bar: a crash and a boom; a build's last two bars: a riser)
  if (inSection === 0 && (section.name === "drop" || (section.name === "verse" && e > 0.6)) && theme.drums) {
    push({ layer: "drums", inst: "crash", beat: 0, dur: 4, note: 0, vel: 0.8 });
    push({ layer: "drums", inst: "boom", beat: 0, dur: 4, note: rootLow - 12, vel: 0.9 });
  }
  if (theme.drums === "booms" && first && e > 0.3)
    push({ layer: "drums", inst: "boom", beat: 0, dur: 4, note: rootLow - 12, vel: 0.4 + 0.5 * e });
  if (section.name === "build" && inSection === section.bars - 2 && e > 0.45)
    push({ layer: "drums", inst: "riser", beat: 0, dur: 8, note: 0, vel: 0.6 + 0.3 * e });

  // ---- the bass: on the chord's root, its style
  if (theme.bass && e >= ENTRY.bass!) {
    const b = theme.bass;
    const note = (beat: number, dur: number, n = rootLow, vel = 0.85, inst = "sub") =>
      push({ layer: "bass", inst, beat, dur, note: n, vel });
    if (b === "sub") note(0, 3.9);
    else if (b === "drone") {
      if (first) note(0, 4 * (step.bars ?? 1) - 0.1, rootLow, 0.75);
    } else if (b === "pulse") for (let i = 0; i < 8; i++) note(i / 2, 0.45, rootLow, i % 2 ? 0.6 : 0.85);
    else if (b === "octave")
      for (let i = 0; i < 8; i++) note(i / 2, 0.42, rootLow + (i % 2) * 12, i % 2 ? 0.65 : 0.9, i % 2 ? "growl" : "sub");
    else if (b === "synco") for (const s of pat("x..x..x...x..x..")) note(s / 4, 0.6, rootLow, 0.85);
    else if (b === "growl") {
      note(0, 3.9, rootLow, 0.7);
      for (const s of pat("x.xx.x.xx.x.x.xx"))
        push({ layer: "bass", inst: "growl", beat: s / 4, dur: 0.22, note: rootLow + 12, vel: 0.55 + 0.3 * r.next() });
    }
  }

  // ---- the pads, the organ, the choir: the chord held (its first bar: the whole step)
  const held = 4 * (step.bars ?? 1) - 0.05;
  if (first) {
    if (theme.pad) for (const n of voiced) push({ layer: "pad", inst: theme.pad, beat: 0, dur: held, note: n, vel: 0.5 + 0.3 * e });
    if (theme.organ > 0) {
      for (const n of voiced) push({ layer: "organ", inst: "organ", beat: 0, dur: held, note: n, vel: theme.organ * (0.5 + 0.4 * e) });
      push({ layer: "organ", inst: "organ", beat: 0, dur: held, note: rootLow, vel: theme.organ * 0.7 });
    }
    if (theme.choir > 0 && e >= ENTRY.choir!)
      for (const n of voiced.slice(-3))
        push({ layer: "choir", inst: "choir", beat: 0, dur: held, note: n < 57 ? n + 12 : n, vel: theme.choir * (0.4 + 0.5 * e) });
  }

  // ---- the arpeggio
  if (theme.arp && e >= ENTRY.arp!) {
    const A = theme.arp;
    const tones = [...voiced, ...(A.octaves === 2 ? voiced.map((n) => n + 12) : [])].map((n) => (n < 60 ? n + 12 : n));
    const seq =
      A.pattern === "up"
        ? tones
        : A.pattern === "cascade"
          ? [...tones].reverse()
          : A.pattern === "updown"
            ? [...tones, ...tones.slice(1, -1).reverse()]
            : tones.map(() => r.pick(tones));
    const n = 4 * A.rate;
    for (let i = 0; i < n; i++)
      push({
        layer: "arp",
        inst: A.sound === "glass" ? "glassArp" : A.sound,
        beat: i / A.rate,
        dur: 1 / A.rate,
        note: seq[i % seq.length]!,
        vel: 0.45 + 0.25 * (i % A.rate === 0 ? 1 : r.next()),
        pan: Math.sin(i * 1.3) * 0.5,
      });
  }

  // ---- the ethereal guitar
  if (theme.guitar && e >= ENTRY.guitar!) {
    const g = theme.guitar.style;
    const tones = voiceLead(null, chordOn(theme.root, theme.scale, step.deg, "add9"), 55, 81);
    if (g === "arp") {
      // (dotted eighths across the bar, the delay filling between them)
      [0, 0.75, 1.5, 2.25, 3, 3.75].forEach((b, i) =>
        push({
          layer: "guitar",
          inst: "guitar",
          beat: b,
          dur: 1.5,
          note: tones[(i * 2 + bar) % tones.length]!,
          vel: 0.45 + 0.2 * r.next(),
          pan: i % 2 ? 0.45 : -0.45,
        }),
      );
    } else if (g === "swell") {
      push({ layer: "guitar", inst: "swell", beat: 0, dur: 3.5, note: tones[tones.length - 1]!, vel: 0.55, pan: -0.3 });
      if (r.chance(0.6))
        push({ layer: "guitar", inst: "swell", beat: 2, dur: 2, note: tones[Math.max(0, tones.length - 2)]!, vel: 0.45, pan: 0.35 });
    } else {
      for (const b of [0, 1.5, 2.5])
        if (b === 0 || r.chance(0.6))
          push({ layer: "guitar", inst: "harmonic", beat: b, dur: 2, note: r.pick(tones) + 12, vel: 0.5, pan: r.next() - 0.5 });
    }
  }

  // ---- the lead: the motif on bars 1–2 of each four, its answer (a third up, the end changed) on 3–4; resting
  // the last bar of eight
  if (theme.lead && e >= ENTRY.lead! && !(bar % 8 === 7)) {
    const M = leadMotif(theme, seed);
    const half = bar % 2;
    const answer = bar % 4 >= 2;
    const centre = theme.lead.register;
    let base = degreeNote(theme.root, theme.scale, step.deg);
    while (base < centre - 7) base += 12;
    while (base > centre + 5) base -= 12;
    const degOfBase = (() => {
      // (the chord's root as a scale degree in the register)
      for (let d = -14; d < 28; d++) if (degreeNote(theme.root, theme.scale, d) === base) return d;
      return step.deg;
    })();
    for (const m of M) {
      if (Math.floor(m.at / 16) !== half) continue;
      let s = m.step + (answer ? 2 : 0);
      if (answer && m === M[M.length - 1]) s -= 3;
      let note = degreeNote(theme.root, theme.scale, degOfBase + s);
      const beatInBar = (m.at % 16) / 4;
      // (on a strong beat: the nearest chord tone)
      if (beatInBar % 1 === 0) {
        const pcs = chord.map((n) => ((n % 12) + 12) % 12);
        let best = note,
          bd = 99;
        for (let k = -3; k <= 3; k++)
          if (pcs.includes((((note + k) % 12) + 12) % 12) && Math.abs(k) < bd) (bd = Math.abs(k)), (best = note + k);
        note = best;
      }
      push({
        layer: "lead",
        inst: theme.lead.sound === "bell" ? "bell" : theme.lead.sound === "soft" ? "softlead" : "lead",
        beat: beatInBar,
        dur: m.len / 4,
        note,
        vel: 0.65 + 0.2 * r.next(),
      });
    }
  }

  ev.sort((a, b) => a.beat - b.beat);
  return { bar, section, inSection, sectionIndex: index, energy: e, chord: voiced, root: chord[0]!, events: ev };
}
