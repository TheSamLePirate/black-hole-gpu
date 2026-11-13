import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

const OUT = "remote-results/tars-room";

// The network room through TARS (audit 2026-11-10, TA-17): his tool `room`, typed in his console as a command (`/tool
// room …`), on the dev server's real rooms — made, its status read as the model reads it (its code, its members), left —
// by the Network panel's own actions. Before 13 Nov 2026 TARS had no way to the room.
// Done when: a room made by the tool, its code the client's, the status naming it, left back to solo.
// Duration: ~30 s.

describe.skipIf(!E2E)("the room through TARS", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, lang: "fr", hash: "scene=game:artemis", tiles: false });
    await app.cdp.send("Network.setBlockedURLs", { urls: ["*geopf.fr*", "*ign.fr*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*"] });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.js(`(__bh.settings.voice = false, __bh.settings.tarsRemarks = false, true)`);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const run = async (line: string) => {
    if (await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").hidden`)) await app.press("F6", "F6");
    await app.js(`(document.querySelector("[data-testid=tars-input]").value = "", true)`);
    await app.type(line);
    await app.press("Enter");
  };

  test("made, read, left — by his tool", async () => {
    await run("/tool room action=create name=Wing");
    await app.waitFor(`!!__bh.net.net?.room?.code`, 15_000);
    const code = await app.js<string>(`__bh.net.net.room.code`);
    // (its status as the model reads it: the tool's own result)
    const st = await app.js<{ code: string; members: { name: string; you?: boolean }[] }>(
      `__bh.tars.tools().find((t) => t.name === "room").run({ action: "status" }, new AbortController().signal)`,
    );
    await app.snap(`${OUT}/status.png`);
    console.log(`  status ${JSON.stringify(st)}`);
    expect(st.code).toBe(code);
    expect(st.members.some((m) => m.you)).toBe(true);
    // (the fleet, as its tab lists it: alone in the room, none but ours — left out)
    const fleet = await app.js<{ fleet: unknown[] }>(
      `__bh.tars.tools().find((t) => t.name === "room").run({ action: "fleet" }, new AbortController().signal)`,
    );
    console.log(`  fleet ${JSON.stringify(fleet)}`);
    expect(fleet.fleet).toEqual([]);
    await run("/tool room action=leave");
    await app.waitFor(`!__bh.net.net?.room`, 10_000);
    console.log(`  room ${code} made by /tool, its status read, left`);
    expect(code).toMatch(/^[A-Z0-9]{3,8}$/);
  }, 60_000);
});
