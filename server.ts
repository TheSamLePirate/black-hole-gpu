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
        const file = /\.(png|exr)$/.test(name) ? name : `${name}.png`;
        await Bun.write(`snapshots/${file}`, await req.arrayBuffer());
        return new Response("ok");
      },
    },
  },
  development: dev && { hmr: true, console: true },
});

console.log(`Black hole simulator → ${server.url}`);
