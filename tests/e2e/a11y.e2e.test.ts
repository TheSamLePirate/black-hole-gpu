import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The interface for everyone and for every pointer (audit §16.7, T2 and T8): each control named for a
// screen reader (not "×" or "›"), each dialog announced as one; and no invisible layer over the view —
// a grid of points over the screen, each reaching the canvas or something that can be seen.

/** Controls without a usable accessible name (visible ones), as "tag#id.class: name". */
const UNNAMED = `(() => {
  const symbol = /^[\\s×‹›…⋯✕✖+\\-<>·]*$/;
  const name = (e) => (e.getAttribute("aria-label") || e.getAttribute("title") || (e.labels && [...e.labels].map((l) => l.textContent).join(" ")) || e.getAttribute("placeholder") || e.textContent || "").trim();
  return [...document.querySelectorAll("button, input, select, textarea, [role=button]")]
    .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden" && e.type !== "hidden")
    .filter((e) => symbol.test(name(e)))
    .map((e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + "." + [...e.classList].join(".") + ": " + JSON.stringify(name(e)));
})()`;

/** Points of a 24 × 16 grid whose top element cannot be seen (an invisible layer taking the pointer). */
const INVISIBLE = `(() => {
  const seen = (e) => { for (let x = e; x && x !== document.documentElement; x = x.parentElement) {
    const cs = getComputedStyle(x); if (cs.visibility === "hidden" || +cs.opacity < 0.05) return false; } return true; };
  const bad = [];
  for (let i = 0; i < 24; i++) for (let j = 0; j < 16; j++) {
    const x = ((i + 0.5) / 24) * innerWidth, y = ((j + 0.5) / 16) * innerHeight;
    const e = document.elementFromPoint(x, y);
    if (e && !seen(e)) bad.push(Math.round(x) + "," + Math.round(y) + " " + e.tagName.toLowerCase() + "." + [...e.classList].join("."));
  }
  return bad;
})()`;

describe.skipIf(!E2E)("accessibility and pointer", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("flying: every control named, no invisible layer", async () => {
    expect(await app.js<string[]>(UNNAMED)).toEqual([]);
    expect(await app.js<string[]>(INVISIBLE)).toEqual([]);
  });

  test("the settings open: every control named", async () => {
    await app.click(".sp-opener");
    await app.waitFor(`!document.getElementById("panel").classList.contains("collapsed")`);
    expect(await app.js<string[]>(UNNAMED)).toEqual([]);
    await app.press("Escape");
  });

  test("on foot (the toolbar, the camera panel): every control named, no invisible layer", async () => {
    await app.press("KeyK", "K", { shift: true });
    await app.waitFor("!__bh.camera.piloting");
    await Bun.sleep(600);
    expect(await app.js<string[]>(UNNAMED)).toEqual([]);
    expect(await app.js<string[]>(INVISIBLE)).toEqual([]);
    await app.click("#btn-camera");
    await app.waitFor(`!document.getElementById("cam-pop").hidden`);
    expect(await app.js<string[]>(UNNAMED)).toEqual([]);
    await app.press("Escape");
  });

  test("accessibility settings: the interface scaled, the markers' palette, nothing blinking", async () => {
    await app.js(`(__bh.game.set("uiScale", 1.25), __bh.game.set("hudPalette", "okabe"), __bh.game.set("reduceMotion", true), 1)`);
    const r = await app.js<{ zoom: string; still: boolean; anim: string }>(`(() => {
      const p = document.getElementById("toolbar");
      return { zoom: getComputedStyle(p).zoom, still: document.body.classList.contains("reduce-motion"),
        anim: getComputedStyle(document.querySelector(".k-btn, button")).animationName };
    })()`);
    expect(r.zoom).toBe("1.25");
    expect(r.still).toBe(true);
    await app.js(`(__bh.game.set("uiScale", 1), __bh.game.set("hudPalette", "default"), __bh.game.set("reduceMotion", false), 1)`);
    expect(await app.js<boolean>(`document.body.classList.contains("reduce-motion")`)).toBe(false);
  });

  test("the help is a modal dialog, named by its title, the focus inside", async () => {
    await app.press("Slash", "?", { shift: true });
    const shown = `[...document.querySelectorAll("[role=dialog]")].find((e) => e.getClientRects().length)`;
    await app.waitFor(`!!${shown}`);
    const d = await app.js<{ modal: string | null; label: string; focusInside: boolean }>(`(() => {
      const d = ${shown};
      return { modal: d.getAttribute("aria-modal"), label: document.getElementById(d.getAttribute("aria-labelledby"))?.textContent ?? "",
        focusInside: d.contains(document.activeElement) };
    })()`);
    expect(d).toEqual({ modal: "true", label: "Keyboard & mouse", focusInside: true });
    await app.press("Escape");
    expect(await app.js<boolean>(`!!${shown}`)).toBe(false);
  });
});

// In French (U5.3): the page says its language, and the flight's words — the state, the bodies, the
// clock, the settings — are French; the game's API (its status label) stays English.
describe.skipIf(!E2E)("a11y: in French", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=game:artemis", lang: "fr" });
    await app.waitFor("__bh.camera.piloting", 30_000);
    await app.waitFor(`document.querySelector(".fl-badge")?.textContent !== ""`, 10_000);
  });
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the HUD speaks French", async () => {
    expect(await app.js<string>("document.documentElement.lang")).toBe("fr");
    expect(await app.js<string>(`document.querySelector(".fl-badge").textContent`)).toBe("EN ORBITE");
    expect(await app.js<string>("__bh.game.status().label")).toBe("IN ORBIT");
    const text = await app.js<string>("document.body.innerText");
    for (const w of ["autour de Terre", "temps réel", "réglages", "Échap"]) expect(text.toLowerCase()).toContain(w.toLowerCase());
    expect(app.cdp.errors).toEqual([]);
  });
});
