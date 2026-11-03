// The tiles' network kept on disk, then replayed at a set latency (T8: "the time to a visible quality … cold, warm, a degraded
// network" — an A/B of the loads' order measured on the same answers, whatever the hosts do that evening: 3 Nov 2026, this
// Mac's line at ~4.5 Mb/s, a Terrarium tile 1.3–5.8 s).
// Through Chrome's Fetch domain on the page's own requests (the Service Worker off: its fetches are another target's): each
// request of the tiles' hosts answered from disk — after `delayMs` when replaying (a fixed latency, no bandwidth limit, every
// request at once), at once when filling —; one not kept yet fetched by Bun itself, kept, then answered (counted: `misses` —
// a replay with misses waited on the network for them).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Cdp } from "./cdp";

/** the tiles' hosts (system/earth-tiles.ts and its national sources): Terrarium, EOX, GIBS, the Géoplateforme */
export const TILE_HOSTS = ["*s3.amazonaws.com/elevation-tiles*", "*tiles.maps.eox.at*", "*gibs.earthdata.nasa.gov*", "*data.geopf.fr*"];

type Paused = { requestId: string; request: { url: string; method: string } };
type Kept = { status: number; type: string; body: string };

const fileOf = (dir: string, url: string) => join(dir, `${createHash("sha1").update(url).digest("hex")}.json`);

/** A tile's answer from the host, kept (a 2xx or a 404 — the IGN's "none there" —; anything else not kept). */
async function fetchKeep(dir: string, url: string): Promise<Kept | null> {
  const res = await fetch(url, { headers: { "user-agent": "kerr-e2e tile-replay" } });
  const body = Buffer.from(await res.arrayBuffer()).toString("base64");
  const kept: Kept = { status: res.status, type: res.headers.get("content-type") ?? "application/octet-stream", body };
  if (res.ok || res.status === 404) writeFileSync(fileOf(dir, url), JSON.stringify(kept));
  return kept;
}

/**
 * Answers the tiles' requests from `dir` ("fill": at once, the missing ones fetched and kept — a recording; "replay": after
 * `delayMs`). Its counts as it goes; `stop()` lets the requests go.
 */
export async function tileReplay(cdp: Cdp, dir: string, mode: "fill" | "replay", delayMs = 300) {
  mkdirSync(dir, { recursive: true });
  const count = { served: 0, misses: 0, failed: 0 };
  await cdp.send("Fetch.enable", { patterns: TILE_HOSTS.map((urlPattern) => ({ urlPattern, requestStage: "Request" })) });
  const off = cdp.on("Fetch.requestPaused", (raw) => {
    const p = raw as unknown as Paused;
    void (async () => {
      try {
        const f = fileOf(dir, p.request.url);
        let kept: Kept | null;
        if (existsSync(f)) {
          kept = JSON.parse(readFileSync(f, "utf8")) as Kept;
          if (mode === "replay") await Bun.sleep(delayMs);
        } else {
          count.misses++;
          kept = await fetchKeep(dir, p.request.url);
        }
        if (!kept) throw new Error("no answer");
        await cdp.send("Fetch.fulfillRequest", {
          requestId: p.requestId,
          responseCode: kept.status,
          responseHeaders: [
            { name: "content-type", value: kept.type },
            { name: "access-control-allow-origin", value: "*" },
            { name: "cache-control", value: "no-store" },
          ],
          body: kept.body,
        });
        count.served++;
      } catch {
        // (the host refused, the page gone, the request cancelled — an aborted tile —: failed, as the network would)
        count.failed++;
        await cdp.send("Fetch.failRequest", { requestId: p.requestId, errorReason: "Failed" }).catch(() => {});
      }
    })();
  });
  return {
    count,
    async stop() {
      off();
      await cdp.send("Fetch.disable").catch(() => {});
    },
  };
}
