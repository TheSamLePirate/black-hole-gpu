import { expect, test } from "bun:test";
import { createHash } from "node:crypto";

// The page's Content Security Policy (audit QA-18): its two inline scripts allowed by their hashes — a change to either
// without its hash breaks the page in production (both scripts refused): checked here. And the policy keeps the game's
// own (its files, WASM) and refuses objects.
test("index.html's CSP: the hashes of its inline scripts, its own files and WASM", async () => {
  const html = await Bun.file("index.html").text();
  const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? "";
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  expect(scripts.length).toBe(2);
  const hashes = scripts.map((s) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`);
  for (const h of hashes) expect(csp).toContain(h);
  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(csp).toContain("object-src 'none'");
  // (the policy before the scripts it judges)
  expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<script>"));
});
