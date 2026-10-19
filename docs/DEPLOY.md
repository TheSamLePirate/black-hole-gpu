# Deployment — GitHub Pages and the dedicated server

The site also runs on the dedicated server (https://samlepirate.org), beside GitHub Pages: the same
site as main builds it (main at the root; the preview, `test-kimi`, is on GitHub Pages only, under
`/test/`), served by nginx in a container.
Nothing calls into the server — it fetches its updates itself.

```
push main / test-kimi ─► pages.yml: snapshot (both heads) ─► main ∥ preview (each verified, built) ─► site (assembled)
                         ─► deploy (GitHub Pages)
push main             ─► pages.yml "server": that artifact, /test/ removed, in deploy/Dockerfile (nginx)
                           → ghcr.io/thesamlepirate/black-hole-gpu:<main sha⁷>-<run>.<attempt>
                         ─► a commit on the `deploy` branch: compose.yml naming that tag
Portainer (stack "kerr", from the `deploy` branch, polling) ─► new commit ─► pulls the tag ─► redeploys
```

## The Pages site (`.github/workflows/pages.yml`)

- **`Ineptie-Version` at `/ineptie/`**: published beside main and `/test/`, with
  `KERR_SUBPATH=ineptie` to isolate its storage. All three publishing branches carry the same Pages
  workflow and share its deployment concurrency group. The `ineptie` job verifies and builds the exact
  snapshotted revision; a failure stops deployment, preserving the published site. Shared hashed binaries
  use main's copy as for `/test/`; the complete site must stay within the 900 MB budget. Both previews
  are omitted from the dedicated server image. The `github-pages` environment permits all three branches.

- **Both revisions side by side**: a `snapshot` job reads the heads of main and of the preview branch, then the
  jobs `main` and `preview` verify and build each exact revision in parallel — types, `bunx biome ci .`,
  `scripts/check-repo-size.ts --base HEAD^1`, the shaders (`check-wgsl.ts`), the forests' tracer
  (`check-forest.ts`), the unit tests, `bun run build:pages` — and `site` assembles their builds (main at the
  root, the preview under `/test/`). main gates the deployment; a preview that fails is reported (a warning on
  the run) and left out, the site deploying with main alone.
- **main's build cached by its commit**: once verified, main's build is saved in the Actions cache as
  `site-main-<sha>`; a run whose main is unchanged — a preview push — restores it and verifies the preview alone.
- **The unit tests in parallel**: `bun test --parallel --timeout 30000` (a worker a core: four on the runner),
  a test's budget 30 s rather than bun's 5 — the long flights' tests of 4–5 s alone took 6–10 s with the cores
  shared. Their JUnit report is kept as an artifact (`junit`, `junit-preview`). Measured on the runner
  (2026-10-17): the tests 343 s for the preview and 468 s for main (554 s one file at a time); a run with both
  revisions 9.5 min (23 one after the other).
- **Under Pages' 1 GB**: the preview's hashed binaries that main has byte for byte (textures, meshes, maps; none
  precached) are left to main's copy, the preview's top-level code pointing at them as `../x`; one named any
  other way, in a subdirectory (`crew/`, `docs/`) or nowhere, is kept. Past 800 MB a warning; past 900 MB the
  preview is left out, and main alone past 900 MB fails before deploying ([ASSETS.md](ASSETS.md)).
- **The binaries' guard** (`scripts/check-repo-size.ts`): each binary blob a commit adds or rewrites fails past
  8 MB, a warning when they come to 20 MB together; the binaries Git tracks warn past 560 MB and fail past
  600 MB in all; the LFS objects warn past 800 MB. Its budgets are raised in that file, in the change that
  needs it.
- **A pull request** runs the same checks (`verify`) and the build, and deploys nothing.

## The dedicated server

- **`deploy/`** — the Dockerfile, the nginx configuration (hashed files cached a year, the page, the
  Service Worker and the JSON files `no-cache`; the KTX2 and manifest types), the compose template
  and `render-compose.sh`, which fills in its two images (the site's, the room server's).
- **The `deploy` branch** — written by the CI only, one commit per deployment. It moves only once the
  image is pushed, and each image has its own tag: Portainer never redeploys before the image exists,
  and a new tag is always pulled.
- **The server** — Portainer (2.9) stack `kerr`, from this repository's `refs/heads/deploy`,
  `compose.yml`, automatic updates by polling. The container publishes port 3000, which the Nginx Proxy
  Manager serves as samlepirate.org (TLS there).
- **The image** — the GHCR package must be public (the server pulls it without credentials).

## The room server (stream.samlepirate.org)

The network's rooms ([PLAN-RESEAU.md](PLAN-RESEAU.md)): `server/main.ts` in Bun, the same stack, its own
service.

```
push main / reseau touching server/, src/net/ ─► rooms.yml: the network's tests, deploy/Dockerfile.rooms
                           → ghcr.io/thesamlepirate/black-hole-gpu:rooms-<sha⁷>-<run>.<attempt> (the site's public package)
                         ─► a commit on `deploy`: compose.yml naming it beside the site's image
Portainer ─► recreates the `rooms` service alone (port 3001, its rooms in the `rooms-data` volume)
```

- **Both workflows write `deploy`**, one at a time (concurrency group `deploy-branch`); each keeps the
  other's image as it found it. Until the room server has an image, its block is left out.
- **Nginx Proxy Manager**: the host `stream.samlepirate.org` → `host:3001`, *Websockets Support* on.
- **Checked by** `https://stream.samlepirate.org/health` (`{ ok, v, build, rooms, live, peers }`).
- **Only when the server's code changed** — `server/**`, `src/net/**`, `deploy/Dockerfile.rooms`,
  `deploy/compose.yml`, `deploy/render-compose.sh` or the workflow itself (on main or `reseau`): the players are
  not cut off by every push. Its tests (`net-core`, `net-rooms`) run first; the image holds `server/` and
  `src/net/` alone (Bun, no dependency, the rooms in SQLite on `/data`).
- A page is told to reload when its protocol is older than the server's previous one; the server can lag
  the page by Portainer's poll (2 min), which the protocol's N/N−1 covers.

### The TURN relay (coturn) — when the voices and the direct links must cross a carrier's NAT

Most players reach each other directly (STUN); a phone on 4G/5G often cannot (CGNAT) and then needs a relay.
To turn it on:

1. Choose a secret (`openssl rand -hex 32`) and set it as `TURN_SECRET` in the `kerr` stack's environment in
   Portainer (never in the repository).
2. Open on the server (ufw/nftables, and the OVH Network Firewall if it is on): `3478/udp`, `3478/tcp`,
   `49160-49200/udp`.
3. The `coturn` service in `deploy/compose.yml` (on since 2026-10-14; it runs on the host's network: the relay
   needs the real ports; in the room server's block, so absent until that has an image): the room server then
   hands each page TURN credentials of 6 hours (an expiry and the device as the username, its HMAC-SHA1 under
   the secret as the password — coturn's `use-auth-secret`) for `turn:stream.samlepirate.org:3478` over UDP and
   TCP (`TURN_URLS` overrides them); relaying to private networks refused, 12 allocations a user, 60 in all,
   200 kB/s each at most. `TURN_SECRET` unset: STUN alone.

### The real traffic's relay (aircraft and ships) — `server/traffic.ts`

The room server also answers `/traffic/air`, `/traffic/sea`, `/traffic/plane` (one aircraft by its ICAO address)
and `/traffic/health` (CORS open) for the pages — a page asking more than twice a second gets a 429: the
aircraft from adsb.lol (no key), OpenSky when adsb.lol fails, the ships from aisstream.io on one connection (its
subscription following the zones asked for in the last two minutes). `deploy/compose.yml` passes these from the
`kerr` stack's environment in Portainer (never in the repository):

- `AISSTREAM_API_KEY` — aisstream.io's key (unset: no ships);
- `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET` — OpenSky's OAuth2 client credentials (unset: anonymous, fewer
  credits).

Checked by `https://stream.samlepirate.org/traffic/health` (`ais`, `opensky` true once set; `aisOpen` while a page
looks at the sea). In development the dev server serves the same from `.env`.

## Rolling back

Revert the last commit(s) on `deploy` (or push a commit naming an older tag): Portainer redeploys that
image at its next poll. A push to main moves the branch forward again.

## Deploying by hand

Rerun the workflow (Actions → Deploy to GitHub Pages → Run workflow): a new run builds a new tag (main's
build restored from the cache when its commit was built already). The room server: Actions → Room server → Run
workflow.
