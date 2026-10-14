// The room server on its own (deploy/Dockerfile.rooms → stream.samlepirate.org): the rooms over a WebSocket
// at any path, /health and /version; SQLite in $DATA; stopped cleanly (the rooms written) on SIGTERM.

import { createRooms, defaultOrigin } from "./rooms";

const port = Number(process.env.PORT ?? 3001);
const dir = process.env.DATA ?? "./data";
await Bun.$`mkdir -p ${dir}`.quiet();
const build = process.env.BUILD_SHA ?? "dev";
const rooms = createRooms({ db: `${dir}/rooms.sqlite`, build, origin: defaultOrigin });

const server = Bun.serve({
  port,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return Response.json(rooms.health(), { headers: { "access-control-allow-origin": "*" } });
    if (url.pathname === "/version") return Response.json({ build }, { headers: { "access-control-allow-origin": "*" } });
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") return rooms.upgrade(req, srv);
    return new Response("Kerr room server — https://samlepirate.org", { headers: { "content-type": "text/plain" } });
  },
  websocket: { ...rooms.websocket, maxPayloadLength: 65_536, idleTimeout: 60 },
});

const stop = () => {
  rooms.close();
  server.stop(true);
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
console.log(`rooms ${build} → ${server.url}`);
