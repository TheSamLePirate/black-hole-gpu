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
  Service Worker and the JSON files `no-cache`; the KTX2 and manifest types), and the compose template
  (`IMAGE` replaced by the CI).
- **The `deploy` branch** — written by the CI only, one commit per deployment. It moves only once the
  image is pushed, and each image has its own tag: Portainer never redeploys before the image exists,
  and a new tag is always pulled.
- **The server** — Portainer (2.9) stack `kerr`, from this repository's `refs/heads/deploy`,
  `compose.yml`, automatic updates by polling. The container publishes port 3000, which the Nginx Proxy
  Manager serves as samlepirate.org (TLS there).
- **The image** — the GHCR package must be public (the server pulls it without credentials).

## Rolling back

Revert the last commit(s) on `deploy` (or push a commit naming an older tag): Portainer redeploys that
image at its next poll. A push to main moves the branch forward again.

## Deploying by hand

Rerun the workflow (Actions → Deploy to GitHub Pages → Run workflow): a new run builds a new tag.
