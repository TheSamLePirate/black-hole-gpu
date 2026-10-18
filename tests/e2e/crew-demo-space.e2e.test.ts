import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-VAISSEAUX K7: the crew demo room (scripts/crew-demo.ts --space) run against the test's server — the leader's
// F-35 and three spacecraft — and the crew console on a device WITHOUT WebGPU: following Cooper (the Ranger by the ISS) its system map
// drawn on the canvas (the fallback), his failure's checklist ticked and its action given (the demo pilot answers);
// following Brand (the Lander descending on the Moon) the ground view; following Romilly (the Endurance by Gargantua)
// the hole's map and the ground station's link cut. (E2E_SHOTS=<dir>: the views.) ~1 min.

describe.skipIf(!E2E)("the crew demo room's spacecraft, without WebGPU (K7)", () => {
  let app: App;
  let demo: { kill(): void } | null = null;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  const follow = async (name: string) => {
    // (its option in the pilots' list first: the roster's)
    await app.waitFor(
      `(() => { const m = __crew.net.room?.members.find((x) => x.name === ${JSON.stringify(name)}); return !!m && !!document.querySelector('#pilot option[value="' + m.slot + '"]'); })()`,
      10_000,
    );
    const craft = name === "Cooper" ? "Ranger" : name === "Brand" ? "Lander" : "Endurance";
    // (chosen in the pilots' list — again if a roster's refresh took the choice back)
    for (let k = 0; k < 4; k++) {
      await app.js(`(() => {
        const m = __crew.net.room.members.find((x) => x.name === ${JSON.stringify(name)});
        const sel = document.getElementById("pilot"); sel.value = String(m.slot); sel.dispatchEvent(new Event("change")); return 1; })()`);
      try {
        await app.waitFor(`__crew.model.own()?.snapshot?.craft?.name === ${JSON.stringify(craft)}`, 4000);
        return;
      } catch {
        // (another try)
      }
    }
    throw new Error(`could not follow ${name}`);
  };

  beforeAll(async () => {
    app = await App.boot({
      entry: "crew",
      width: 1440,
      height: 900,
      // (no WebGPU on this device: the map's fallback)
      initScript: `if (location.pathname.includes('/crew/')) Object.defineProperty(navigator, "gpu", { get() { return undefined; } });`,
    });
    const ws = new URL("net", app.url).href.replace("http", "ws");
    const proc = Bun.spawn(["bun", "scripts/crew-demo.ts", ws, "--space"], { stdout: "pipe", stderr: "inherit" });
    demo = proc;
    // (its room's code on its first line)
    const reader = proc.stdout.getReader();
    let out = "";
    const until = performance.now() + 20_000;
    while (!/Salle ([A-Z2-9]{6})/.test(out) && performance.now() < until) {
      const { value, done } = await reader.read();
      if (done) break;
      out += new TextDecoder().decode(value);
    }
    reader.releaseLock();
    const code = /Salle ([A-Z2-9]{6})/.exec(out)?.[1];
    if (!code) throw new Error(`no room from the demo: ${out}`);
    await app.js(`(document.getElementById("name").value = "", 1)`);
    await app.click("#name");
    await app.type("Doyle");
    await app.click("#code");
    await app.type(code);
    await app.js(
      `(() => { const s = document.getElementById("station"); s.value = "capcom"; s.dispatchEvent(new Event("change")); return 1; })()`,
    );
    await app.click("#join");
    await app.waitFor(
      "__crew.net.room?.role === 'instruments' && __crew.net.room.members.filter((m) => m.role === 'pilot').length >= 4",
      20_000,
    );
  }, 120_000);
  afterAll(() => {
    demo?.kill();
    app?.close();
    stopServer();
  });

  test("Cooper: the system map on the canvas (no WebGPU), the Ranger's orbit; his failure's checklist ticked, its action given", async () => {
    await follow("Cooper");
    await app.waitFor(`document.body.dataset.profile === "space"`, 5000);
    await app.click("[data-view=system]");
    await app.waitFor(`__crew.views.sysRenderer.kind === "canvas"`, 10_000);
    await Bun.sleep(800);
    await shot("1-cooper-carte-canvas");
    // (his failure comes at 40 s of the demo)
    await app.waitFor(`(__crew.model.own()?.snapshot?.sysx?.failures?.length ?? 0) === 1`, 60_000);
    await app.waitFor(`!!document.querySelector('[data-testid="sys-step-rcsStuck-0"]')`, 5000);
    for (let i = 0; i < 3; i++) {
      await app.js(`(document.querySelector('[data-testid="sys-step-rcsStuck-${i}"]').click(), 1)`);
      await app.waitFor(`(__crew.model.own()?.snapshot?.sysx?.failures?.[0]?.ticks?.length ?? 0) === ${i + 1}`, 5000);
    }
    await app.waitFor(`!document.querySelector("#sys-fix-rcsStuck").disabled`, 5000);
    await app.js(`(document.querySelector("#sys-fix-rcsStuck").click(), 1)`);
    await app.waitFor(`(__crew.model.own()?.snapshot?.sysx?.failures?.length ?? 1) === 0`, 15_000);
    expect(app.cdp.errors).toEqual([]);
  }, 120_000);

  test("Brand: the Lander's ground view, its landing point; Romilly: Gargantua's map, the ground's link cut", async () => {
    await follow("Brand");
    await app.click("[data-view=ground]");
    await app.waitFor(`document.getElementById("view-title").textContent === "Sol"`, 5000);
    await Bun.sleep(600);
    await shot("2-brand-sol");
    await follow("Romilly");
    await app.click("[data-view=system]");
    await app.waitFor(`document.getElementById("profile-badge").textContent.includes("LIAISON COUPÉE")`, 8000);
    await Bun.sleep(600);
    await shot("3-romilly-gargantua");
    expect(app.cdp.errors).toEqual([]);
  }, 60_000);
});
