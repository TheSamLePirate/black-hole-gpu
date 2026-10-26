# The flicker under the horizon — 26/10/2026

The complaint: in flight (the F-35, the others too), once every shader is compiled, the zone near the horizon flickers.

## How it was measured

`scripts/jitter-lab.ts` (see [JITTER-VOL](JITTER-VOL.md)) now also measures the **flicker** of each stretch: a brightness
that comes and goes, not a motion (`scripts/lib/jitter-video.ts`).

- **The cells** (32 px at 960): each cell's mean against its neighbouring frames, `|m_k − (m_{k−1} + m_{k+1}) / 2|`, its rms,
  its frequency, a map.
- **The rows** (`rowFlicker`, `rowBand`): the same measure on each row's mean over the middle 70 % of the width. A band whose
  edge or brightness jumps coherently along the whole horizon shows there, where a cell's mean averages it away. The lag-1
  autocorrelation of the second difference gives the rhythm: −2/3 for a fresh random change each frame, near −1 for every
  other frame, positive for a slow one.
- **`flicker.mp4`**: the second difference ×8, where what blinks shows white.
- **The raster's visibility down a column** (`renderer.rasterColumn`): where each ring begins and ends, in output px. The
  report lists these seams beside the band.
- **`--clean`**: only the 3D image is filmed. The HUD's DOM lines are hidden, since a line moving one pixel would blink a whole
  row as much as the image does.
- **`--levers 'name::js|…'`**: one stretch per lever, in the same flight. Every shader is compiled before each stretch.

And in the page, **`renderer.traceColumn`**: a 32 px strip captured over N frames at three stages, `accum` (what the kernels
wrote), `resolve` (the reconstruction) and `temporal`. It shows which pass makes the flicker.

## What it was

The reference case: F-35, cockpit, 300 m, 230 m/s, Beauce, daylight, real tiles, everything compiled.

| | the band under the horizon | its blink (peak, grey/255) | rhythm |
|---|---|---|---|
| kerr-mini (1920×1080, ~33 fps), before | rows 568–592, 30–50 px under the HUD's horizon line | **3.1 to 5.0** | ac1 −0.66: random, a fresh change each frame |
| this Mac (1440×900), before | rows 474–495 | **2.4 to 10** (at 30–50 fps) | −0.66 |
| the flight held (frozen) | — | 0.1 | — |

**Signature.** The band sits on the ground right under the visible horizon, 20 to 40 km away, the raster's far rings 1 and 2.
Every row's mean over the whole width jumps at random each frame. The band is **exactly one tracer block tall**: 16 render px
(21 output px) at the default block of 16, 10 px at block 8, none at block 4 or 1. It follows the end of the raster's
coverage when the rings are cut shorter (`rasterRingLast` 4, 5).

**Which pass makes it** (`traceColumn`, on the rows within a block under the edge, every pixel `RASTER_MARK`):

| row mean's blink | `accum` (shadeLite) | `resolve` | `temporal` |
|---|---|---|---|
| frames where those pixels count as stale | 3–6 % | **14–35 %** | 22–33 % |

**Cause 1, the main one: the reconstruction rebuilt the raster's ground from the sky.**

1. `shadeLite` writes every raster pixel each frame. Some frames, those within a block of the skyline count as stale for the
   tracer's stamp.
2. `resolve` then took its stale branch. At block 16 that branch is a bilinear blend of the pixel's block's four corners, with
   the raster's corners left out.
3. Near the skyline, the only corners left are the **sky's**: traced, some not hit for 50 to 240 frames.
4. Those corners sit on the block grid shifted by the frame's offset, `P.ext2` / `R.u.yz`, which is **the same for the whole
   image** and changes every frame.

So the ground under the horizon took more or less of the sky depending on the frame, all along the horizon at once: a band
one block tall, coherent along the rows, random in time, and the larger the block, the stronger.

**Cause 2, secondary: the far ground aliases vertically and its history is short.** At a grazing angle, a pixel row covers
hundreds of metres of fields, so any sub-pixel move of the view (the pitch the autopilot holds) changes what a whole row shows.
That is 3 to 10 % of a 32 px strip's mean per frame, already in shadeLite's output. The temporal pass only averaged it over
~3 frames there: the raster's ground keeps α ≥ `RASTER_LITE_ALPHA` (0.3), which was meant to stop the near ground smearing in
motion. Near the horizon the image barely moves.

Ruled out on the way, each by a lever:

- the far rings' shading cycle (`TUNE_RING_RATE` 1: no better);
- the shading rate (every pixel: no better);
- the albedo detail (no better);
- the cloud pass and its history (no better);
- the HUD (`--clean`: the band stays);
- an uncovered strip of traced ground (`rasterColumn`: the rings reach the horizon, ground at 48 km is within a pixel of it);
- the far rings themselves (off: no flicker, but the far ground loses its imagery, an orange-green blur).

## The fix (post.wgsl)

1. **`resolve`**: a pixel of the raster's ground (`RASTER_MARK`, written by the raster within the last two frames) is never
   rebuilt from the tracer's samples. It keeps its own colour, the raster's last. A pixel the raster has left (the view
   pitched up) becomes the sky's to rebuild again after two frames, so no ghost of ground is left in the sky.
2. **`temporal`**: on the raster's ground, the history's least α follows the point's motion on the image. It is 1/16 under
   0.3 px a frame (the far ground: its aliasing averaged over ~16 frames) and stays at the third over 1.5 px a frame (the near
   ground: no smear).

Both can be switched off for comparisons: `renderer.horizonKeep`, `renderer.horizonFarAlpha` (`R.f.w` bits 1 and 2).

**A/B in one flight** (rows' blink at the band, grey):

| | this Mac | kerr-mini |
|---|---|---|
| before (both off) | 3.37 · 4.80 | **3.13 · 5.05** |
| `resolve` alone | 0.06–0.17 | — |
| `temporal` alone | **6.26** (no help alone) | — |
| after (both) | **0.04–0.08** · 0.13 | **0.03–0.11** · 0.03–0.13 |

The far ground's pixel flicker (cells under the horizon, mean of |second difference|) goes from 0.66–0.71 to 0.34–0.39. With
`resolve` alone it is 0.58: the longer history is the rest. Frame rate unchanged (32–35 fps on the mini).

## The videos (kerr-mini, full screen, `--clean`)

In `remote-results/flicker/videos/`, made from the job `20261026-224111-flicker-ab`:

| file | what |
|---|---|
| `horizon-AVANT-full.mp4` | before: the whole image, 8 s |
| `horizon-APRES-full.mp4` | after: the same flight, the next stretch |
| `horizon-zoom_haut-AVANT_bas-APRES.mp4` | the horizon zoomed ×2 (960 × 120 px of the middle): before at the top, after below |
| `clignotement-x8_gauche-AVANT_droite-APRES.mp4` | the second difference ×8 (what blinks shows white): before on the left (a white strip along the horizon), after on the right |

The raw stretches, with their reports, are in `remote-results/20261026-224111-flicker-ab/artifacts/remote-results/flicker/mini-ab/`.

```bash
S='const r = __bh.renderer;'
bun scripts/jitter-lab.ts --tiles --clean --seconds 8 --segments noShakes \
  --levers "before::$S r.horizonKeep = false; r.horizonFarAlpha = false|after::$S r.horizonKeep = true; r.horizonFarAlpha = true"
```

## Left to do

- **Why those pixels count as stale on some frames.** Their stamp falls behind `validFrom`, intermittently. The fix makes it
  harmless, but the cause (shadeLite's stamp against the frame's, or a frame without shadeLite) is unknown.
- The far ground's own vertical aliasing (the texture at a grazing angle): a footprint filtered along the vertical (anisotropic
  in the rows), more than the history.
- The sky's reconstruction just over the skyline: one ray a block at the image's offset. Per-block offsets (Halton or STBN, the
  audit's R3) would break the coherence everywhere.
