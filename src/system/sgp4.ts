// SGP4: the orbit of an Earth satellite from its two-line elements, as NORAD/Space Force publish them
// (Hoots & Roehrich 1980, Spacetrack Report #3; the revised code of Vallado, Crawford, Hujsak & Kelso
// 2006, "Revisiting Spacetrack Report #3"). The near-Earth branch only — periods under 225 minutes:
// low orbits such as the space station's (the deep-space terms, for the Moon's and the Sun's pull on
// high orbits, are left out). WGS-72 constants, as the elements are fitted with.
//
// Positions and velocities are in TEME (true equator, mean equinox of date) [km, km/s]; temeToEcef
// turns them by the mean sidereal time (IAU 1982) into the Earth's own axes.

const TAU = 2 * Math.PI;
const MU = 398600.8; // km³/s²
export const RE_KM = 6378.135;
const XKE = 60 / Math.sqrt(RE_KM ** 3 / MU);
const J2 = 0.001082616,
  J3 = -0.00000253881,
  J4 = -0.00000165597;
const J3OJ2 = J3 / J2;
const X2O3 = 2 / 3;

export interface Elements {
  /** the elements' epoch [ms, UTC] */
  epochMs: number;
  /** mean motion [rev/day], eccentricity, inclination, ascending node, argument of perigee, mean anomaly [deg] */
  n: number;
  e: number;
  i: number;
  raan: number;
  argp: number;
  m: number;
  /** drag term B* [1/earth radii] */
  bstar: number;
  name?: string;
}

/** The elements from a two-line element set (the checksums are not checked). */
export function parseTle(l1: string, l2: string, name?: string): Elements {
  const f = (s: string) => parseFloat(s.trim());
  // (an exponent written "ddddd-e": 0.ddddd × 10^−e)
  const exp = (s: string) => {
    const t = s.trim();
    const m = /^([+-]?)(\d+)([+-]\d)$/.exec(t);
    return m ? parseFloat(`${m[1]}0.${m[2]}e${m[3]}`) : parseFloat(t) || 0;
  };
  const yy = parseInt(l1.slice(18, 20), 10);
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  const doy = f(l1.slice(20, 32));
  return {
    epochMs: Date.UTC(year, 0, 1) + (doy - 1) * 86400e3,
    bstar: exp(l1.slice(53, 61)),
    i: f(l2.slice(8, 16)),
    raan: f(l2.slice(17, 25)),
    e: parseFloat(`0.${l2.slice(26, 33).trim()}`),
    argp: f(l2.slice(34, 42)),
    m: f(l2.slice(43, 51)),
    n: f(l2.slice(52, 63)),
    name,
  };
}

/** The elements from an orbit mean-elements message (CelesTrak's JSON, "OMM"). */
export function parseOmm(o: Record<string, unknown>): Elements {
  const num = (k: string) => Number(o[k]);
  const ep = String(o.EPOCH);
  return {
    epochMs: Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(ep) ? ep : `${ep}Z`),
    n: num("MEAN_MOTION"),
    e: num("ECCENTRICITY"),
    i: num("INCLINATION"),
    raan: num("RA_OF_ASC_NODE"),
    argp: num("ARG_OF_PERICENTER"),
    m: num("MEAN_ANOMALY"),
    bstar: num("BSTAR"),
    name: String(o.OBJECT_NAME ?? ""),
  };
}

export interface Sgp4 {
  el: Elements;
  /** TEME position [km] and velocity [km/s] `minutes` after the epoch (null: decayed, or diverged) */
  propagate(minutes: number): { r: [number, number, number]; v: [number, number, number] } | null;
}

/** Prepares the propagation (sgp4init, near-Earth). */
export function sgp4(el: Elements): Sgp4 {
  const D = Math.PI / 180;
  const ecco = el.e,
    inclo = el.i * D,
    nodeo = el.raan * D,
    argpo = el.argp * D,
    mo = el.m * D;
  const noKozai = (el.n * TAU) / 1440;
  const bstar = el.bstar;
  // (initl: the mean motion's Kozai to Brouwer conversion)
  const eccsq = ecco * ecco,
    omeosq = 1 - eccsq,
    rteosq = Math.sqrt(omeosq);
  const cosio = Math.cos(inclo),
    cosio2 = cosio * cosio;
  const ak = (XKE / noKozai) ** X2O3;
  const d1 = (0.75 * J2 * (3 * cosio2 - 1)) / (rteosq * omeosq);
  let del = d1 / (ak * ak);
  const adel = ak * (1 - del * del - del * (1 / 3 + (134 * del * del) / 81));
  del = d1 / (adel * adel);
  const no = noKozai / (1 + del);
  const ao = (XKE / no) ** X2O3;
  const sinio = Math.sin(inclo);
  const po = ao * omeosq;
  const con42 = 1 - 5 * cosio2;
  const con41 = -con42 - cosio2 - cosio2;
  const posq = po * po;
  const rp = ao * (1 - ecco);
  if ((rp - 1) * RE_KM < 0 || (no * 1440) / TAU < 6.4) throw new Error("sgp4: not a near-Earth orbit");
  const isimp = rp < 220 / RE_KM + 1;
  let sfour = 78 / RE_KM + 1;
  let qzms24 = ((120 - 78) / RE_KM) ** 4;
  const perige = (rp - 1) * RE_KM;
  if (perige < 156) {
    sfour = perige < 98 ? 20 : perige - 78;
    qzms24 = ((120 - sfour) / RE_KM) ** 4;
    sfour = sfour / RE_KM + 1;
  }
  const pinvsq = 1 / posq;
  const tsi = 1 / (ao - sfour);
  const eta = ao * ecco * tsi;
  const etasq = eta * eta;
  const eeta = ecco * eta;
  const psisq = Math.abs(1 - etasq);
  const coef = qzms24 * tsi ** 4;
  const coef1 = coef / psisq ** 3.5;
  const cc2 =
    coef1 * no * (ao * (1 + 1.5 * etasq + eeta * (4 + etasq)) + ((0.375 * J2 * tsi) / psisq) * con41 * (8 + 3 * etasq * (8 + etasq)));
  const cc1 = bstar * cc2;
  const cc3 = ecco > 1e-4 ? (-2 * coef * tsi * J3OJ2 * no * sinio) / ecco : 0;
  const x1mth2 = 1 - cosio2;
  const cc4 =
    2 *
    no *
    coef1 *
    ao *
    omeosq *
    (eta * (2 + 0.5 * etasq) +
      ecco * (0.5 + 2 * etasq) -
      ((J2 * tsi) / (ao * psisq)) *
        (-3 * con41 * (1 - 2 * eeta + etasq * (1.5 - 0.5 * eeta)) +
          0.75 * x1mth2 * (2 * etasq - eeta * (1 + etasq)) * Math.cos(2 * argpo)));
  const cc5 = 2 * coef1 * ao * omeosq * (1 + 2.75 * (etasq + eeta) + eeta * etasq);
  const cosio4 = cosio2 * cosio2;
  const temp1 = 1.5 * J2 * pinvsq * no;
  const temp2 = 0.5 * temp1 * J2 * pinvsq;
  const temp3 = -0.46875 * J4 * pinvsq * pinvsq * no;
  const mdot = no + 0.5 * temp1 * rteosq * con41 + 0.0625 * temp2 * rteosq * (13 - 78 * cosio2 + 137 * cosio4);
  const argpdot = -0.5 * temp1 * con42 + 0.0625 * temp2 * (7 - 114 * cosio2 + 395 * cosio4) + temp3 * (3 - 36 * cosio2 + 49 * cosio4);
  const xhdot1 = -temp1 * cosio;
  const nodedot = xhdot1 + (0.5 * temp2 * (4 - 19 * cosio2) + 2 * temp3 * (3 - 7 * cosio2)) * cosio;
  const omgcof = bstar * cc3 * Math.cos(argpo);
  const xmcof = ecco > 1e-4 ? (-X2O3 * coef * bstar) / eeta : 0;
  const nodecf = 3.5 * omeosq * xhdot1 * cc1;
  const t2cof = 1.5 * cc1;
  const xlcof =
    Math.abs(cosio + 1) > 1.5e-12
      ? (-0.25 * J3OJ2 * sinio * (3 + 5 * cosio)) / (1 + cosio)
      : (-0.25 * J3OJ2 * sinio * (3 + 5 * cosio)) / 1.5e-12;
  const aycof = -0.5 * J3OJ2 * sinio;
  const delmo = (1 + eta * Math.cos(mo)) ** 3;
  const sinmao = Math.sin(mo);
  const x7thm1 = 7 * cosio2 - 1;
  let d2 = 0,
    d3 = 0,
    d4 = 0,
    t3cof = 0,
    t4cof = 0,
    t5cof = 0;
  if (!isimp) {
    const cc1sq = cc1 * cc1;
    d2 = 4 * ao * tsi * cc1sq;
    const temp = (d2 * tsi * cc1) / 3;
    d3 = (17 * ao + sfour) * temp;
    d4 = 0.5 * temp * ao * tsi * (221 * ao + 31 * sfour) * cc1;
    t3cof = d2 + 2 * cc1sq;
    t4cof = 0.25 * (3 * d3 + cc1 * (12 * d2 + 10 * cc1sq));
    t5cof = 0.2 * (3 * d4 + 12 * cc1 * d3 + 6 * d2 * d2 + 15 * cc1sq * (2 * d2 + cc1sq));
  }
  const vkms = (RE_KM * XKE) / 60;
  const mod = (x: number) => ((x % TAU) + TAU) % TAU;

  const propagate = (t: number) => {
    // secular gravity and drag
    const xmdf = mo + mdot * t;
    const argpdf = argpo + argpdot * t;
    const nodedf = nodeo + nodedot * t;
    let argpm = argpdf;
    let mm = xmdf;
    const t2 = t * t;
    let nodem = nodedf + nodecf * t2;
    let tempa = 1 - cc1 * t;
    let tempe = bstar * cc4 * t;
    let templ = t2cof * t2;
    if (!isimp) {
      const delomg = omgcof * t;
      const delm = xmcof * ((1 + eta * Math.cos(xmdf)) ** 3 - delmo);
      const temp = delomg + delm;
      mm = xmdf + temp;
      argpm = argpdf - temp;
      const t3 = t2 * t,
        t4 = t3 * t;
      tempa = tempa - d2 * t2 - d3 * t3 - d4 * t4;
      tempe = tempe + bstar * cc5 * (Math.sin(mm) - sinmao);
      templ = templ + t3cof * t3 + t4 * (t4cof + t * t5cof);
    }
    let nm = no;
    let em = ecco;
    const inclm = inclo;
    if (nm <= 0) return null;
    const am = (XKE / nm) ** X2O3 * tempa * tempa;
    nm = XKE / am ** 1.5;
    em = em - tempe;
    if (em >= 1 || em < -0.001 || am < 0.95) return null; // (decayed)
    if (em < 1e-6) em = 1e-6;
    mm = mm + no * templ;
    let xlm = mm + argpm + nodem;
    nodem = mod(nodem);
    argpm = mod(argpm);
    xlm = mod(xlm);
    mm = mod(xlm - argpm - nodem);
    const sinip = Math.sin(inclm),
      cosip = Math.cos(inclm);
    // long-period periodics
    const axnl = em * Math.cos(argpm);
    let temp = 1 / (am * (1 - em * em));
    const aynl = em * Math.sin(argpm) + temp * aycof;
    const xl = mm + argpm + nodem + temp * xlcof * axnl;
    // Kepler's equation
    const u = mod(xl - nodem);
    let eo1 = u;
    let tem5 = 9999.9;
    let sineo1 = 0,
      coseo1 = 0;
    for (let k = 0; Math.abs(tem5) >= 1e-12 && k < 10; k++) {
      sineo1 = Math.sin(eo1);
      coseo1 = Math.cos(eo1);
      tem5 = 1 - coseo1 * axnl - sineo1 * aynl;
      tem5 = (u - aynl * coseo1 + axnl * sineo1 - eo1) / tem5;
      if (Math.abs(tem5) >= 0.95) tem5 = tem5 > 0 ? 0.95 : -0.95;
      eo1 += tem5;
    }
    sineo1 = Math.sin(eo1);
    coseo1 = Math.cos(eo1);
    // short-period periodics
    const ecose = axnl * coseo1 + aynl * sineo1;
    const esine = axnl * sineo1 - aynl * coseo1;
    const el2 = axnl * axnl + aynl * aynl;
    const pl = am * (1 - el2);
    if (pl < 0) return null;
    const rl = am * (1 - ecose);
    const rdotl = (Math.sqrt(am) * esine) / rl;
    const rvdotl = Math.sqrt(pl) / rl;
    const betal = Math.sqrt(1 - el2);
    temp = esine / (1 + betal);
    const sinu = (am / rl) * (sineo1 - aynl - axnl * temp);
    const cosu = (am / rl) * (coseo1 - axnl + aynl * temp);
    let su = Math.atan2(sinu, cosu);
    const sin2u = (cosu + cosu) * sinu;
    const cos2u = 1 - 2 * sinu * sinu;
    temp = 1 / pl;
    const tp1 = 0.5 * J2 * temp;
    const tp2 = tp1 * temp;
    const mrt = rl * (1 - 1.5 * tp2 * betal * con41) + 0.5 * tp1 * x1mth2 * cos2u;
    su = su - 0.25 * tp2 * x7thm1 * sin2u;
    const xnode = nodem + 1.5 * tp2 * cosip * sin2u;
    const xinc = inclm + 1.5 * tp2 * cosip * sinip * cos2u;
    const mvt = rdotl - (nm * tp1 * x1mth2 * sin2u) / XKE;
    const rvdot = rvdotl + (nm * tp1 * (x1mth2 * cos2u + 1.5 * con41)) / XKE;
    if (mrt < 1) return null; // (below the ground)
    // orientation
    const sinsu = Math.sin(su),
      cossu = Math.cos(su);
    const snod = Math.sin(xnode),
      cnod = Math.cos(xnode);
    const sini = Math.sin(xinc),
      cosi = Math.cos(xinc);
    const xmx = -snod * cosi,
      xmy = cnod * cosi;
    const ux = xmx * sinsu + cnod * cossu,
      uy = xmy * sinsu + snod * cossu,
      uz = sini * sinsu;
    const vx = xmx * cossu - cnod * sinsu,
      vy = xmy * cossu - snod * sinsu,
      vz = sini * cossu;
    return {
      r: [mrt * ux * RE_KM, mrt * uy * RE_KM, mrt * uz * RE_KM] as [number, number, number],
      v: [(mvt * ux + rvdot * vx) * vkms, (mvt * uy + rvdot * vy) * vkms, (mvt * uz + rvdot * vz) * vkms] as [number, number, number],
    };
  };
  return { el, propagate };
}

/** Greenwich mean sidereal time (IAU 1982, on UT1 ≈ UTC) [rad] at a UTC instant [ms]. */
export function gmst(utcMs: number) {
  const du = (utcMs - Date.UTC(2000, 0, 1, 12)) / 86400e3,
    Tu = du / 36525;
  const g = (280.46061837 + 360.98564736629 * du + 0.000387933 * Tu * Tu - Tu ** 3 / 38710000) * (Math.PI / 180);
  return ((g % TAU) + TAU) % TAU;
}

/**
 * TEME → the Earth's axes (x Greenwich, z north; the pseudo Earth-fixed frame, polar motion left out):
 * position [km] and velocity [km/s] relative to the turning ground (the Earth's rotation removed).
 */
export function temeToEcef(r: readonly number[], v: readonly number[], utcMs: number) {
  const g = gmst(utcMs);
  const c = Math.cos(g),
    s = Math.sin(g);
  const W = 7.292115146706979e-5; // rad/s
  const R: [number, number, number] = [c * r[0]! + s * r[1]!, -s * r[0]! + c * r[1]!, r[2]!];
  const V: [number, number, number] = [c * v[0]! + s * v[1]! + W * R[1], -s * v[0]! + c * v[1]! - W * R[0], v[2]!];
  return { r: R, v: V };
}
