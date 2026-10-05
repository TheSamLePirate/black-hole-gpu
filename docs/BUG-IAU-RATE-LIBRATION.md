# Bug report — `iauRate`: spurious 180/π factor inflates the libration term of the spin rate

**File:** `src/system/orientation.ts`, line 75 (function `iauRate`)
**Status:** confirmed and fixed on `test-kimi` — independently reverified on 2026-10-05
**Severity:** medium (wrong physics for the Moon's spin rate, up to ~9 % instantaneous error; no crash, silently wrong)
**Introduced:** commit `a513d35` ("feat(solar): JPL's DE440 ephemerides, the IAU rotations, the time scales") — present since the function's birth

---

## 1. Summary

`iauRate(id, et)` returns a body's prime-meridian rotation rate in **°/day**. Its periodic (libration)
part is inflated by exactly **57.2958× = 180/π**. The factor is a redundant rad→deg conversion applied
to a chain-rule term that is already in rad/day. The bug affects only the *rate*; the angle function
`iauAngles` (and therefore the rendered orientation, `iauAxes`) is correct — which is why the existing
libration test (`tests/ephemeris.test.ts:106`) never caught it.

## 2. Background — the model and the code

The IAU rotation model (as in SPICE `pck00010`) gives a body's prime meridian angle:

```
W(d) = W0 + W1·d + W2·d² + Σᵢ npm[i] · sin(Aᵢ)          [degrees, d in days]
Aᵢ   = (θ₀ᵢ + θ̇ᵢ·T)·D                                    [radians, T = d/36525 Julian centuries]
```

`IAU_ROTATION` (`src/system/iau-data.ts`) stores `pm` = [W0, W1, W2] in degrees and `npm` = the libration
amplitudes **in degrees** (e.g. the Moon: `npm[0] = 3.561`, matching the IAU report / `pck00010`).
`IAU_ANGLES[sys]` stores the argument angles as `[θ₀, θ̇, …]` pairs with **θ̇ in °/century**.
`D = π/180` converts degrees→radians throughout.

The rate is the derivative w.r.t. `d`:

```
dW/dd = W1 + 2·W2·d + Σᵢ npm[i] · cos(Aᵢ) · dAᵢ/dd        [°/day]

dAᵢ/dd = θ̇ᵢ · D / 36525                                   [rad/day]
```

## 3. Root cause

Current code:

```ts
w += r.npm[i]! * Math.cos(A) * ang[2 * i + 1]! * (D / 36525) * (180 / Math.PI);
```

The chain-rule factor `θ̇ᵢ · D/36525` is **already** the derivative of the sine's argument in rad/day:

- `Aᵢ` is in radians and `cos(Aᵢ)` consumes radians — correct as written;
- `d(sin A)/dd = cos(A) · dA/dd` is dimensionless in `A`, so the product keeps the degrees unit of
  `npm[i]` — the result is already °/day.

The trailing `(180 / Math.PI)` is a rad→deg conversion of a quantity that was never in "radians per
unit": it exactly cancels `D`, leaving `1/36525` where `(π/180)/36525` belongs.

**Per-term inflation: exactly 57.2958× (= 180/π).** Likely origin: a copy-paste or misreading of the
angle-rate units (°/century → rad/day conversion applied twice, once in the wrong direction).

## 4. Numerical evidence

Reference: central finite difference of `iauAngles(id, ·).W` (a consistency reference for the same
W model, not an independent observational ephemeris). Reverified sweep: J2000 − 4018 days through
J2000 + 4018 days, every 2 days (4019 epochs over ~22 years), h = 60 s.

| Body | Mean rate | Max \|numeric\| | **Buggy** max / RMS error | **Corrected** max / RMS error |
|---|---|---|---|---|
| Moon | 13.1764 °/day | 13.1966 °/day | **1.212812** / 0.633925 °/day | 2.57×10⁻⁸ / 5.74×10⁻⁹ °/day |
| Mercury | 6.1385 °/day | 6.13905 °/day | 0.047404 / 0.028891 °/day | 8.60×10⁻⁹ / 1.78×10⁻⁹ °/day |

For every nonzero periodic contribution, the buggy/corrected ratio is algebraically
**180/π = 57.2957795…**.

Two traps worth recording for whoever re-verifies this:

1. **A single-instant check can pass by coincidence.** The error is a sum of oscillating `cos(Aᵢ)`
   terms; at some epochs the buggy code is within 2 % of the numeric derivative (observed ratio 0.981).
   Only a multi-epoch sweep exposes the 1.2 °/day excursions.
2. **The finite-difference reference itself degrades at large epochs.** `W ≈ W1·d` grows to ~10⁸
   degrees over centuries, so differencing two ~10⁸-magnitude doubles to get a ~0.018° increment loses
   precision (observed residual ~6×10⁻⁵ °/day at |et| ~ 10¹² s, vs ~10⁻⁸ °/day near J2000). The residual
   of the corrected formula is floating-point noise, not model error. A regression test should either
   bound epochs near J2000 or scale its tolerance with |et|.

## 5. Blast radius

**Reach:** `iauRate` is called from exactly one place — `spinVector` (`src/system/solar.ts:934`), in
the branch taken by bodies with no parent or parent `"sun"`, plus the Moon (special-cased out of the
orbit-period branch). Among bodies with `npm` terms, only:

- **Moon** — the dominant case (13 libration terms, amplitudes up to 3.561°);
- **Mercury** — five terms in `pck00010`: amplitudes +0.00993822°, −0.00104581°,
  −0.00010280°, −0.00002364°, −0.00000532°; max rate error 0.0474 °/day ≈ 0.77 %.

Other satellites (including Phobos, Deimos and the Galilean/Saturnian moons) also carry `npm`
data. Their direct `iauRate` result was wrong, but their time-dependent `spinVector` takes the
orbit-period branch, so its magnitude is unaffected. Bodies without nonzero `npm`
(Sun, Venus, Mars, Jupiter…) are unaffected.

**Consumers of the wrong magnitude** (`spinVector` returns pole-direction × rate; the direction is
unaffected):

| Consumer | Use | Impact |
|---|---|---|
| `groundVelocity` (`our-surface.ts`) | `cross(w, r)` — surface ground speed | Moon equator: ~4.6 m/s true; error up to **±0.4 m/s** (9 %) |
| `entry-env.ts` (`ours` branch) | `w/Msec` converts scene angular speed to rad/s for `ground` and `carry` | Surface velocity/transport affected; no Kerr or frame-dragging parameter is changed |
| `spinRate` (`controller/util.ts`) | `spinVector(body)` without a time | Unaffected: this uses the memoized mean rotation, not `iauRate` |
| `our-predict` air drag | `cross(w, d)` only for bodies with `atmosphere` | Unaffected: neither Mercury nor the Moon has an atmosphere in `SOLAR_BODIES` |
| `our-side` surface frames | pole/east directions only | none (magnitude unused) |

## 6. Why the existing tests missed it

The libration test (`tests/ephemeris.test.ts`) checks `bodyAxes` — i.e. **W itself** (position, ±10°),
never its derivative. `iauAngles` is correct, so everything orientation-shaped passes. The bug lives
only in the hand-written derivative, which had no test at all. Lesson: every closed-form derivative
in this codebase deserves a numerical-derivative comparison test.

## 7. Proposed solution

### Applied fix (`src/system/orientation.ts`)

```ts
// before
w += r.npm[i]! * Math.cos(A) * ang[2 * i + 1]! * (D / 36525) * (180 / Math.PI);
// after
w += r.npm[i]! * Math.cos(A) * ang[2 * i + 1]! * (D / 36525);
```

### Regression coverage (`tests/orientation.test.ts`, added)

The implemented tests cover:

- Moon and Mercury: the numerical derivative of W at 4019 epochs each over ±11 years from
  J2000, including negative epochs and J2000; central difference h = 60 s, tolerance 10⁻⁶ °/day.
- Every other generated IAU model over ±10 years, including quadratic W terms. A fourth-order
  stencil is used because the second-order 60 s stencil truncates Phobos' fast terms by about
  4.8×10⁻⁴ °/day; tolerance 10⁻⁵ °/day accommodates floating-point cancellation.
- Unknown body IDs remain null, and Venus retains its negative (retrograde) rate.
- `spinVector(body, t)` for the Moon and Mercury around the simulation epoch (2067), compared
  with the numerical W derivative converted from °/day to radians per scene time unit.

The proposed original test used `86400000 * 2` **seconds** per step, which is 2000 days,
not two days; 400 samples spanned approximately 2185 years, not two. The implemented sweep uses
`days * 86400` and bounds epochs around J2000 to avoid needlessly amplifying subtraction noise.

Before correction, the new suite produced **4 failures and 1 pass**; after correction and using
the appropriate numerical stencil for fast satellites, all five tests pass. This checks the
closed-form derivative's consistency with the selected IAU model; it does not upgrade that model
or account for the pole's separate RA/declination derivatives in the `spinVector` approximation.

## 8. Secondary observations (no action required)

- `2 * (r.pm[2] ?? 0) * d` — the quadratic term's derivative is correct.
- `iauAngles` is unaffected; no snapshot or orientation change is expected from the fix.
- The `if (!r.npm[i]) continue;` guard correctly skips zero-amplitude terms.
- The Galilean/Saturnian `npm` data is currently dead weight on this path; if librations are ever
  wanted for parented moons, the same (fixed) formula applies as-is.

---

Independent verification and correction performed on 2026-10-05. The numerical error table
above was reproduced before/after the change using Bun scripts; regression tests were added.

Primary references: [NAIF PCK orientation equations and time units](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/pck.html),
[NAIF pck00010 coefficients, including Mercury's five periodic terms](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00010.tpc).
Validation finale : `bun test` — **374 pass, 146 skip, 0 fail** ; suites ciblées orientation,
éphémérides, surface et rentrée — **20 pass**. `bun run check` et `bun run build` passent
(TypeScript, Biome et 9/9 shaders Metal ; avertissements Biome préexistants).
