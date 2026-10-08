// The tablet's CHARTS page (PLAN-AEROPORTS A5): the approach chart of the site the craft flies to or is
// near — a runway end's (the Ranger's own approach: its fixes, its steep-then-shallow profile, its minima,
// its missed approach) or a pad's (its gates, its minima, its climb) —, in plan and in profile, the craft
// where it is on both, and the fixes' table. Drawn as SVG at the panel's width; the distances on a
// square-root scale (as a chart's broken scale: the 25 km of the entry and the last kilometre both
// readable), the heights too.

import { LANDING, landingProfile } from "../controller/util";
import { procedureFor, type Procedure } from "../game/procedures";
import { RUNWAY_LENGTH, type Site } from "../game/sites";
import { tr, type Text } from "../i18n";
import { el, h } from "./kit";

export interface ChartsDeps {
  /** the site to chart (its end in service) and the craft on its frame (along, across, height over the ground [m]), or null */
  approach(): { site: Site; craft: { along: number; across: number; agl: number } | null } | null;
}

const NAMES: Record<string, Text> = {
  IAF: { fr: "Entrée (IAF)", en: "Initial fix (IAF)" },
  FAF: { fr: "Finale (FAF)", en: "Final fix (FAF)" },
  PU: { fr: "Ressource", en: "Pull-up" },
  DH: { fr: "Minima (DH)", en: "Minima (DH)" },
  TD: { fr: "Toucher", en: "Touchdown" },
  MA: { fr: "Virage de remise de gaz", en: "Missed approach turn" },
  MAHF: { fr: "Attente", en: "Hold" },
  HG: { fr: "Porte haute", en: "High gate" },
  LG: { fr: "Porte basse", en: "Low gate" },
};

const km = (m: number) => (Math.abs(m) >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
/** the square-root scale, signed */
const sq = (v: number) => Math.sign(v) * Math.sqrt(Math.abs(v));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const diamond = (x: number, y: number, r: number) =>
  `<path d="M${x.toFixed(1)},${(y - r).toFixed(1)} l${r},${r} l${-r},${r} l${-r},${-r} Z" class="ch-fix"/>`;

export class ChartsPage {
  readonly el = h("div", { class: "ch-page", "data-testid": "charts-page" });
  private key = "";
  private planCraft: SVGPathElement | null = null;
  private profCraft: SVGPathElement | null = null;
  /** chart coordinates of the craft: plan (along, across), profile (along, height) */
  private planXY = (_a: number, _c: number): [number, number] => [0, 0];
  private profXY = (_a: number, _h: number): [number, number] => [0, 0];

  constructor(private d: ChartsDeps) {}

  /** A few times a second: the chart (anew when the site or its end changes), the craft on it. */
  draw() {
    const a = this.d.approach();
    const key = a ? `${a.site.name}|${a.site.rwy ?? ""}|${a.site.reverse ? 1 : 0}` : "";
    if (key !== this.key) {
      this.key = key;
      this.build(a?.site ?? null);
    }
    const c = a?.craft;
    const put = (g: SVGPathElement | null, xy: () => [number, number]) => {
      if (!g) return;
      g.style.display = c ? "" : "none";
      if (!c) return;
      const [x, y] = xy();
      g.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    };
    // (off the chart's frame, the craft waits at its edge)
    put(this.planCraft, () => this.planXY(c!.along, c!.across));
    put(this.profCraft, () => this.profXY(c!.along, c!.agl));
  }

  private build(site: Site | null) {
    this.el.replaceChildren();
    this.planCraft = this.profCraft = null;
    if (!site) {
      this.el.append(
        el(
          "p",
          "ch-none",
          tr({ fr: "Pas d'approche : choisissez un site (Ordinateur › Atterrir).", en: "No approach: pick a site (Computer › Land)." }),
        ),
      );
      return;
    }
    const p = procedureFor(site);
    const runway = p.kind === "runway";
    const num = runway ? String(Math.round(p.rwy! / 10) % 36 || 36).padStart(2, "0") : "";
    const head = el("div", "ch-head");
    head.dataset.testid = "charts-head";
    head.append(
      el("b", "", runway ? `RWY ${num}` : "PAD"),
      el("span", "", site.name.split(",")[0]!),
      el(
        "small",
        "",
        runway
          ? tr({ fr: "approche façon navette · MLS", en: "Shuttle-style approach · MLS" })
          : tr({ fr: "descente propulsée", en: "powered descent" }),
      ),
    );
    this.el.append(head, this.planView(p), this.profileView(p), this.table(p), this.notes(p));
  }

  /** the along range charted [m]: from before the entry fix to past the missed approach's turn */
  private range(p: Procedure): [number, number] {
    return p.kind === "runway" ? [-28000, RUNWAY_LENGTH + 4000] : [-2600, 400];
  }

  /** the plan, the approach up the chart: the runway (or the pad), the final course, the missed approach, the fixes */
  private planView(p: Procedure) {
    const W = 276,
      H = 250;
    const runway = p.kind === "runway";
    const [a0, a1] = this.range(p);
    const c0 = runway ? -10000 : -600,
      c1 = runway ? 3000 : 600;
    const x = (c: number) => 16 + ((c - c0) / (c1 - c0)) * (W - 32);
    const y = (a: number) => H - 14 - ((sq(a) - sq(a0)) / (sq(a1) - sq(a0))) * (H - 40);
    this.planXY = (a, c) => [x(clamp(c, c0, c1)), y(clamp(a, a0, a1))];
    let s = `<svg viewBox="0 0 ${W} ${H}" class="ch-svg" role="img" aria-label="${tr({ fr: "Vue en plan", en: "Plan view" })}">`;
    s += `<text x="8" y="14" class="ch-t">${tr({ fr: "VUE EN PLAN", en: "PLAN VIEW" })}</text>`;
    if (runway) {
      const [ma, hold] = p.missed;
      s += `<line x1="${x(0)}" y1="${y(a0)}" x2="${x(0)}" y2="${y(0)}" class="ch-course"/>`;
      // (the missed approach: ahead to the turn, left round, out along the reciprocal to the hold, round onto the axis again)
      const P = (a: number, c: number) => `${x(c).toFixed(1)},${y(a).toFixed(1)}`;
      s += `<path d="M${P(RUNWAY_LENGTH, 0)} L${P(ma!.along, 0)} C${P(ma!.along + 3000, 0)} ${P(ma!.along + 3000, hold!.across)} ${P(ma!.along, hold!.across)} L${P(hold!.along, hold!.across)} C${P(hold!.along - 4000, hold!.across)} ${P(hold!.along - 4000, 0)} ${P(hold!.along + 2000, 0)}" class="ch-missed"/>`;
      s += `<rect x="${(x(0) - 3).toFixed(1)}" y="${y(RUNWAY_LENGTH).toFixed(1)}" width="6" height="${(y(0) - y(RUNWAY_LENGTH)).toFixed(1)}" class="ch-rwy"/>`;
    } else {
      s += `<line x1="${x(0)}" y1="${y(a0)}" x2="${x(0)}" y2="${y(0)}" class="ch-course"/>`;
      s += `<circle cx="${x(0)}" cy="${y(0)}" r="6" class="ch-rwy"/>`;
    }
    for (const f of [...p.fixes, ...p.missed]) {
      // (a pad's minima, touchdown and hold sit on it: its mark says them)
      if (!runway && f.along === 0) continue;
      const cx = x(f.across),
        cy = y(f.along);
      s += diamond(cx, cy, 5);
      s += `<text x="${(cx + 9).toFixed(1)}" y="${(cy + 4).toFixed(1)}" class="ch-l">${f.id}</text>`;
    }
    s += `<path d="M0,-7 L5,6 L-5,6 Z" class="ch-craft" data-testid="charts-plan-craft"/>`;
    s += "</svg>";
    const box = el("div", "ch-box");
    box.innerHTML = s;
    this.planCraft = box.querySelector(".ch-craft");
    return box;
  }

  /** the profile: the height down the approach (the decision height and the pull-up readable under kilometres) */
  private profileView(p: Procedure) {
    const W = 276,
      H = 180;
    const runway = p.kind === "runway";
    const [a0, a1] = this.range(p);
    const top = runway ? 5500 : 2400;
    const x = (a: number) => 46 + ((sq(a) - sq(a0)) / (sq(a1) - sq(a0))) * (W - 54);
    const g = H - 34;
    const y = (hh: number) => g - Math.sqrt(Math.max(hh, 0) / top) * (g - 22);
    this.profXY = (a, hh) => [x(clamp(a, a0, a1)), y(Math.min(top, hh))];
    let s = `<svg viewBox="0 0 ${W} ${H}" class="ch-svg" role="img" aria-label="${tr({ fr: "Profil", en: "Profile" })}">`;
    s += `<text x="8" y="14" class="ch-t">${tr({ fr: "PROFIL", en: "PROFILE" })}</text>`;
    for (const hh of runway ? [100, 500, 1500, 3000] : [100, 500, 2000]) {
      s += `<line x1="${x(a0)}" y1="${y(hh).toFixed(1)}" x2="${x(a1)}" y2="${y(hh).toFixed(1)}" class="ch-grid"/><text x="${x(a0) - 4}" y="${(y(hh) + 3).toFixed(1)}" class="ch-g" text-anchor="end">${km(hh)}</text>`;
    }
    s += `<line x1="${x(a0)}" y1="${g}" x2="${x(a1)}" y2="${g}" class="ch-ground"/>`;
    if (runway) {
      s += `<rect x="${x(0).toFixed(1)}" y="${g - 2}" width="${(x(RUNWAY_LENGTH) - x(0)).toFixed(1)}" height="4" class="ch-rwy"/>`;
      s += `<line x1="${x(a0)}" y1="${y(p.minima.dh).toFixed(1)}" x2="${x(a1)}" y2="${y(p.minima.dh).toFixed(1)}" class="ch-dh"/>`;
      // (the Ranger's profile: the steep outer glide, the pull-up, the shallow glide, the flare)
      const fix = { go: LANDING.goNom, lb: 3000 };
      let d = "";
      for (let a = a0; a <= LANDING.td; a += a < -3000 ? 250 : 25)
        d += `${d ? "L" : "M"}${x(a).toFixed(1)},${y(landingProfile(a, 0, 150, fix).h).toFixed(1)}`;
      s += `<path d="${d}" class="ch-course"/>`;
      // (the missed approach: from the minima up ahead, to the turn, on to the hold's height)
      const [ma, hold] = p.missed;
      const dh = p.fixes.find((f) => f.id === "DH")!;
      s += `<path d="M${x(dh.along).toFixed(1)},${y(dh.h).toFixed(1)} L${x(ma!.along).toFixed(1)},${y(ma!.h).toFixed(1)} L${x(a1).toFixed(1)},${y(hold!.h).toFixed(1)}" class="ch-missed"/>`;
    } else {
      s += `<line x1="${x(a0)}" y1="${y(p.minima.dh).toFixed(1)}" x2="${x(a1)}" y2="${y(p.minima.dh).toFixed(1)}" class="ch-dh"/>`;
      const [hg, lg] = p.fixes;
      s += `<path d="M${x(hg!.along)},${y(hg!.h)} L${x(lg!.along)},${y(lg!.h)} L${x(0)},${y(0)}" class="ch-course"/>`;
      s += `<path d="M${x(0)},${y(p.minima.dh)} L${x(0)},${y(p.missed[0]!.h)}" class="ch-missed"/>`;
    }
    // (the fixes on the path; their names under the ground line, on two rows: the last kilometre's are close)
    p.fixes.forEach((f, i) => {
      const cx = x(f.along),
        cy = y(f.h);
      s += diamond(cx, cy, 4);
      s += `<line x1="${cx.toFixed(1)}" y1="${(cy + 4).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${g + 6 + (i % 2) * 11}" class="ch-lead"/>`;
      s += `<text x="${cx.toFixed(1)}" y="${g + 14 + (i % 2) * 11}" class="ch-l" text-anchor="middle">${f.id}</text>`;
    });
    s += `<path d="M7,0 L-6,-5 L-6,5 Z" class="ch-craft" data-testid="charts-prof-craft"/>`;
    s += "</svg>";
    const box = el("div", "ch-box");
    box.innerHTML = s;
    this.profCraft = box.querySelector(".ch-craft");
    return box;
  }

  /** the fixes: their names, their distance to the threshold (+: past it), their heights */
  private table(p: Procedure) {
    const t = h("table", { class: "ch-table", "data-testid": "charts-fixes" });
    const head = el("tr");
    for (const c of ["", tr({ fr: "Au seuil", en: "To thr." }), tr({ fr: "Hauteur", en: "Height" })]) head.append(el("th", "", c));
    t.append(head);
    for (const f of [...p.fixes, ...p.missed]) {
      const r = el("tr", p.missed.includes(f) ? "ch-miss" : "");
      r.append(
        el("td", "", `${f.id} · ${tr(NAMES[f.id]!)}`),
        el("td", "", f.along === 0 && f.across === 0 ? "—" : f.along > 0 ? `+${km(f.along)}` : km(-f.along)),
        el("td", "", km(f.h)),
      );
      t.append(r);
    }
    return t;
  }

  /** the minima and the missed approach in words */
  private notes(p: Procedure) {
    const n = el("div", "ch-notes");
    n.append(
      el(
        "div",
        "ch-min",
        `${tr({ fr: "Minima", en: "Minima" })} · DH ${p.minima.dh} m · ${tr({ fr: "visibilité", en: "visibility" })} ${km(p.minima.vis)}`,
      ),
      el(
        "p",
        "",
        p.kind === "runway"
          ? tr({
              fr: "Remise de gaz : si l'approche n'est pas stabilisée à la DH (plus de 45 m de l'axe ou 30 m du profil), moteurs pleins, tout droit jusqu'à 1 500 m, virage à gauche, montée à 3 km en s'éloignant le long de l'axe, à 8 km à gauche, jusqu'à l'attente à 20 km du seuil, puis une nouvelle approche.",
              en: "Missed approach: if the approach is not stabilised at the DH (over 45 m off the axis or 30 m off the profile), full power, straight ahead to 1,500 m, turn left, climb to 3 km outbound along the axis, 8 km to its left, to the hold 20 km out, then a new approach.",
            })
          : tr({
              fr: "Remise de gaz : montée verticale à 500 m, attente au-dessus du pad, puis une nouvelle descente.",
              en: "Missed approach: climb straight up to 500 m, hold over the pad, then a new descent.",
            }),
      ),
    );
    return n;
  }
}
