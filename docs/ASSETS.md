# Assets and repository size

The repository keeps the app's older binaries in plain Git and, since 13 October 2026, the ones rebuilt
or added often in Git LFS (below). About 390 MB of binaries are tracked in Git and 130 MB in LFS at the
head of main (`bun scripts/check-repo-size.ts` gives today's figures), and the site
GitHub Pages serves is made of them: Pages' limit is 1 GB for the whole deployment (the root alone since
the previews left Pages on 2026-11-10, [DEPLOY.md](DEPLOY.md)).

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
| `assets/f35` | `scripts/build-f35.py` (Blender), `scripts/build-f35-maps.py` | the F-35 GLB ([README](../assets/f35/README.md), git-ignored `assets/airplanes/`) |
| `assets/character` | `scripts/build-astronaut.ts` | the licensed astronaut ([README](../assets/character/README.md)) |
| `assets/a320` | `scripts/build-a320.py`, `build-a320-maps.py`, `build-a320-cockpit.py`, `build-a320-sounds.py` (Blender, Python) | FlightGear's A320-family, rev. `fec1ecba`, GNU GPL v2 ([README](../assets/a320/README.md), `LICENSE`) |
| `assets/traffic` (`a320`, `crj900`, `cargo`, `tanker`, `ferry`, `trawler`, `sailboat`, `frigate`) | `scripts/build-airliners.ts`, then `scripts/whiten-airliner-maps.py` (the airliners' maps: their original schemes painted white — the livery's colours laid on by `ship.wgsl` `trafficPaint`, `src/traffic/livery.ts`) and `scripts/build-traffic-gear.ts` (their landing gear: the game's FlightGear A320's legs, GNU GPL v2 — `assets/a320/README.md` —, simplified by meshoptimizer and baked into `a320.bin` and `crj900.bin`, materials 55–58; the CRJ's stubs of its cut gear removed; 24 Nov 2026); `build-ships.py` (Blender) then `build-ships.ts` | the supplied A320 GLB, CRJ-900 OBJ and container ship FBX (git-ignored `assets/porte-avion/`; their licences as supplied, not recorded here); the airliners' gear from `assets/a320/a320.bin`; the ferry, trawler, sailing boat and frigate drawn by `build-ships.ts` |
| `assets/traffic` (`mrtt`, `drogue`, `probe`, `lamp-*`) | `scripts/build-tanker.ts` | the A320's mesh repainted, the pods, hose and probe procedural |
| `assets/traffic` (`gs-*`) | `scripts/build-a320-services.py` | FlightGear's `Models/Services` (GNU GPL v2; the tug after XPGoodWay's) |
| `assets/traffic` (`msl-*`, `gu-*`) | `scripts/build-missiles.ts`, `scripts/build-ground-units.ts` | procedural (no licence to carry) |
| `assets/carriers` | `scripts/build-carriers.py` (Blender) then `build-carriers.ts` | the supplied carrier models (git-ignored `assets/porte-avion/`; licences as supplied, not recorded here) |
| `assets/runways/v1` | `scripts/build-runways.ts` | OurAirports (public domain; `assets/runways/raw/`, git-ignored) |
| `assets/approaches/v1` | `scripts/build-approaches.ts` | FlightGear's `nav.dat` (Robin A. Peel, cycle 2013.10, **GNU GPL v2 or later** — its header kept in `index.json`'s credit; `assets/approaches/raw/`, git-ignored, from `fgdata/Navaids`): the world's ILS tied to our runways — 3 259 of 3 501 localizers (2 750 by name, 509 by geometry: runways renumbered since 2013), 242 left out and listed in `report.json`; ~660 KB of JSON in 454 tiles. Rebuilt by the script; nav.dat stays at 2013 while no newer free worldwide source exists (none found on 15 Nov 2026: OurAirports' and BlueSky's navaids have no localizers). **AP0b (15 Nov 2026): the FAA's CIFP**, cycle 2611 (effective 29 Oct 2026; `assets/approaches/raw/CIFP_261029.zip`, git-ignored, from [the FAA's download page](https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/download/), read by `scripts/cifp.ts`): **public domain** (FAA: « all digital products published by the FAA are in the public domain »), its agreement's two conditions kept — **not for real navigation** (said in the game's credits and here) and **the FAA's error notes relayed**: the cycle's archive carries none (its `IN_CIFP.txt` only lists the procedures included); the FAA's CIFP pages refuse an automated read (HTTP 403, 15 Nov 2026): their notices for this cycle are to be read by hand at the next update; a note published for a cycle goes here and in the game's credits. 9 629 of its 10 171 approaches read (496 circling ones without a runway, 35 back courses, 10 without a placed first fix left out; HF/PI → HM, VI/CI/FC → CF, AF → RF counted in `report.json`), 9 568 tied to our runways (by code, small fields by K + their identifier, 336 on an end renamed or without its side letter at ours — the same course within 20°), 61 left out and listed. The tiles grow to 6.4 MB of JSON in 473 tiles. To update: download the new cycle's zip into `raw/`, rerun the script. **A game's data, never for real navigation** |
| `assets/detail` | `scripts/build-detail-scans.py` | five ambientCG materials (CC0), basisu UASTC |
| `assets/noise` | `scripts/build-blue-noise.ts` | procedural (void-and-cluster, deterministic seeds) |
| `assets/title`, `assets/scenes` | `scripts/build-title-maps.py`, `title-art.ts`, `logo-render.ts`, `scene-thumbs.ts` | the game's own maps and renders |
| `assets/lens/lensdirt.jpg` | — (a copy) | the texture pack's `assets/tex/base/lensdirt-low.jpg` (git-ignored; used since c4443ece, 4 Oct 2026, versioned by 2e80e8a3); **its author and licence not recorded** — the pack's `credits.txt` does not name it: to be traced or replaced |

Most craft and traffic meshes share one format (the `.bin` "TRFC" / the craft's: a 40-byte header, 8 or 10 interleaved floats a
vertex, 32-bit indices — gzipped on the wire by Pages and the server); the F-35, the A320, the ISS and the astronaut have their own. Their compression and levels of detail by meshoptimizer were evaluated on
14 Nov 2026 ([FICHE-J3-6-MESHOPT](progress/j3/FICHE-J3-6-MESHOPT-2026-11-14.md): lossless encoding −5 % over gzip in all, the simplifier
≤ 0.07 % error at half the triangles); not adopted — PLAN-J3 question 4.

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
  detection: `git ls-files --eol`), summed: a warning past 650 MB, a failure past 700 MB (560 / 600 until 15 Nov 2026, raised by Sam's decision, audit QA-03). With a base,
  each binary blob the change adds or rewrites: a failure for one over 8 MB, a warning when they come
  to more than 20 MB together. Locally, before a push: `bun scripts/check-repo-size.ts --base origin/main`.
  The CI runs it with `--base HEAD^1` (a pull request against its base; a push, its last commit
  against the one before — the total catches the rest). Raising a budget is a change to that file, in
  the same commit as the binary that needs it, where a review sees it.
- **The Pages site** (`.github/workflows/pages.yml`, "Assemble the site"): past 800 MB a warning; past
  900 MB with the preview, the preview is left out and the site deploys with main alone; main alone
  past 900 MB fails before anything is deployed.

Each app's URLs are relative to its own directory — its bundle, workers, Service Worker precache and
scope — and Pages serves no links, so the root's and the preview's builds were two copies: past 1 GB
together once main alone came to 500 MB (16 October 2026). The preview's hashed binaries that main has
byte for byte — named by their content: the textures, meshes, maps, none of them precached — are now
left to main's copy, the preview's own code (its directory's top level) pointing at them as `../x`; one
named any other way there, or in a subdirectory (the crew's, the docs' pages), or nowhere, is kept. The
preview comes to some 100 MB beside main (the run's summary says how many were left).

## Git LFS

`.gitattributes` puts these in Git LFS (decided 13 October 2026): the regional surface packs
(`assets/earth-surface/v1/**`: content-addressed, a rebuild writes new names), the licensed astronaut
(`assets/character/*.ktx2`, `*.bin`), the F-35 (`assets/f35/*.ktx2`, `*.bin`: rebuilt as its parts grow), the docs' captures (`docs/img/**` png, jpg, webp) and the
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
  quotas) — they are not in the Git binaries' 700 MB.
- **The history**: the objects committed before the switch stay in Git's history (about 96 MB); taking
  them out means rewriting main's history (`git lfs migrate import --everything`) and a force-push —
  not done.

## Later: a bucket

When the site's 1 GB binds, the content-addressed packs can leave Pages: `manifest.json` stays in Git,
and `scripts/build-pages.ts` fetches each file named there (checking its hash) into `_site/` from a
release or a bucket. The hashes make the files immutable, so any static host or CDN can keep them.

**Where — decided (Sam, 12 November 2026, audit D13): on Sam's server**, not as a GitHub release. (On 10 November the
options were samlepirate.org, a GitHub release, or Sam's other server running Portainer.) Why a release was set aside
(analysis of 12 November): its downloads redirect to a GitHub storage host that sends no CORS header, so the game could not
`fetch()` them from samlepirate.org — the CI would still have to copy them into `_site/`, freeing Git but neither the Pages
site nor the Docker image; Sam's server can serve them to the game itself, same origin or with headers we set. **Not built
yet**: which of Sam's servers and under which URL, how the CI and the lab machines (this Mac, kerr-mini, kerr-pc) upload and
fetch them (the `manifest.json` above, hashes checked), and which families leave Git first, are for the lot that does it.
The rule kept: a file once published is never replaced nor deleted (an older commit, an A/B between commits, still names
it). The trigger is the Git budget, not only Pages': on
10 November the tracked binaries came to 591.6 MB of the 600 MB that `check-repo-size` allowed; on 15 November to 600.0 MB, a
140 KB capture refused at the push. Sam raised the budget to 700 MB (warning at 650) the same day (audit QA-03): a respite of
100 MB, not a plan — Pages still caps the site at 1 GB. Until the plan above is built, a new heavy binary goes to Git LFS.

## J9 shared tree geometry (20 November 2026)

`assets/vegetation/trees-v1.json` identifies the procedural source revision, compressed-file SHA-256, format, bounds and
counts. Its `file` names a content-addressed KTG1 binary (gzip; Git LFS), generated by `bun scripts/build-tree-assets.ts`.
The build does not delete previously generated revisions. Twenty-four shared models (12 × LOD 0 + 12 × LOD 1), unquantized
interleaved positions, normals and material/UV/shade attributes; no duplicated per-tree geometry. Meshoptimizer 1.3.0 (MIT)
is a **build-only dev dependency**: index/vertex reordering preserves every triangle and attribute, with no decoder or WASM
in the runtime codec. Because meshoptimizer's generic triangle simplifier cannot collapse disconnected foliage cards (`barkLodStudy`),
LOD 1 is built directly in `treeModel(kind, aspect, seed, 1)` from the same random stream, trunk and clump anchors (`lodStudy`:
60.1 %–64.2 % triangle reduction across all 12 species/aspect pairs while preserving optical coverage within < 3.8 %).
Runtime gzip support already exists in `src/util/inflate.ts`.
