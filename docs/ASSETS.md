# Assets and repository size

The repository keeps the app's older binaries in plain Git and, since 13 October 2026, the ones rebuilt
or added often in Git LFS (below). About 390 MB of binaries are tracked in Git and 130 MB in LFS at the
head of main (`bun scripts/check-repo-size.ts` gives today's figures), and the site
GitHub Pages serves is made of them: Pages' limit is 1 GB for the whole deployment, the root and the
`/test/` preview together.

## Where the packs come from

Each binary under `assets/` is the output of a script, from a source kept outside the repository
(git-ignored, see `.gitignore`):

| Directory | Built by | From |
| --- | --- | --- |
| `assets/earth/ktx2`, `assets/planets/ktx2` | `scripts/build-ktx2.ts` | the colour maps, `basisu` |
| `assets/earth/relief-*.bin` | `scripts/build-earth-relief.py` | NOAA ETOPO 2022 (`assets/etopo/`) |
| `assets/earth-surface/v1` | `bun run build:earth-surface` | ESA WorldCover 2021 + Sentinel-2 COGs ([README](../assets/earth-surface/README.md): Python, basisu 2.50.0) |
| `assets/planets-hd` | `scripts/build-jupiter.ts`, `scripts/build-dem.py` | mission imagery, LOLA / MOLA (`assets/tex/`, `assets/dem/`) |
| `assets/ephemeris` | `scripts/build-ephemeris.ts` | NAIF kernels (`assets/kernels/`, `assets/nasaSolar/`) |
| `assets/sky`, `assets/etoiles` | `scripts/build-sky.ts`, `scripts/build-constellations.ts` | NASA SVS Deep Star Maps, HYG |
| `assets/ranger`, `assets/endurance`, `assets/lander` | `scripts/build-ranger.ts`, `build-endurance.ts`, `build-lander.ts`, `build-cockpit.ts` | the supplied models (git-ignored folders) |
| `assets/iss` | `scripts/build-iss.py` (Blender) | NASA's ISS2.glb |
| `assets/character` | `scripts/build-astronaut.ts` | the licensed astronaut ([README](../assets/character/README.md)) |

`docs/img`, `docs/video` and `docs/perf` hold captures, the gallery's videos and the benchmark's
reports. Each script's header says how to run it again.

## Why the history grows

The regional surface packs are content-addressed: each page's file name carries the hash of its bytes
(`0-0-8f5d4c86.ktx2`), so that no browser cache or tile cache ever serves an old page under a new
manifest. The price: a rebuild that changes any byte — new imagery, a new encoder version, other
flags — writes new names, and the old files stay in Git's history for good. One region is about 16 MB:
each rebuild of both pilot regions adds about 30 MB to every clone. The same holds for any binary
rewritten in place. Rebuild a pack only to change it, with the pinned encoder (the build script
refuses another `basisu` version).

## The guards

- **`bun scripts/check-repo-size.ts [--base <rev>]`** — every binary Git tracks at HEAD (Git's own
  detection: `git ls-files --eol`), summed: a warning past 560 MB, a failure past 600 MB. With a base,
  each binary blob the change adds or rewrites: a failure for one over 8 MB, a warning when they come
  to more than 20 MB together. Locally, before a push: `bun scripts/check-repo-size.ts --base origin/main`.
  The CI runs it with `--base HEAD^1` (a pull request against its base; a push, its last commit
  against the one before — the total catches the rest). Raising a budget is a change to that file, in
  the same commit as the binary that needs it, where a review sees it.
- **The Pages site** (`.github/workflows/pages.yml`, "Assemble the site"): past 800 MB a warning; past
  900 MB with the preview, the preview is left out and the site deploys with main alone; main alone
  past 900 MB fails before anything is deployed.

The root's and the preview's builds are not shared on Pages: each app's URLs are relative to its own
directory — its bundle, workers, Service Worker precache and scope — and Pages serves no links.
Sharing them would mean rewriting the preview's URLs to `../` for files only identical by chance, so
the site stays about twice one build.

## Git LFS

`.gitattributes` puts these in Git LFS (decided 13 October 2026): the regional surface packs
(`assets/earth-surface/v1/**`: content-addressed, a rebuild writes new names), the licensed astronaut
(`assets/character/*.ktx2`, `*.bin`), the docs' captures (`docs/img/**` png, jpg, webp) and the
gallery's videos (`docs/video/*.mp4`). A rebuild of those no longer grows every clone: Git keeps a
pointer, the object goes to GitHub's LFS store.

- **Setting up a clone**: `git lfs install` once per machine (Homebrew: `brew install git-lfs`), then
  `git lfs pull` in a clone made before. Without it the files are their pointers (a few lines of text):
  the app shows no regional surface, no astronaut. kerr-mini has no git-lfs yet — its clone pulled by
  `scripts/remote.ts` gets pointers; the remote runs are not affected (they run on the copy sent from
  here, with the real files).
- **The CI** (`pages.yml`): each checkout lists its LFS objects, restores them from the Actions cache
  keyed by their ids and runs `git lfs pull` — the objects are downloaded only when they change
  (GitHub's LFS bandwidth quota).
- **The guard**: `check-repo-size.ts` counts the LFS objects apart (a warning past 800 MB: GitHub's LFS
  quotas) — they are not in the Git binaries' 600 MB.
- **The history**: the objects committed before the switch stay in Git's history (about 96 MB); taking
  them out means rewriting main's history (`git lfs migrate import --everything`) and a force-push —
  not done.

## Later: a bucket

When the site's 1 GB binds, the content-addressed packs can leave Pages: `manifest.json` stays in Git,
and `scripts/build-pages.ts` fetches each file named there (checking its hash) into `_site/` from a
release or a bucket. The hashes make the files immutable, so any static host or CDN can keep them.
