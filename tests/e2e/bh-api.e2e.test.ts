import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { type BhMember, NAMESPACES, undocumented, WALK } from "./lib/bh-api";

// The automation handle's reference stays whole: every member of __bh, and every member of its namespaces
// (__bh.game, __bh.sys, …), read live from the page, is in docs/BH-API.md under its full path in backquotes.
// A member added without its entry fails here — `bun scripts/bh-api.ts --check` lists them.

describe.skipIf(!E2E)("docs/BH-API.md covers __bh", () => {
  let app: App;
  let members: BhMember[];
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting !== undefined", 30_000);
    members = await app.js<BhMember[]>(WALK);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the walk sees the handle and its namespaces", () => {
    const paths = members.map((m) => m.path);
    expect(paths).toContain("__bh.freeze");
    expect(paths).toContain("__bh.game.status");
    for (const ns of NAMESPACES) expect(paths.some((p) => p.startsWith(`__bh.${ns}.`))).toBe(true);
  });

  test("every member has its entry", async () => {
    const doc = await Bun.file("docs/BH-API.md").text();
    expect(undocumented(members, doc)).toEqual([]);
  });
});
