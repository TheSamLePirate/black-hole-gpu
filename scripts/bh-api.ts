// The automation handle's members, read live (tests/e2e/lib/bh-api.ts): boots the app headless (or as this
// machine's lab config says), walks globalThis.__bh, prints the list — and with --check, the members
// docs/BH-API.md leaves out (exit 1 if any).
//
//   bun scripts/bh-api.ts                       # every member: path, kind, arity / size
//   bun scripts/bh-api.ts --json > /tmp/bh.json # the same as JSON
//   bun scripts/bh-api.ts --check               # what docs/BH-API.md is missing
//   bun scripts/bh-api.ts --scene game:artemis  # another scene (default: game:artemis, where every part is up)
import { App, stopServer } from "../tests/e2e/lib/app";
import { type BhMember, undocumented, WALK } from "../tests/e2e/lib/bh-api";

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const scene = arg("--scene") ?? "game:artemis";

const app = await App.boot({ hash: `scene=${scene}` });
let code = 0;
try {
  await app.waitFor("__bh.camera.piloting !== undefined", 30_000);
  const members = await app.js<BhMember[]>(WALK);
  if (process.argv.includes("--json")) console.log(JSON.stringify(members, null, 1));
  else if (process.argv.includes("--check")) {
    const missing = undocumented(members, await Bun.file("docs/BH-API.md").text());
    console.log(
      missing.length
        ? `docs/BH-API.md is missing ${missing.length}:\n${missing.join("\n")}`
        : `docs/BH-API.md covers all ${members.length}`,
    );
    code = missing.length ? 1 : 0;
  } else
    for (const m of members)
      console.log(
        `${m.path.padEnd(44)} ${m.kind}${m.arity !== undefined ? `/${m.arity}` : ""}${m.size !== undefined ? ` (${m.size})` : ""}${m.ctor ? ` ${m.ctor}` : ""}`,
      );
} finally {
  app.close();
  stopServer();
}
process.exit(code);
