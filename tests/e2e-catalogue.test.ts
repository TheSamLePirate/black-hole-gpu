import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { catalogued, e2eFiles, header, missing, row } from "../scripts/e2e-catalogue";

// The e2e catalogue kept whole (audit 2026-11-10, QA-11: 125 of 397 files missing from docs/E2E-CATALOGUE.md, which says « every
// e2e file »): every e2e file but the probes (`zz-`) has its row — `bun scripts/e2e-catalogue.ts --write` writes the missing ones from
// their headers. The check's witnesses first: it sees a file without a row, and a catalogue it is given whole is whole.

const md = readFileSync(`${import.meta.dir}/../docs/E2E-CATALOGUE.md`, "utf8");

test("the check's witnesses: a file without a row is seen; the dashboard's row pattern read", () => {
  const cat =
    "| a.e2e.test.ts | proves | default | 1 | — |\n| `b.e2e.test.ts` | proves | default | 1 | — |\nc.e2e.test.ts named in a text\n";
  expect([...catalogued(cat)].sort()).toEqual(["a.e2e.test.ts", "b.e2e.test.ts"]);
  expect(missing(["a.e2e.test.ts", "b.e2e.test.ts", "c.e2e.test.ts"], cat)).toEqual(["c.e2e.test.ts"]);
  expect(missing(["a.e2e.test.ts", "b.e2e.test.ts"], cat)).toEqual([]);
});

test("a row written from a header: what it proves, its « Done when », its scene and size, its duration, a pipe escaped", () => {
  const src = `import x from "y";\n// The thing | proved here.\n// Done when: it is seen.\n// Duration: ~1 min.\n\nApp.boot({ width: 1280, height: 800, hash: "scene=game:artemis" });\n`;
  expect(header(src)).toEqual(["The thing | proved here.", "Done when: it is seen.", "Duration: ~1 min."]);
  expect(row("t.e2e.test.ts", src)).toBe(
    "| t.e2e.test.ts | The thing \\| proved here. Done when: it is seen. | game:artemis, 1280×800 | ~1 min. | — |",
  );
  expect(row("t.e2e.test.ts", src, { "t.e2e.test.ts": { mini: 42, here: 50 } })).toContain("| 42 s (mini) |");
});

test("every e2e file has its row in the catalogue (the probes, zz-, apart)", () => {
  const gone = missing(e2eFiles(), md);
  expect(gone).toEqual([]);
});
