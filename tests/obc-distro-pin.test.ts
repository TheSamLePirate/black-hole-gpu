import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinnedDistroEntry, sha256File, UNKERNEL_RELEASE, verifyDistro } from "../scripts/obc-distro";

// The OBC's dependencies and images pinned (review of 24 Nov 2026): exact versions like the rest of package.json, and the
// Debian image the site publishes checked against the committed size + sha256.

const dir = mkdtempSync(join(tmpdir(), "obc-distro-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("the OBC's packages are pinned exactly, and the image release follows unkernel's pin", async () => {
  const pkg = (await Bun.file("package.json").json()) as { dependencies: Record<string, string> };
  for (const name of ["@xterm/xterm", "@xterm/addon-fit", "@xterm/addon-image", "unkernel"]) {
    expect({ name, version: pkg.dependencies[name] }).toEqual({ name, version: expect.stringMatching(/^\d+\.\d+\.\d+[\w.-]*$/) });
  }
  expect(pkg.dependencies.unkernel).toBe(UNKERNEL_RELEASE);
});

test("the committed index pins Debian's size and sha256", async () => {
  const e = await pinnedDistroEntry("debian");
  expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(e.size).toBeGreaterThan(1_000_000);
  await expect(pinnedDistroEntry("gentoo")).rejects.toThrow("no pinned");
});

test("verifyDistro accepts the pinned bytes and refuses a different image (size, then hash)", async () => {
  const good = join(dir, "good.erofs");
  writeFileSync(good, "pinned image bytes");
  const entry = { name: "x", file: "x.erofs", image: "x-1", size: 18, sha256: await sha256File(good) };
  await verifyDistro(good, entry);
  const sameSize = join(dir, "same-size.erofs");
  writeFileSync(sameSize, "tampered image byt");
  await expect(verifyDistro(sameSize, entry)).rejects.toThrow("sha256");
  const shorter = join(dir, "short.erofs");
  writeFileSync(shorter, "short");
  await expect(verifyDistro(shorter, entry)).rejects.toThrow("bytes");
});
