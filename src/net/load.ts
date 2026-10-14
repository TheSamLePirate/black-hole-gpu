// The network loaded on demand (docs/PLAN-RESEAU.md, « Solo ou réseau »): net.js fetched next to the page the
// first time the player creates or joins a room — the solo game's bundle holds this loader alone.

export type NetModule = typeof import("./index");

/** the link's own words, read at the page's start (the game clears its hash once loaded): #server=, #netlab=, #join= */
export const netParams = new URLSearchParams(typeof location === "undefined" ? "" : location.hash.slice(1));

let mod: Promise<NetModule> | null = null;

export const netLoaded = () => mod !== null;

export function loadNet(): Promise<NetModule> {
  if (!mod) {
    const url = new URL("net.js", location.href).href;
    mod = (import(/* @vite-ignore */ url) as Promise<NetModule>).catch((e) => {
      mod = null;
      throw e;
    });
  }
  return mod;
}

/** The room server: `#server=` (dev, tests), the dev server's own /net on localhost, else stream.samlepirate.org. */
export function serverUrl(): string {
  const h = netParams.get("server");
  if (h && /^wss?:\/\//.test(h)) return h;
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !/[?&]prodnet\b/.test(location.search))
    return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/net`;
  return "wss://stream.samlepirate.org/";
}
