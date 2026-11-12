// PLAN-J2 J2-1: a tile put is queued for the next image's publication (EarthTiles.publish — the renderer, at an image's start). The
// tests that feed the tiles by hand and read what is drawn right after (heights, rectangles) publish each put at once — the renderer's
// frame between two puts; the publication's own order and budget are tested apart (tests/earth-pages.test.ts).
import type { EarthTiles } from "../../src/system/earth-tiles";

// (J2, the peaks: the image's budget of the page's thread — the loads' starts, the halo's look in slices — set aside: these tests read
// what one request does; the budget is tested apart, tests/earth-pages.test.ts)
export function published<T extends EarthTiles>(t: T): T {
  t.frame.limit = Number.POSITIVE_INFINITY;
  t.haloSliceMs = Number.POSITIVE_INFINITY;
  const put = t.put.bind(t);
  t.put = (...a: Parameters<EarthTiles["put"]>) => {
    put(...a);
    t.publish(Number.POSITIVE_INFINITY);
  };
  return t;
}
