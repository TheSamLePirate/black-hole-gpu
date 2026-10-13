# E2E campaign of 13 October 2026: what was done, what is left

Branch `codex/earth-photorealistic`. Starting point: the two full runs of 12–13 Oct
(`remote-results/dash/20261013-025531-here/`, 26/86 files failing here; mini
`remote-results/20261013-013414-dash-013414/`, 30/86 failing there).

## Done (commits 38d665b, 20e8e0a, c3fdfc8, then the last commit "E2E campaign: adaptive top bar…")

- **Placements and the camera rig** (25a3578): `placeAt` (glideTo, land, near, scenes) placed the ship
  through the *softened* chase view, so a placed ship was off by the camera's lag (the gear "collapsed",
  the assist hand-overs failed). Fix: `rigidMount()` in `newFlight` / `settleMount`.
- **Top bar**: the ship's least-used controls go into ⋯. Then **measured** compaction (`tb-compact`: short
  names) and wrapping (`tb-wrap`) whenever the bar is still too wide (`TopBar.fit` / `layout`). This replaces the
  fixed width breakpoints. The transport bar wraps itself once the bar is wrapped. Checked at 390×844, 844×390,
  960×540 (game:interstellar), 1280×720, 1440×900 FR and 1920×1080: nothing off-screen.
- **The tripod and the sky's events**: the spectator's clock now follows the scene even while it follows the
  ship (`advanceSpectator`); `groundBelow` / `standOn` ignore crafts (the landed Ranger was the "nearest world").
- **Harness** (`tests/e2e/lib/app.ts`): keys no longer send `nativeVirtualKeyCode` (on macOS it is a Mac key
  code: an Escape in TARS's field opened `chrome://settings/help` and froze the page). `click()` opens ⋯ for an
  action that is in it, and aims at a target that has stopped moving (the bar is centred and slides).
- Tests brought up to date with intended changes: ⇧F4 is the assisted mode, F1 goes back from the free camera,
  `piloting` stays true on foot, the camera panel belongs to the free camera, tool runs are wrapped in
  `Promise.resolve`, procedural trees (scenery-hitboxes), a `step` after `character.start` (grass-aaa),
  `prof.every = 1` and time-bounded measurements, shots at their own size (forest-aaa).
- **Golden** recorded again; each drift is explained in c3fdfc8.

Status before the last commit: **here**, every file passes except one test (below). **Mini**: see below. The
last recheck (`20261013-083725-recheck-mini`) ran **before** the last fixes (modes tab, forest-aaa size,
frame time bounds).

## Second round (13 Oct, afternoon): the review, its fixes, the campaign again

The branch was reviewed whole (docs/REVIEW-BRANCH-2026-10-13.md, eight areas) and every finding fixed except those
the review marks "non fait" (on branch `review-fixes`, merged here). Then:

- **Full campaigns on the pre-fix tree** (aa54318): here 81/86 files (the 5 failures pass alone: load), the mini 81/86.
- **Targeted runs on the fixed tree**, here and on the mini, each failure traced to its cause:
  - regressions the fixes brought, fixed: the walk left for the free camera unfollowed it (the tripod's ground gone,
    sky-events); the hull rig's lag held when paused (a still view never converged, rain); the scenery's kernel gate
    held trees back for minutes on a cold shader cache (fallback to the general kernel again); the ship's own ground
    dropped while spectating (spectator); the streaming lead measured 0 with a held clock (ground-details);
  - tests made sound: character-aaa (the Moon's DEM arriving mid-test, the hull's box vs mesh, the hull behind him by
    geometry — the dark belly made the pixel A/B blind), audio-space (a panner with nothing playing runs no
    automation: the engine reports where it places the beeps), grass-aaa (the scene round the place waited for; cost
    on/off/on/off), gpu-startup (four variants kept), the walking grid's unit test (built until published).
- Item 4 (Bourget GPU): trace-ab, 1.44 Mpx at block 4: 11 Oct → now +8 % (19.5 → 21.1 ms), the finer EOX imagery
  drawn at z 9–13 (the 11 Oct build had none there); the review's gates: −2 % (noise level).
- Item 5 (stall when the scenery is ready, Cape Canaveral): not reproduced on the pre-fix tree (worst frame 161 ms);
  now 170 ms, ready at 4.8 s.
- Items 2, 3, 6, 7: done (character-aaa redesigned from below, grass budget scaled by the frame's own cost, the top
  bar's actions held in place, the lane worktrees removed).

- **Final campaign on the fixed tree** (42c5cc0 and after), split between the Macs by duration: the mini's 34 files
  all pass; here 50/52 — earth-surface's two tests then made sound (168799c: a guard on the surface's GPU cost
  instead of a budget read in noise; a retry's pending waited past), 4/4 twice; music fails on this Mac on every tree
  this afternoon, the pre-fix one included, and passes on the mini with the final tree: this Mac's audio, not the code.
- Slow-machine fixes found on the mini: a still view restarted at each imagery arrival never converged there
  (f3e5b8b), grass blades read back late (f3e5b8b), earth-surface's eight measures and rain's 32 samples given the
  mini's time (c7bdf31, 42c5cc0).

## Left to do

1. music.e2e here: fails on every tree this afternoon (ticks 2 in 5 s, the bus at −52 dB after the music is
   switched off), passes on the mini — look at this Mac's audio output (device, sample rate) before the code.
2. The Moon's DEM arriving after a landing: the landed craft is not put on it (730 m above at 0°, 0°), the walker is
   (docs/REVIEW-BRANCH-2026-10-13.md, "Nouveaux constats").
3. The first CI run of the new guards (pages.yml: fetch-depth 2, the size guard, check-forest on SwiftShader) and
   tests/earth-surface.test.ts, which times out at bun's 5 s default under load.
4. LFS or a bucket for the binary packs: the user's decision (docs/ASSETS.md).
5. pi-subagents: background runs fail (`@earendil-works/chord` missing from the pi 1.2.0 install), and a foreground
   child times out after 30 min by default. Without that fix, use `options.timeoutMs`.
