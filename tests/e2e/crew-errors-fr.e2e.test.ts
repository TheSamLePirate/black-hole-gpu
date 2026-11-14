import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { CrewFrame } from "./lib/crew";

// The room server's errors in the crew console's language (audit 2026-11-10, NET-32): the game translates them by their code
// (ui/netpanel.ts ERRORS); the console showed the server's English text as it came — « The room was deleted » on a French console.
// A room made by the pilot, the console joined in French, the room deleted by its owner.
// Done when: the console's notice says it in French.
// Duration: ~1 min.

describe.skipIf(!E2E)("the server's errors in the console's language", () => {
  let app: App;
  let crew: CrewFrame;
  let code = "";
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: false, crewLang: "fr" });
    await app.cdp.send("Network.setBlockedURLs", { urls: ["*geopf.fr*", "*ign.fr*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*"] });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.js("(__bh.net.setName('Ana'), true)");
    await app.js("__bh.net.create('Erreurs')");
    code = await app.js<string>("__bh.net.net.room.code");
    crew = new CrewFrame(app);
    await crew.open(code, "Ben");
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the room deleted: said in French", async () => {
    const owner = await app.js<string>(
      `(JSON.parse(localStorage.getItem("kerr.net.rooms") ?? "[]").find((r) => r.code === "${code}")?.owner ?? "")`,
    );
    expect(owner.length).toBeGreaterThan(0);
    await app.js(`__bh.net.net.remove("${code}", "${owner}").then(() => true, () => true)`);
    await app.waitFor(crew.d(`getElementById("notice").textContent.length > 0`), 10_000);
    const said = await app.js<string>(crew.d(`getElementById("notice").textContent`));
    console.log(`  the console says: ${said}`);
    await app.snap("remote-results/crew-errors-fr/deleted.png");
    expect(said).not.toMatch(/The room was deleted/);
    expect(said).toMatch(/salle/i);
  }, 60_000);
});
