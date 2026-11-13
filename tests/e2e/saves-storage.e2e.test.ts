import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// Saved games in a real browser's storage (audit 2026-11-10, AR-19/AR-20; wave 3.3): a player's saves kept the old way
// (every save in one key, `kerr.saves`) are found and moved one per key at the first visit, nothing lost; an unreadable
// one is not listed but kept; in the pause's Save screen a name already taken is refused (said), Overwrite replaces it;
// F5 twice replaces the quick save. Tiles blocked: nothing here depends on the ground.
// Done when: the moved saves listed, the refusal told and the old save intact, Overwrite and F5 taking. Duration: ~1 min.

const OUT = "remote-results/saves-storage";
const state = (name: string) => Bun.file(`${import.meta.dir}/../hud/states/${name}.json`).json();

describe.skipIf(!E2E)("saved games: one key per save, never replaced in silence", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    const a = { ...(await state("02-circ")), name: "Orbit A" };
    const b = { ...(await state("07-rollout")), name: "Rollout B" };
    // (the storage as a player has it before 13 Nov 2026: one key, two saves; and one save's text broken)
    const seed = `try { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1");
      localStorage.setItem("kerr.saves", ${JSON.stringify(JSON.stringify({ "Orbit A": a, "Rollout B": b }))});
      localStorage.setItem("kerr.save:Broken", "{broken"); } } catch {}`;
    app = await App.boot({ hash: "scene=game:artemis", initScript: seed });
    await app.waitFor("__bh.camera.piloting", 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });
  const keys = () => app.js<string[]>(`Object.keys(localStorage).filter((k) => /^kerr\\.(save|saves|kept)/.test(k)).sort()`);

  test("the old single key: its saves listed and moved one per key; the broken one kept, not listed", async () => {
    const names = await app.js<string[]>(`__bh.game.saves().map((s) => s.name).sort()`);
    console.log(`  saves listed: ${names.join(" · ")}`);
    expect(names).toEqual(["Orbit A", "Rollout B"]);
    const k = await keys();
    console.log(`  keys: ${k.join(" · ")}`);
    expect(k).toContain("kerr.save:Orbit A");
    expect(k).toContain("kerr.save:Rollout B");
    expect(k).toContain("kerr.save:Broken");
    expect(k).not.toContain("kerr.saves");
  });

  test("the pause's Save: a name taken refused and said, the save intact; Overwrite replaces it", async () => {
    const before = await app.js<string>(`localStorage.getItem("kerr.save:Orbit A")`);
    await app.press("Escape");
    await app.waitFor(`!!document.querySelector("[data-testid=pause] [data-testid=pause-resume]")`, 5000);
    await app.click("[data-testid=pause-save]");
    await app.waitFor(`!!document.querySelector("[data-testid=pause-save-new]")`, 5000);
    await app.js(`(document.querySelector(".pz-sub input").focus(), true)`);
    await app.type("Orbit A");
    await app.click("[data-testid=pause-save-new]");
    const told = await app.waitFor(
      `[...document.querySelectorAll(".toast, .k-toast, [class*=toast]")].map((e) => e.textContent).find((t) => /already exists|existe déjà/.test(t ?? "")) ?? ""`,
      5000,
    );
    console.log(`  told: ${told}`);
    // (the name's field wide enough to read what was typed — it was squeezed to ~30 px by the button's width)
    const field = await app.js<number>(`document.querySelector(".pz-sub input").getBoundingClientRect().width`);
    console.log(`  name field: ${Math.round(field)} px`);
    expect(field).toBeGreaterThan(200);
    await Bun.sleep(400);
    await app.shot(`${OUT}/1-name-taken.png`);
    expect(await app.js<string>(`localStorage.getItem("kerr.save:Orbit A")`)).toBe(before);
    // (still on the Save screen: its rows' Overwrite)
    const rows = await app.js<string[]>(
      `[...document.querySelectorAll(".pz-saves .pz-save, .pz-saves > *")].map((r) => r.textContent ?? "")`,
    );
    const i = rows.findIndex((r) => r.includes("Orbit A"));
    expect(i).toBeGreaterThanOrEqual(0);
    await app.click(`.pz-saves > :nth-child(${i + 1}) [data-testid=pause-overwrite]`);
    await app.waitFor(`localStorage.getItem("kerr.save:Orbit A") !== ${JSON.stringify(before)}`, 5000);
    const after = await app.js<{ v: number; summary: string }>(`JSON.parse(localStorage.getItem("kerr.save:Orbit A"))`);
    console.log(`  overwritten: ${after.summary}`);
    await app.shot(`${OUT}/2-overwritten.png`);
    await app.waitFor(`!!document.querySelector("[data-testid=pause-resume]")`, 5000);
    await app.click("[data-testid=pause-resume]");
    await app.waitFor(`!document.querySelector("[data-testid=pause]")`, 5000);
  });

  test("F5 twice: the quick save replaced, the others untouched", async () => {
    const others = await app.js<string>(`localStorage.getItem("kerr.save:Rollout B")`);
    await app.press("F5");
    await app.waitFor(`!!localStorage.getItem("kerr.save:Quick save")`, 5000);
    const first = await app.js<number>(`JSON.parse(localStorage.getItem("kerr.save:Quick save")).savedAt`);
    await Bun.sleep(50);
    await app.press("F5");
    await app.waitFor(`JSON.parse(localStorage.getItem("kerr.save:Quick save")).savedAt > ${first}`, 5000);
    expect(await app.js<string>(`localStorage.getItem("kerr.save:Rollout B")`)).toBe(others);
    const k = await keys();
    console.log(`  keys at the end: ${k.join(" · ")}`);
    expect(k.filter((x) => x.startsWith("kerr.kept:"))).toEqual([]);
    expect(app.cdp.errors).toEqual([]);
  });
});
