# Deployment — GitHub Pages and the dedicated server

The site also runs on the dedicated server (https://samlepirate.org), beside GitHub Pages: the same
site as main builds it, served by nginx in a container. (The previews `/test/` and `/ineptie/` were retired from
Pages on 2026-11-10: below.)
Nothing calls into the server — it fetches its updates itself.

```
push main             ─► pages.yml: snapshot (both heads) ─► main ∥ preview (each verified, built) ─► site (assembled)
                         ─► deploy (GitHub Pages)
push main             ─► pages.yml "server": that artifact, /test/ removed, in deploy/Dockerfile (nginx)
                           → ghcr.io/thesamlepirate/black-hole-gpu:<main sha⁷>-<run>.<attempt>
                         ─► a commit on the `deploy` branch: compose.yml naming that tag
Portainer (stack "kerr", from the `deploy` branch, polling) ─► new commit ─► pulls the tag ─► redeploys
```

## The Pages site (`.github/workflows/pages.yml`)

- **No preview on this origin any more** (2026-11-10, audit QA-04 — Sam: a preview must not be able to read the
  players' keys). `/test/` (`test-kimi`) and `/ineptie/` (`Ineptie-Version`) were served on the production's origin,
  `thesamlepirate.github.io` — the origin of every Pages site of the account —, where their code could read the
  root's `localStorage`, the OpenRouter and Deepgram keys with it (`KERR_SUBPATH` separated the keys' names, not
  their access). Now: `PREVIEW_BRANCH` and `INEPTIE_BRANCH` are empty (the jobs `preview` and `ineptie` inert), the
  workflow runs on pushes to main only, and the `github-pages` environment deploys from main alone (its branch policy:
  `main`; `test-kimi` and `Ineptie-Version` removed — their own old copies of the workflow can no longer deploy).
  Each retired directory keeps two files, `pwa/retired-preview/` copied by `site`: a `sw.js` that a browser which
  once installed the preview's worker fetches at its next update check — it takes over, deletes that scope's own shell
  caches (never the site's tiles or zones), unregisters and sends its pages to the root — and an `index.html` that
  does the same and removes the keys a player typed into the preview (`<dir>/kerr.*.key`). Checked in headless
  Chrome on 2026-11-10 (an old worker replaced: unregistered, its cache gone, main's caches and keys kept). Limit: a
  browser still running the old worker serves the preview's cached page once more before the update lands.
  With the previews' jobs skipped, `deploy` and `server` test `needs.site.result` under `!cancelled()`: GitHub's implicit
  `success()` reads the whole chain, and the two runs of 10 November that retired them deployed nothing (fixed the same day).
  **A preview comes back only on another origin** (a subdomain of samlepirate.org, another account), never by
  naming its branch in `pages.yml` again. The machinery below (side-by-side verification, binaries left to main's
  copy) stays for that day.

- **Both revisions side by side**: a `snapshot` job reads the heads of main and of the preview branch, then the
  jobs `main` and `preview` verify and build each exact revision in parallel — types, `bunx biome ci .`,
  `scripts/check-repo-size.ts --base HEAD^1`, the shaders (`check-wgsl.ts`), the forests' tracer
  (`check-forest.ts`), the unit tests, `bun run build:pages`, then the build opened in a headless Chrome
  (`scripts/site-smoke.ts --until renderer`: a gate up to the renderer made, its shaders compiled — audit QA-02, Sam's choice; a
  first frame reported only: the runner's SwiftShader loses its device after the renderer) — and `site` assembles their builds (main at the
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
  other way, in a subdirectory (`crew/`, `docs/`) or nowhere, is kept. Past 800 MB a warning; past 900 MB
  `/ineptie/` then `/test/` are left out, and main alone past 900 MB fails before deploying ([ASSETS.md](ASSETS.md)).
- **Before a push** (since 2026-11-10, audit QA-01): the versioned hook `.githooks/pre-push` (installed once per
  checkout by `bun run hooks`: `core.hooksPath`, absolute, so every worktree runs it) keeps Git LFS's upload, then
  runs `scripts/pre-push.ts` on the exact revision pushed — checked out alone in a temporary worktree, never the
  shared working tree — : `biome ci`, then `tsc`, `check-wgsl` and `check-repo-size` side by side. ≈ 25 s on the
  M1 Max (measured 2026-11-10: 24.1 s on `f7e87ab5`). A failure refuses the push with each failing check's whole
  output. `bun run check:push` runs it on HEAD; `KERR_SKIP_CHECKS=1 git push` skips it in an emergency (the CI
  still judges). The unit tests stay with the CI.
- **The binaries' guard** (`scripts/check-repo-size.ts`): each binary blob a commit adds or rewrites fails past
  8 MB, a warning when they come to 20 MB together; the binaries Git tracks warn past 650 MB and fail past
  700 MB in all (560 / 600 until 15 Nov 2026, raised by Sam, audit QA-03); the LFS objects warn past 800 MB. Its budgets are raised in that file, in the change that
  needs it.
- **The Pages deployment tried twice**: Pages sometimes stalls in `syncing_files` (2026-11-06: 10 min, against
  the usual 30 s for the same 881 MB); the `deploy` job's first try times out at 15 min, then a second one from
  the same artifact gets 20 min.
- **A pull request** runs the same checks (`verify`) and the build, and deploys nothing.

## The dedicated server

- **`deploy/`** — the Dockerfile, the nginx configuration (hashed files cached a year, the page, the
  Service Worker and the JSON files `no-cache`; the KTX2 and manifest types), the compose template
  and `render-compose.sh`, which fills in its two images (the site's, the room server's).
  Security (audit QA-18, 13 Nov 2026): the page's scripts held by its own `<meta>` Content-Security-Policy in `index.html` (`script-src 'self' 'wasm-unsafe-eval'` and the hashes of its two head scripts — `tests/csp.test.ts` checks them; a change to either script needs its new hash), so on the Pages as here; nginx adds what a meta cannot — `frame-ancestors 'self'` —, `X-Content-Type-Options: nosniff` and `Referrer-Policy` in each location (an `add_header` there drops the server's). The dev server's own small inline beacon is refused by the policy (a console line in development only; its hot reload is a module, allowed).
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
push main touching server/ or the src/ files it imports ─► rooms.yml: the network's tests, deploy/Dockerfile.rooms
                           → ghcr.io/thesamlepirate/black-hole-gpu:rooms-<sha⁷>-<run>.<attempt> (the site's public package)
                         ─► a commit on `deploy`: compose.yml naming it beside the site's image
Portainer ─► recreates the `rooms` service alone (port 3001, its rooms in the `rooms-data` volume)
```

- **Both workflows write `deploy`**, one at a time (concurrency group `deploy-branch`); each keeps the
  other's image as it found it. Until the room server has an image, its block is left out.
- **Nginx Proxy Manager**: the host `stream.samlepirate.org` → `host:3001`, *Websockets Support* on.
- **Checked by** `https://stream.samlepirate.org/health` (`{ ok, v, build, rooms, live, peers, rejected }` — `rejected`:
  the events and samples dropped at the input since the start, src/net/inbound.ts, RD1; and since RD2 the JSON
  messages past a connection's bucket). **RD2 (13 Nov 2026) counts addresses by the `X-Real-IP` header Nginx Proxy
  Manager sets** (the traffic relay's pace too, since a later lot that day — `server/address.ts`, audit QA-21) — without it, every page would share the proxy's address and its 10 rooms an hour. Passwords are now
  argon2id; the rooms' older sha256 ones are still read and salted at their next good guess (no migration to run).
- **Only when the server's code changed** — `server/**`, the files of `src/` it imports (`src/net/proto.ts`, `src/net/inbound.ts`,
  `src/system/lola-codec.ts` — kept by `tests/rooms-deploy.test.ts`; before 13 Nov 2026 all of `src/net/**`: a client's file restarted it, audit NET-20), `deploy/Dockerfile.rooms`,
  `deploy/compose.yml`, `deploy/render-compose.sh` or the workflow itself (on main only — `reseau` too before 13 Nov 2026, a month behind: audit QA-07): the players are
  not cut off by every push. Its tests (`net-core`, `net-rooms`, `net-server-defence`, `net-world-bound`, `room-code`, `rooms-deploy`, `lola-tiles`) run first; the image holds `server/` and
  those three files alone (Bun, no dependency, the rooms in SQLite on `/data`).
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

### The Moon's and Mars's relief tiles — `server/moon-tiles.ts` (PLAN-PLANETES-AAA P6, P7)

The global models have no tiled copy a page can read: the USGS's GeoTIFFs on AWS are one strip a row — LRO LOLA's 118 m
(8.5 GB), Mars's HRSC and MOLA blend at 200 m (11.4 GB). The stack's `moon-tiles` service (the room server's image) reads
each once, a band of rows at a time, Mars's resampled to 256 pixels a degree, and writes ~3–4 GB of tiles a world
(`src/system/lola-codec.ts`: z 0 … 3, 1° … 8° a tile; the Moon in half-metres, Mars in metres) into the `moon-data`
volume (`/moon/lola`, `/moon/mars`), then exits; started again (a redeploy), it only checks they are all there. The room
server serves them read-only at `https://stream.samlepirate.org/svc/v1/moon/lola/{z}/{row}/{col}.bin` and
`…/svc/v1/mars/dem/…` (gzipped, CORS open, immutable), and each build's progress at `…/status` (`rows` of `of`, `levels`,
`done`, `error`). Locally, `bun server/moon-build.ts --body mars --rows 91 99 --cols 133 141` builds a box (z 0 rows and
columns) into the git-ignored `data/`, which the dev server serves at the same paths.

## The Linux OBC Wisp v1 relay (`wss://code.samlepirate.org/`)

The embedded Linux OBC (`docs/PLAN-LINUX-OBC.md`) uses a Wisp v1 WebSocket-to-TCP relay (`server/wisp-main.ts`, `server/wisp-relay.ts`) to reach Alpine `apk` repositories, `curl`, Python `pip`, and Node `npm` from the browser.

- **Portainer (`kerr` stack):** included automatically as the `wisp` service in `deploy/compose.yml` (reusing `__ROOMS_IMAGE__` on port `3002`, no extra Docker build required). A standalone stack template is also kept in `deploy/portainer-wisp.yml` if you prefer a separate Portainer stack.
- **Nginx Proxy Manager:** create a Proxy Host for `code.samlepirate.org` → `host:3002` with **Websockets Support** enabled and TLS/HTTPS active.
- **Security (since 24 Nov 2026; the relay is reachable by anyone, so it is built to be safe as an open endpoint):**
  - **Origin required.** An upgrade without an allowed `Origin` is refused (403): `https://samlepirate.org`,
    `https://www.samlepirate.org`, `https://thesamlepirate.github.io`, any `https://*.samlepirate.org`, `localhost`, plus
    `WISP_ORIGINS` (comma-separated). A browser cannot lie about its Origin, so no other site can use the relay through its
    visitors; a script can forge it, which is why the next three guards do not depend on it.
  - **Destinations checked numerically** (`src/util/ip-guard.ts`): IP literals in any spelling (IPv6 long forms, IPv4-mapped,
    NAT64, 6to4, zoned) and every resolved address must be public — loopback, RFC 1918, CGNAT, link-local and cloud metadata,
    documentation, benchmarking, multicast, reserved, ULA, site-local refused; IPv6 must be global unicast. Legacy numeric IPv4
    forms (`2130706433`, `127.1`, `0x7f.1`) and local names (single labels such as Docker service names, `.local`,
    `.internal`, `.home.arpa`…) are refused. The relay resolves names itself and connects to the checked literal.
  - **Destination ports:** `WISP_TCP_PORTS` (default `80,443,9418`: HTTP, HTTPS, `git://`; add `22` for git over SSH if
    wanted), `WISP_UDP_PORTS` (default `53`; `0` = no UDP — unkernel's client does not use UDP today). Mail ports 25, 465,
    587 and 2525 are refused whatever the lists say.
  - **Caps:** `WISP_MAX_CLIENTS` (32 in the stack) WebSockets at once, `WISP_MAX_PER_IP` (8) per client IP, 96 streams per
    WebSocket, `WISP_IP_CONNECTS_PER_SEC` (20/s, burst ×5) stream opens per IP, `WISP_IP_BYTES_PER_SEC` (4 MiB/s, burst 8 s)
    per IP and `WISP_GLOBAL_BYTES_PER_SEC` (24 MiB/s) for the relay, both directions; a client sending past its Wisp credits is
    closed (`THROTTLED`) at a bounded queue.
  - **Client IP:** `X-Real-IP` / `X-Forwarded-For` are believed only from a trusted proxy (`TRUSTED_PROXIES`, default
    loopback + private ranges, where Nginx Proxy Manager reaches the container from; `server/address.ts`). Port 3002 is
    published on the host: **keep it closed to the internet** (firewall), so every client comes through the proxy. If Docker
    runs its userland proxy on this host (every published connection then seems to come from the bridge gateway), set
    `TRUSTED_PROXIES` to the proxy's own address.
  - **Why no signed token:** the site is static (Pages, nginx); a token handed to any visitor is handed to any script, so it
    would add a round trip without stopping a forger. What bounds abuse is the destination/port allowlist and the caps: the
    worst a forger gets is a slow HTTP(S)/git egress, counted by IP.
- **Health check:** `https://code.samlepirate.org/health` returns `{ ok: true, protocol: "wisp/1", build, activeClients, totalStreams, blockedHosts, blockedPorts, throttledStreams, ratePauses, udpDropped, ... }`.
- **Client default:** the simulator uses `/__wisp` automatically in local dev and falls back to `wss://code.samlepirate.org/` in production (overridable in the OBC HUD Options drawer).

## Cross-origin isolation (the Linux OBC's multi-CPU)

Unkernel runs more than one vCPU only with `SharedArrayBuffer`, which the browser grants only to a **cross-origin isolated**
page: `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: credentialless`. One vCPU works without.
The headers were added to the whole site on 23 Nov 2026 (d11d75d1); since the review of 24 Nov 2026 they are sent **only to a
player who asked for them**, so the game without the OBC is served as before:

- **The `kerr_coi` cookie** (`src/obc/isolation.ts`): absent — not isolated; `1` — isolated from the next load; `0` — the
  player said no (never set again by itself). The OBC sets `1` at its first boot with more than one vCPU (the boot itself
  runs on one vCPU; SMP from the next load); the player switches it in the OBC manager (System tab, "Multi-CPU", with a
  reload button). `crossOriginIsolated` and the vCPU count show in the same tab and in `__bh.obc.kernelStats()`.
- **Who reads it:** nginx (`deploy/nginx.conf`: `map $cookie_kerr_coi` → `$kerr_coop` / `$kerr_coep`, empty = no header,
  `Vary: Cookie` on the page so a revalidation never mixes the two), the dev server (`server.ts`: the `/` and `/crew/`
  pages; `KERR_COI=1` / `KERR_COI=0` force it on / off, `KERR_NO_COI=1` off as before), and the Service Worker (`src/sw.ts`:
  through `cookieStore`, for GitHub Pages which sends no headers; it also removes them from a page cached while isolated).
  Where the worker has no `cookieStore` (Firefox, Safari), Pages stays non-isolated: one vCPU there.
- **The hashed assets** carry `Cross-Origin-Resource-Policy: same-origin` (nginx): only this site embeds them; harmless for
  the game (all same-origin), and needed by nothing — `credentialless` does not ask CORP of same-origin files.

What isolation changes for the rest of the game (read from the code on 24 Nov 2026, **not yet checked in a browser**):

- **Data loads — unaffected.** Every cross-origin resource is read by `fetch` in CORS mode or by an `<img crossorigin>`
  (IGN Géoplateforme, swisstopo, ESA WorldCover, GIBS, EOX, Mapterhorn, OpenFreeMap/OSM tiles, the Overture PMTiles
  ranges on S3, Open-Meteo, NOAA SWPC, CelesTrak, VATSIM, Overpass/Nominatim/Photon, OpenRouter, Anthropic/OpenAI,
  stream.samlepirate.org); COEP does not apply to CORS responses, and `credentialless` would only drop cookies from
  no-cors loads, of which the game has none. The Service Worker keeps only non-opaque tile responses. No web fonts, no
  cross-origin iframe, no cross-origin worker script. WebSockets (rooms, Wisp, Deepgram relay) and WebRTC are outside COEP.
- **Popups — changed.** COOP `same-origin` puts a cross-origin popup in another browsing-context group: the OpenRouter
  sign-in popup loses `window.opener` and its handle reads `closed` at once. The callback page (`pwa/openrouter.html`)
  also answers through a `BroadcastChannel`, and `connect()` (`src/ai/openrouter.ts`) no longer gives up 1.5 s after
  `closed` when the page is isolated (five minutes instead); `tests/obc-isolation.test.ts` proves the two paths.
  `window.open(…, "noopener")` (the title's docs) is unaffected.
- **Workers — to check.** The game's own workers (`/*-worker.js`, same origin) are served with the page's COEP by nginx
  (location `/`) but without it by the dev server and GitHub Pages. Chrome takes a dedicated worker's policy from its
  creator; a browser applying the HTML rule strictly (a worker script without COEP under an isolated owner) could refuse
  them. Only for isolated players; check Firefox once its WebGPU runs the game.
- **Safari** does not know `credentialless`: no isolation, nothing broken (one vCPU).

## The server stuck on an old build

Check `https://samlepirate.org/version.json` against the last `deploy:` commit (`git log -1 origin/deploy`). Portainer 2.9.3
**stops a stack's auto-update for good after one failed poll** (its log: `job returned an error`, then `job cancelled, stopping`;
the stack still shows "every 1m"). It happened on 2026-11-10 at 10:15 UTC (a transient error): samlepirate.org stayed on `cdf02ee`
for two days, 168 commits behind, while CI, GHCR and the `deploy` branch were fine. Fix: on the `kerr` stack, *Pull and redeploy*
and save its Git settings again (or restart the Portainer container) — done by Sam on 2026-11-12, the server back on `fe3d710` and
its polls resumed. A browser may still hold the old build in the PWA's cache: reload twice.

## Rolling back

Revert the last commit(s) on `deploy` (or push a commit naming an older tag): Portainer redeploys that
image at its next poll. A push to main moves the branch forward again.

## Deploying by hand

Rerun the workflow (Actions → Deploy to GitHub Pages → Run workflow): a new run builds a new tag (main's
build restored from the cache when its commit was built already). The room server: Actions → Room server → Run
workflow.
