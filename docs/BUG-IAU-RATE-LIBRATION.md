# Bug report — `iauRate`: spurious 180/π factor inflates the libration term of the spin rate

**File:** `src/system/orientation.ts`, line 75 (function `iauRate`)
**Status:** confirmed — analytically and numerically
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

Reference: central finite difference of `iauAngles(id, ·).W` (the ground truth by construction — it
differentiates the same W model). Sweep: every 2 days over ~22 years, h = 60 s.

| Body | Mean rate | Max \|numeric\| | **Buggy** max / RMS error | **Corrected** max / RMS error |
|---|---|---|---|---|
| Moon | 13.1764 °/day | 13.196 °/day | **1.2130** / 0.6275 °/day | 6.0×10⁻⁵ / 1.1×10⁻⁵ °/day |
| Mercury | 6.1385 °/day | 6.139 °/day | 0.0474 / 0.0289 °/day | 2.0×10⁻⁵ / 3.5×10⁻⁶ °/day |

Per-term check (Moon, one epoch): correct contribution −0.0146 °/day, buggy −0.8351 °/day → ratio
**57.3**.

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
- **Mercury** — one small term (−0.48°), max error 0.047 °/day ≈ 0.8 % of its rate.

The Galilean moons and Saturn's moons also carry `npm` data, but their `spinVector` takes the
orbit-period branch (they are parented), so this code path never touches them. Bodies without `npm`
(Sun, Venus, Mars, Jupiter…) are unaffected.

**Consumers of the wrong magnitude** (`spinVector` returns pole-direction × rate; the direction is
unaffected):

| Consumer | Use | Impact |
|---|---|---|
| `groundVelocity` (`our-surface.ts`) | `cross(w, r)` — surface ground speed | Moon equator: ~4.6 m/s true; error up to **±0.4 m/s** (9 %) |
| `entry-env.ts` (relativistic frame) | Kerr spin parameter `w/Msec` | Moon's frame-dragging parameter off by up to ~9 % |
| `spinRate` (`controller/util.ts`) | displayed spin magnitude | Moon's displayed rate wrong by up to ~1.2 °/day |
| `our-predict` air drag | `cross(w, d)` in relative airspeed | Mercury only; thin atmosphere → negligible |
| `our-side` surface frames | pole/east directions only | none (magnitude unused) |

## 6. Why the existing tests missed it

The libration test (`tests/ephemeris.test.ts`) checks `bodyAxes` — i.e. **W itself** (position, ±10°),
never its derivative. `iauAngles` is correct, so everything orientation-shaped passes. The bug lives
only in the hand-written derivative, which had no test at all. Lesson: every closed-form derivative
in this codebase deserves a numerical-derivative comparison test.

## 7. Proposed solution

### Fix (one line, `src/system/orientation.ts:75`)

```ts
// before
w += r.npm[i]! * Math.cos(A) * ang[2 * i + 1]! * (D / 36525) * (180 / Math.PI);
// after
w += r.npm[i]! * Math.cos(A) * ang[2 * i + 1]! * (D / 36525);
```

### Regression test (`tests/orientation.test.ts`, new)

```ts
import { test, expect } from "bun:test";
import { iauAngles, iauRate } from "../src/system/orientation";

// The analytic rate must be the derivative of the angle model: compare against a central
// finite difference of W. Sweep many epochs — a single instant can pass by coincidence
// (the error is a sum of oscillating cos terms).
test("iauRate is the numerical derivative of the IAU prime-meridian angle", () => {
  const day = 86400, h = 60;
  for (const id of ["moon", "mercury"]) {
    for (let k = 0; k < 400; k++) {
      const et = 1e9 + k * 86400000 * 2; // ~2 years of sweep, kept near J2000 for float noise
      const num = (iauAngles(id, et + h)!.W - iauAngles(id, et - h)!.W) / (2 * h / day);
      expect(Math.abs(iauRate(id, et)! - num)).toBeLessThan(1e-4); // °/day
    }
  }
});
```

Expected result after the fix: max deviation ~10⁻⁸ °/day near these epochs (bounded by 1e-4 with margin
for finite-difference truncation + float cancellation). The current code fails the sweep by ~4 orders
of magnitude at multiple epochs (max 1.21 °/day for the Moon).

## 8. Secondary observations (no action required)

- `2 * (r.pm[2] ?? 0) * d` — the quadratic term's derivative is correct.
- `iauAngles` is unaffected; no snapshot or orientation change is expected from the fix.
- The `if (!r.npm[i]) continue;` guard correctly skips zero-amplitude terms.
- The Galilean/Saturnian `npm` data is currently dead weight on this path; if librations are ever
  wanted for parented moons, the same (fixed) formula applies as-is.

---

*Verification method: no file was modified during the analysis; all checks were run as throwaway
`bun -e` scripts against `iauAngles`/`IAU_ROTATION`/`IAU_ANGLES`.*