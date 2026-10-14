# Deployment on the dedicated server

The site also runs on the dedicated server (https://samlepirate.org), beside GitHub Pages: the same
site as main builds it (main at the root; the preview, `test-kimi`, is on GitHub Pages only, under
`/test/`), served by nginx in a container.
Nothing calls into the server — it fetches its updates itself.

```
push main / test-kimi ─► pages.yml "site": verified, built, assembled (the Pages artifact)
push main             ─► pages.yml "server": that artifact, /test/ removed, in deploy/Dockerfile (nginx)
                           → ghcr.io/thesamlepirate/black-hole-gpu:<main sha>-<run>
                         ─► a commit on the `deploy` branch: compose.yml naming that tag
Portainer (stack "kerr", from the `deploy` branch, polling) ─► new commit ─► pulls the tag ─► redeploys
```

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
                           → ghcr.io/thesamlepirate/black-hole-gpu:rooms-<sha>-<run> (the site's public package)
                         ─► a commit on `deploy`: compose.yml naming it beside the site's image
Portainer ─► recreates the `rooms` service alone (port 3001, its rooms in the `rooms-data` volume)
```

- **Both workflows write `deploy`**, one at a time (concurrency group `deploy-branch`); each keeps the
  other's image as it found it. Until the room server has an image, its block is left out.
- **Nginx Proxy Manager**: the host `stream.samlepirate.org` → `host:3001`, *Websockets Support* on.
- **Checked by** `https://stream.samlepirate.org/health` (`{ ok, v, build, rooms, live, peers }`).
- A page is told to reload when its protocol is older than the server's previous one; the server can lag
  the page by Portainer's poll (2 min), which the protocol's N/N−1 covers.

### The TURN relay (coturn) — when the voices and the direct links must cross a carrier's NAT

Most players reach each other directly (STUN); a phone on 4G/5G often cannot (CGNAT) and then needs a relay.
To turn it on:

1. Choose a secret (`openssl rand -hex 32`) and set it as `TURN_SECRET` in the `kerr` stack's environment in
   Portainer (never in the repository).
2. Open on the server (ufw/nftables, and the OVH Network Firewall if it is on): `3478/udp`, `3478/tcp`,
   `49160-49200/udp`.
3. Uncomment the `coturn` service in `deploy/compose.yml` (it runs on the host's network: the relay needs the
   real ports) and push: the room server then hands each page TURN credentials of 6 hours (an expiry and
   the device as the username, its HMAC-SHA1 under the secret as the password — coturn's
   `use-auth-secret`), relaying to private networks refused.

## Rolling back

Revert the last commit(s) on `deploy` (or push a commit naming an older tag): Portainer redeploys that
image at its next poll. A push to main moves the branch forward again.

## Deploying by hand

Rerun the workflow (Actions → Deploy to GitHub Pages → Run workflow): a new run builds a new tag.
