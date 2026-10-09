import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-TARS T6: TARS through OpenRouter, the network simulated in the page (openrouter.ai's three endpoints):
// a key pasted in his field (real clicks and typing) — kept, hinted, never in an export of the settings —; a
// question answered by "GLM", the session's cost shown; "Sign in with OpenRouter": the popup's callback (its
// postMessage) exchanged for a key; disconnected: his written lines again.

describe.skipIf(!E2E)("TARS through OpenRouter", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 30_000);
    await app.js(`(() => {
      __bh.settings.voice = false;
      window.__or = [];
      const real = window.fetch.bind(window);
      window.fetch = async (url, init) => {
        const u = String(url);
        if (!u.startsWith("https://openrouter.ai/")) return real(url, init);
        const body = init?.body ? JSON.parse(init.body) : null;
        window.__or.push({ u, body, auth: init?.headers?.Authorization ?? null });
        if (u.endsWith("/api/v1/chat/completions")) return Response.json({ choices: [{ message: { content: "Four hundred kilometres up, as advertised." } }], usage: { cost: 0.000031 } });
        if (u.endsWith("/api/alpha/decisions")) return Response.json({ answers: { speak: { type: "noul", noul: 0.1 } }, usage: { cost: 0.00001 } });
        if (u.endsWith("/api/v1/auth/keys")) return Response.json({ key: "sk-or-v1-fromoauthcode0001" });
        return new Response("?", { status: 404 });
      };
      return true;
    })()`);
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("a key pasted; a question answered by GLM, its cost shown; the key in no export", async () => {
    await app.press("F6", "F6");
    await app.click("[data-testid=tars-paste]");
    await app.type("sk-or-v1-pastedkey00000042");
    await app.press("Enter");
    expect(await app.js<string>(`document.querySelector("[data-testid=tars-link]").textContent`)).toContain("…0042");
    await app.type("How high are we?");
    await app.press("Enter");
    await app.waitFor(`document.querySelector(".tp-tars")?.textContent === "Four hundred kilometres up, as advertised."`, 8_000);
    const req = await app.js<{ auth: string; model: string; sys: string; user: string }>(
      `(() => { const r = window.__or.find((x) => x.u.endsWith("/chat/completions")); return { auth: r.auth, model: r.body.model, sys: r.body.messages[0].content, user: r.body.messages.at(-1).content }; })()`,
    );
    expect(req.auth).toBe("Bearer sk-or-v1-pastedkey00000042");
    expect(req.model).toBe("z-ai/glm-5.3-flash");
    expect(req.sys).toContain("You are TARS");
    expect(req.user).toContain("Pilot: How high are we?");
    expect(req.user).toContain('"stage"');
    await app.waitFor(`document.querySelector("[data-testid=tars-link]").textContent.includes("0.0000")`, 3_000);
    // (the settings exported: no key in them)
    expect(await app.js<string>(`JSON.stringify(__bh.settings)`)).not.toContain("sk-or-");
    await app.click("[data-testid=tars-disconnect]");
    expect(await app.js<boolean>(`!!document.querySelector("[data-testid=tars-connect]")`)).toBe(true);
  }, 60_000);

  test("Sign in with OpenRouter: the popup's callback exchanged for a key", async () => {
    // (the popup stood in for: open() returns a window that stays open; the callback page's postMessage sent)
    await app.js(`(window.open = (u) => { window.__authUrl = u; return { closed: false }; }, true)`);
    await app.click("[data-testid=tars-connect]");
    await app.waitFor(`!!window.__authUrl`, 3_000);
    expect(await app.js<string>(`new URL(window.__authUrl).searchParams.get("callback_url")`)).toMatch(/\/openrouter\.html$/);
    await app.js(`(window.postMessage({ type: "kerr-openrouter", code: "THECODE" }, location.origin), true)`);
    await app.waitFor(`document.querySelector("[data-testid=tars-link]").textContent.includes("…0001")`, 5_000);
    const ex = await app.js<{ code: string; verifier: string }>(
      `(() => { const r = window.__or.find((x) => x.u.endsWith("/auth/keys")); return { code: r.body.code, verifier: r.body.code_verifier }; })()`,
    );
    expect(ex.code).toBe("THECODE");
    expect(ex.verifier).toMatch(/^[\w-]{43}$/);
    await app.click("[data-testid=tars-disconnect]");
  }, 30_000);
});
