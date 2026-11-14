// The built site opened in a browser before it ships (audit 2026-11-10, QA-02: no e2e ran in CI, and none against `_site/` — the
// artefact deployed: its relative paths, its precache, its Service Worker's scope reached production with no browser ever loading
// them; a black screen at start would have passed CI).
//
//   bun scripts/site-smoke.ts [dir=_site] [--hash scene=game:artemis] [--timeout 90]
//
// `dir` served as static files on localhost (WebGPU wants a secure context); a headless Chrome (SwiftShader on Linux, the GPU on
// a Mac) opens it; the game must come up — its automation handle, its renderer, a first frame drawn — within the time, with no
// uncaught exception and no console error. Exit 0 or 1, what failed said.

import { existsSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { launch } from "../tests/e2e/lib/cdp";

const args = process.argv.slice(2);
const flag = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : def;
};
const dir = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true) ?? "_site";
const hash = flag("hash", "scene=game:artemis");
const timeoutS = Number(flag("timeout", "90"));

if (!existsSync(join(dir, "index.html"))) {
  console.error(`site-smoke: ${dir}/index.html missing — build the site first (bun run build)`);
  process.exit(1);
}

// (the site as a static host serves it: a path, its file; a directory, its index.html)
const root = normalize(dir);
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = normalize(join(root, p));
    if (!file.startsWith(root)) return new Response("forbidden", { status: 403 });
    if (!existsSync(file) || !statSync(file).isFile()) return new Response("not found", { status: 404 });
    return new Response(Bun.file(file));
  },
});
const url = `http://127.0.0.1:${server.port}/#${hash}`;
/** an error the game itself does not count as a failure — a device destroyed on purpose (renderer.ts: gpuDiagnostics records
 *  device-lost:destroyed as no failure; a new device follows) —: said, not failed on */
const benign = (e: string) => /^WebGPU device lost: Device was destroyed/.test(e);
const t0 = Date.now();
const cdp = await launch({ width: 1280, height: 800 });
const fail = async (why: string) => {
  console.error(`site-smoke: FAIL — ${why}`);
  if (cdp.errors.length) console.error(`  the page's errors:\n${cdp.errors.map((e) => `    ${e.split("\n")[0]}`).join("\n")}`);
  // (what the page shows and how far it went — its text, its boot's stages, the adapter —, to read on a runner)
  const seen = await js<unknown>(`(async () => {
    const out = { text: (document.body?.innerText ?? "").replace(/\\s+/g, " ").slice(0, 600), bh: typeof globalThis.__bh };
    try { out.marks = __bh.boot().marks.map((m) => m.name + "@" + Math.round(m.t)); } catch (e) { out.marks = String(e); }
    try { out.diag = JSON.stringify(__bh.graphicsDiagnostic()).slice(0, 1200); } catch (e) { out.diag = String(e); }
    try { const a = await navigator.gpu?.requestAdapter(); out.adapter = a ? { info: a.info?.description || a.info?.vendor, tex: a.limits.maxSampledTexturesPerShaderStage, sto: a.limits.maxStorageBuffersPerShaderStage, buf: a.limits.maxBufferSize } : null; } catch (e) { out.adapter = String(e); }
    return out; })()`).catch((e) => String(e));
  console.error(`  what the page shows: ${JSON.stringify(seen, null, 1).slice(0, 4000)}`);
  cdp.close();
  server.stop(true);
  process.exit(1);
};
const js = async <T>(expr: string): Promise<T> => {
  const r = await cdp.send<{ result?: { value?: T }; exceptionDetails?: { text: string } }>("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  return r.result?.value as T;
};
/** a condition met within the time left, or what it was waiting for said */
const until = async (expr: string, what: string) => {
  while (!(await js<boolean>(`(() => { try { return !!(${expr}); } catch { return false; } })()`).catch(() => false))) {
    if (Date.now() - t0 > timeoutS * 1000) await fail(`${what}: not within ${timeoutS} s`);
    if (cdp.errors.some((e) => !benign(e))) await fail(`${what}: an error first`);
    await Bun.sleep(250);
  }
  console.log(`  ${what} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
};

console.log(`site-smoke: ${dir} at ${url}`);
await cdp.send("Page.enable");
await cdp.send("Page.navigate", { url });
await until(`typeof globalThis.__bh === "object" && !!__bh.renderer`, "the game's automation handle and its renderer");
await until(`__bh.gpu.frames().completedFrames > 0 || Number.isFinite(__bh.boot().firstImage)`, "a first frame drawn");
// (a few seconds more for what a first frame sets off — its workers, its Service Worker)
await Bun.sleep(3000);
if (cdp.errors.some((e) => !benign(e))) await fail("errors after the first frame");
for (const e of cdp.errors.filter(benign)) console.log(`  (said, not counted: ${e.split("\n")[0]})`);
const boot = await js<{ marks?: { name: string; t: number }[]; firstImage?: number }>(
  `(() => { try { const b = __bh.boot(); return { marks: b.marks, firstImage: b.firstImage }; } catch { return {}; } })()`,
);
const first = boot?.firstImage;
console.log(
  `site-smoke: OK in ${((Date.now() - t0) / 1000).toFixed(1)} s — the first image at ${Number.isFinite(first) ? `${(first! / 1000).toFixed(1)} s` : "?"}, ${boot?.marks?.length ?? 0} boot stages, no error`,
);
cdp.close();
server.stop(true);
process.exit(0);
