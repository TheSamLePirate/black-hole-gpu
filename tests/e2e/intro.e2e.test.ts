import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The intro (PLAN-TITRE-AAA E1): its sequence played whole on a first visit — the studio, the name, the logo, the
// background and the orb drawn by its Worker —, the title under it handed the name, a key passing it, the short
// version the next time, and its lift onto the live scene only once the first image and the sky are in. Its
// moments captured (SHOTS=<dir>, docs/progress/title-aaa by default when SHOTS=1).

const SHOTS = process.env.SHOTS === "1" ? "docs/progress/title-aaa" : process.env.SHOTS;
const CLEAR = "(localStorage.removeItem('kerr.intro.seen'), true)";

describe.skipIf(!E2E)("the intro", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ fullIntro: true, telemetry: false, width: 1440, height: 900 });
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  /** a page at the app, the intro played whole (or short), the graphics held `slow` s; not waited for */
  const open = async (o: { full: boolean; slow?: number }) => {
    if (o.full) await app.js(CLEAR);
    const origin = await app.js<number>("performance.timeOrigin");
    await app.cdp.send("Page.navigate", { url: `${app.url}?e2e=${Math.random()}${o.slow ? `#slowboot=${o.slow}` : ""}` });
    await app.waitFor(`performance.timeOrigin !== ${origin} && !!document.querySelector("#loading")`, 30_000);
  };
  /** the page's clock reaching `ms` since its navigation */
  const at = (ms: number) => app.waitFor(`performance.now() >= ${ms}`, 60_000);
  const shot = async (name: string) => {
    if (!SHOTS) return;
    const r = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 86 });
    await Bun.write(`${SHOTS}/${name}.jpg`, Buffer.from(r.data, "base64"));
  };
  const opacity = (sel: string) => app.js<number>(`Number(getComputedStyle(document.querySelector(${JSON.stringify(sel)})).opacity)`);

  test("played whole: the studio, the name, the logo, then the title and the background", async () => {
    await open({ full: true, slow: 25 });
    expect(await app.js<string>("document.documentElement.className")).not.toContain("intro-short");
    // (the studio's moments: the line opening, the letters out of the blur, all in, going out)
    for (const [ms, name] of [
      [900, "E1-0a-studio-ligne"],
      [1400, "E1-0b-studio-lettres"],
      [2100, "E1-0c-studio"],
      [2950, "E1-0d-studio-sortie"],
    ] as const) {
      await at(ms);
      await shot(name);
      if (ms === 2100) expect(await opacity(".in-studio-name i:nth-child(1)")).toBeGreaterThan(0.9);
    }
    expect(await opacity(".in-name i")).toBe(0);
    await at(4300);
    await shot("E1-2-nom");
    expect(await opacity(".in-studio")).toBe(0);
    expect(await opacity(".in-name i:nth-child(4)")).toBeGreaterThan(0.9);
    await at(5900);
    await shot("E1-3-logo");
    // (the Worker drew the background; the orb follows the boot — the graphics held: still before the image)
    await app.waitFor(`!!document.querySelector("#loading").dataset.bg`, 10_000).catch(() => {});
    await at(7600);
    await shot("E1-4-titre");
    // (__bh not there yet — the graphics held: the intro's element says where it stands)
    const s = await app.js<{ bg: string; orb: string; docked: string; done: boolean }>(
      `(() => { const l = document.querySelector("#loading"); return { ...l.dataset, done: l.classList.contains("done") }; })()`,
    );
    console.log(`  at 7.6 s: ${JSON.stringify(s)}`);
    expect(s.bg).toBe("webgl2");
    expect(["solving", "weaving", "searching", "connecting"]).toContain(s.orb);
    // (the sequence over; the title not built yet — it waits for the graphics in E1 —: the name stays, centred)
    expect(await app.js<boolean>(`!document.body.classList.contains("intro-play")`)).toBe(true);
    expect(s.docked === undefined && !s.done).toBe(true);
    // (a click on the orb: the loading's detail)
    await app.js(`(document.querySelector(".in-orb-btn").click(), true)`);
    expect(await app.js<boolean>(`!document.querySelector(".in-steps").hidden`)).toBe(true);
    await shot("E1-5-detail");
    await app.js(`(document.querySelector(".in-orb-btn").click(), true)`);
    // (the title opens: the name glides onto its logo, the title over the intro's background)
    await app.waitFor(`!!document.querySelector("[data-testid=title]")`, 60_000);
    await app.waitFor(`document.querySelector("#loading")?.dataset.docked === "1"`, 3000);
    await Bun.sleep(300);
    await shot("E1-6-titre-fond");
    expect(await opacity(".ts-root")).toBeGreaterThan(0.9);
    // (lifted once the first image and the sky are in: not before)
    await app.waitFor(`__bh.intro().lifted && __bh.boot().marks.some((m) => m.name === "splash-lifted")`, 90_000);
    const b = await app.js<{ marks: { name: string; t: number }[]; firstImage: number }>("__bh.boot()");
    const mark = (n: string) => b.marks.find((m) => m.name === n)?.t ?? Number.NaN;
    console.log(`  first image ${b.firstImage} · sky ${mark("sky done")} · lifted ${mark("splash-lifted")} ms`);
    expect(mark("splash-lifted")).toBeGreaterThan(b.firstImage);
    expect(mark("splash-lifted")).toBeGreaterThan(mark("sky done"));
    await app.waitFor(`!document.querySelector("#loading")`, 5000);
    await Bun.sleep(400);
    await shot("E1-7-scene");
  }, 180_000);

  test("a key passes it: the title at once", async () => {
    await open({ full: true, slow: 8 });
    await at(1200);
    await app.press("Space", " ");
    await app.waitFor(`document.querySelector("#loading").classList.contains("skip")`, 2000);
    expect(await app.js<boolean>(`document.querySelector("#loading").classList.contains("skip")`)).toBe(true);
    await app.waitFor(`!document.body.classList.contains("intro-play")`, 2000);
    await Bun.sleep(500);
    await shot("E1-8-passee");
    expect(await app.js<string>(`getComputedStyle(document.querySelector(".in-studio")).display`)).toBe("none");
  }, 120_000);

  test("seen: the short version the next time, lifted soon after the first image", async () => {
    await open({ full: false });
    expect(await app.js<string>("document.documentElement.className")).toContain("intro-short");
    await app.waitFor(`typeof __bh !== "undefined" && __bh.intro().ended`, 30_000);
    const ended = await app.js<number>("performance.now()");
    expect(ended).toBeLessThan(8000);
    await app.waitFor(`__bh.intro().lifted`, 60_000);
    expect(app.cdp.errors).toEqual([]);
  }, 120_000);
});
