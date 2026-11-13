// The game's own files fetched out of the page's sight — by a worker (the KTX2 transcoder's), whose loads the page's resource timings
// do not list. On the first visit such a worker may start before the Service Worker holds the page: its fetches go to the network and
// nothing keeps them. The page warms its shell from this list too (src/pwa.ts warmShell) — measured 13 Nov 2026 (e2e pwa): the Earth's,
// Moon's and Mars's compressed maps missing after one visit, offline the large maps' array fell back to JPEGs never loaded.

const seen = new Set<string>();

/** A file of the game's (same origin) a worker is asked to fetch: kept for the shell's warming. */
export function noteAsset(url: string) {
  if (seen.size < 4096) seen.add(url.split("#")[0]!);
}

/** The files noted so far. */
export const assetsSeen = (): readonly string[] => [...seen];
