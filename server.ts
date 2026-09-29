import index from "./index.html";

const port = Number(process.env.PORT ?? 3000);
const dev = process.env.NODE_ENV !== "production";

const server = Bun.serve({
  port,
  routes: {
    "/": index,
    // Dev only: the page can POST a rendered PNG here (window.__bh.snapshot()) for offline inspection.
    "/__snapshot": {
      POST: async (req) => {
        if (!dev) return new Response("disabled", { status: 404 });
        const name = new URL(req.url).searchParams.get("name")?.replace(/[^\w.-]/g, "") || "snapshot";
        const file = /\.(png|jpg|webp|exr|json|mp4)$/.test(name) ? name : `${name}.png`;
        await Bun.write(`snapshots/${file}`, await req.arrayBuffer());
        return new Response("ok");
      },
    },
    // The flight planner's worker, bundled on its own (the pages build writes it next to the page)
    "/plan-worker.js": async () => {
      const r = await Bun.build({ entrypoints: ["./src/system/plan-worker.ts"], target: "browser", minify: !dev });
      if (!r.success) return new Response(r.logs.join("\n"), { status: 500 });
      return new Response(await r.outputs[0]!.text(), { headers: { "content-type": "text/javascript" } });
    },
    // The KTX2 transcoder's worker and its WebAssembly (vendor/basis)
    "/ktx-worker.js": async () => {
      const r = await Bun.build({ entrypoints: ["./src/system/ktx-worker.ts"], target: "browser", minify: !dev });
      if (!r.success) return new Response(r.logs.join("\n"), { status: 500 });
      return new Response(await r.outputs[0]!.text(), { headers: { "content-type": "text/javascript" } });
    },
    "/basis_transcoder.wasm": () => new Response(Bun.file("vendor/basis/basis_transcoder.wasm"), { headers: { "content-type": "application/wasm" } }),
    // Dev only: read back files from snapshots/ (e.g. reference data for the precision probe).
    "/__snapshots/:name": {
      GET: (req) => {
        const file = Bun.file(`snapshots/${req.params.name.replace(/[^\w.-]/g, "")}`);
        return dev ? new Response(file) : new Response("disabled", { status: 404 });
      },
    },
  },
  development: dev && { hmr: true, console: true },
});

console.log(`Black hole simulator → ${server.url}`);
