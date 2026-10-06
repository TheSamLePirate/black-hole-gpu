import { expect, test } from "bun:test";
import {
  classify,
  evictions,
  isAppPage,
  isLegacyShell,
  isOwnShellCache,
  ownsLegacyShell,
  SHELL_CACHE,
  TILE_BUDGET,
} from "../src/pwa/rules";

const O = "https://thesamlepirate.github.io";
/** the site's worker, and its preview's under it (the CI's test/) */
const SITE = `${O}/black-hole-gpu/`;
const TEST = `${SITE}test/`;
const DIRS = ["docs", "icons"];

test("a request's kind: hashed assets, the shell, the tiles, the elements, the rest", () => {
  expect(classify(`${SITE}index-a1b2c3d4.js`, SITE)).toBe("immutable");
  expect(classify(`${SITE}earth-3z05cvb5.ktx2`, SITE)).toBe("immutable");
  expect(classify(SITE, SITE)).toBe("shell");
  expect(classify(`${SITE}version.json`, SITE)).toBe("shell");
  expect(classify(`${SITE}plan-worker.js`, SITE)).toBe("shell");
  expect(classify(`${SITE}docs/comment-jouer.html`, SITE)).toBe("shell");
  expect(classify("https://s3.amazonaws.com/elevation-tiles-prod/terrarium/9/148/198.png", SITE)).toBe("tile");
  expect(
    classify(
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/default/GoogleMapsCompatible_Level8/8/99/74.jpeg",
      SITE,
    ),
  ).toBe("tile");
  expect(classify("https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=json", SITE)).toBe("elements");
  expect(classify("https://openrouter.ai/api/v1/chat/completions", SITE)).toBe("pass");
  expect(classify(`${O}/__snapshot?name=x`, `${O}/`)).toBe("pass");
  expect(classify(`${SITE}index-a1b2c3d4.js`, SITE, "POST")).toBe("pass");
  // (a page with a query — the tests' e2e=…: still the shell, cached under the scope's root too)
  expect(classify(`${O}/?e2e=0.5`, `${O}/`)).toBe("shell");
  expect(classify("not a url", SITE)).toBe("pass");
});

test("the site's worker keeps to its own app: not a preview under it, nor another app of the origin", () => {
  // (the build's directories and files: its own)
  expect(classify(`${SITE}docs/comment-jouer.html`, SITE, "GET", DIRS)).toBe("shell");
  expect(classify(`${SITE}icons/icon.svg`, SITE, "GET", DIRS)).toBe("shell");
  expect(classify(`${SITE}index-a1b2c3d4.js`, SITE, "GET", DIRS)).toBe("immutable");
  expect(classify(`${SITE}?e2e=1`, SITE, "GET", DIRS)).toBe("shell");
  // (the preview under it — its pages, its assets: a directory the site's build did not make)
  expect(classify(TEST, SITE, "GET", DIRS)).toBe("pass");
  expect(classify(`${TEST}?scene=x`, SITE, "GET", DIRS)).toBe("pass");
  expect(classify(`${TEST}index-a1b2c3d4.js`, SITE, "GET", DIRS)).toBe("pass");
  // (the same origin outside the scope: another repository's pages)
  expect(classify(`${O}/other-repo/index.html`, SITE, "GET", DIRS)).toBe("pass");
  // (the preview's own worker: its whole scope; the site above it is not its own)
  expect(classify(`${TEST}index-a1b2c3d4.js`, TEST, "GET", DIRS)).toBe("immutable");
  expect(classify(`${SITE}index-a1b2c3d4.js`, TEST, "GET", DIRS)).toBe("pass");
});

test("the app's page: its root or index.html, not docs/ nor a nested app's", () => {
  expect(isAppPage(SITE, SITE)).toBe(true);
  expect(isAppPage(`${SITE}?e2e=1#scene=x`, SITE)).toBe(true);
  expect(isAppPage(`${SITE}index.html`, SITE)).toBe(true);
  expect(isAppPage(`${SITE}docs/comment-jouer.html`, SITE)).toBe(false);
  expect(isAppPage(TEST, SITE)).toBe(false);
  expect(isAppPage(TEST, TEST)).toBe(true);
});

test("evictions: none under the budget; the oldest first, down to 90 % of it", () => {
  const MB = 1024 * 1024;
  const e = (url: string, t: number, mb: number) => ({ url, t, size: mb * MB });
  expect(evictions([e("a", 1, 100), e("b", 2, 100)])).toEqual([]);
  const out = evictions([e("old", 1, 100), e("mid", 2, 100), e("new", 3, 100), e("newest", 4, 50)], 300 * MB);
  // (350 MB: over; dropping "old" leaves 250 ≤ 270)
  expect(out).toEqual(["old"]);
  const out2 = evictions([e("old", 1, 100), e("mid", 2, 100), e("new", 3, 100), e("newest", 4, 200)], 300 * MB);
  expect(out2).toEqual(["old", "mid", "new"]);
  expect(TILE_BUDGET).toBeGreaterThan(100 * MB);
});

test("the shells' caches carry the scope and the build: each worker drops only its own", () => {
  const site = SHELL_CACHE(SITE, "4cb035a");
  const test = SHELL_CACHE(TEST, "ea2590f");
  expect(isOwnShellCache(site, SITE)).toBe(true);
  expect(isOwnShellCache(SHELL_CACHE(SITE, "1234567"), SITE)).toBe(true);
  expect(isOwnShellCache(test, SITE)).toBe(false);
  expect(isOwnShellCache(site, TEST)).toBe(false);
  expect(isOwnShellCache("kerr-tiles-v1", SITE)).toBe(false);
  // (a worker of before drops every "kerr-shell-…" but its own: not these)
  expect(isLegacyShell(site) || isLegacyShell(test)).toBe(false);
  expect(isLegacyShell("kerr-shell-4cb035a")).toBe(true);
});

test("a legacy shell: the site's older build is the site's to drop, never the preview's", () => {
  const elements = "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=json";
  // (the site's: its page, its assets — and, the old bug, the preview's first visit it served)
  const site = [SITE, `${SITE}index-a1b2c3d4.js`, elements, TEST, `${TEST}index-e5f6g7h8.js`];
  // (the preview's: its own page and assets only)
  const test = [TEST, `${TEST}index-e5f6g7h8.js`, elements];
  expect(ownsLegacyShell(site, SITE)).toBe(true);
  expect(ownsLegacyShell(site, TEST)).toBe(false);
  expect(ownsLegacyShell(test, TEST)).toBe(true);
  expect(ownsLegacyShell(test, SITE)).toBe(false);
});
