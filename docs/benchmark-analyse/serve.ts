/**
 * Serveur local de l'outil d'analyse — `bun serve.ts` puis http://localhost:5177
 * Sert l'interface + les JSON de docs/bench-result-externes/ sans problème de CORS.
 * Watch mode : /api/watch renvoie une empreinte du dossier (mtime max) — l'app sonde
 * toutes les 4 s et recharge automatiquement quand un nouveau bench atterrit.
 */
import index from "./index.html";
import { statSync, existsSync } from "node:fs";

async function stamp(): Promise<string> {
  let s = "0";
  try {
    for (const f of (await Array.fromAsync(new Bun.Glob("kerr-bench-*.json").scan({ cwd: benchDir })))) {
      const m = statSync(benchDir + f).mtimeMs;
      if (m > Number(s)) s = String(m);
    }
  } catch { /* ignore */ }
  return s;
}

const benchDir = new URL("../bench-result-externes/", import.meta.url).pathname;

Bun.serve({
  port: 5177,
  routes: {
    "/": index,
    "/api/benchs": {
      GET: async () => {
        const files = (await Array.fromAsync(new Bun.Glob("kerr-bench-*.json").scan({ cwd: benchDir }))).sort();
        return Response.json(files);
      },
    },
    "/api/bench/:file": {
      GET: (req) => {
        const file = req.params.file;
        if (!/^[\w.\-]+\.json$/.test(file)) return new Response("bad name", { status: 400 });
        if (!existsSync(benchDir + file)) return new Response("not found", { status: 404 });
        return new Response(Bun.file(benchDir + file));
      },
    },
    "/api/watch": {
      GET: async () => Response.json({ stamp: await stamp(), at: new Date().toISOString() }),
    },
  },
  development: { hmr: true, console: true },
});

console.log("▶ Kerr-Bench analyse → http://localhost:5177");
