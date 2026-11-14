import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

// The room server redeployed only when its own code changes (audit 2026-11-10, NET-20): its workflow followed all of src/net/** — a
// client's file (client.ts, remote.ts, the QR code) rebuilt and restarted it in production, the rooms' state in memory lost (a match,
// the light's delay, the pace's votes), the players cut. The server's own files from src/ worked out by its imports; every one of them
// followed by the workflow and copied into its image; a client's file not followed.

const ROOT = join(import.meta.dir, "..");
const yml = readFileSync(join(ROOT, ".github/workflows/rooms.yml"), "utf8");
const docker = readFileSync(join(ROOT, "deploy/Dockerfile.rooms"), "utf8");

/** the paths the workflow follows */
const followed = [...yml.matchAll(/^\s+- "([^"]+)"\s*$/gm)].map((m) => m[1]!);
const triggers = (file: string) => followed.some((p) => (p.endsWith("/**") ? file.startsWith(p.slice(0, -2)) : p === file));
/** what the image copies */
const copied = [...docker.matchAll(/^COPY (\S+) /gm)].map((m) => m[1]!);
const inImage = (file: string) => copied.some((c) => (c.endsWith("/") ? file.startsWith(c) : c === file));

/** the files of src/ the server imports, through their own imports */
function serverSources(): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    for (const m of readFileSync(join(ROOT, file), "utf8").matchAll(/from "(\.{1,2}\/[^"]+)"/g)) {
      const f = normalize(join(dirname(file), m[1]!)) + ".ts";
      if (!f.startsWith("src/") || seen.has(f)) continue;
      seen.add(f);
      visit(f);
    }
  };
  for (const f of readdirSync(join(ROOT, "server")).filter((x) => x.endsWith(".ts"))) visit(`server/${f}`);
  return [...seen].sort();
}

test("the server's own sources followed by its workflow and copied into its image; a client's file not followed", () => {
  const own = serverSources();
  console.log(`  the server's sources from src/: ${own.join(", ")}`);
  expect(own.length).toBeGreaterThan(0);
  expect(own.filter((f) => !triggers(f))).toEqual([]);
  expect(own.filter((f) => !inImage(f))).toEqual([]);
  expect(triggers("server/rooms.ts")).toBe(true);
  // (the client's own: no redeploy)
  for (const f of ["src/net/client.ts", "src/net/remote.ts", "src/net/qr.ts"]) expect({ f, t: triggers(f) }).toEqual({ f, t: false });
});
