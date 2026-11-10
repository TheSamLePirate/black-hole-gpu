// A retired preview's Service Worker (audit 2026-11-10, QA-04 — Sam: a preview must not be able to read the players'
// keys). The previews left the site's origin; a browser that once installed a preview's worker (its scope /test/ or
// /ineptie/) still runs that branch's cached code there. Its next update check fetches this file instead: it takes
// over at once, deletes that scope's own shell caches (kerr-shell:<scope path>:…, never the site's tiles or zones),
// unregisters itself and sends its pages to the site's root. .github/workflows/pages.yml copies it into each retired
// preview's directory.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const path = new URL(self.registration.scope).pathname;
      for (const name of await caches.keys()) if (name.startsWith(`kerr-shell:${path}:`)) await caches.delete(name);
      await self.clients.claim();
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(new URL("../", self.registration.scope).href);
    })(),
  );
});
