// The room server on its own (deploy/Dockerfile.rooms → stream.samlepirate.org): the rooms over a WebSocket
// at any path, /health and /version; SQLite in $DATA; stopped cleanly (the rooms written) on SIGTERM.

import { createMoonTiles } from "./moon-tiles";
import { createRooms, defaultOrigin } from "./rooms";
import { createTraffic } from "./traffic";

const port = Number(process.env.PORT ?? 3001);
const dir = process.env.DATA ?? "./data";
await Bun.$`mkdir -p ${dir}`.quiet();
const build = process.env.BUILD_SHA ?? "dev";
// (the TURN relay: coturn's shared secret and its addresses, from the stack's environment — none: STUN alone)
const turn = process.env.TURN_SECRET
  ? { secret: process.env.TURN_SECRET, urls: (process.env.TURN_URLS ?? "turn:stream.samlepirate.org:3478?transport=udp,turn:stream.samlepirate.org:3478?transport=tcp").split(",") }
  : null;
const rooms = createRooms({ db: `${dir}/rooms.sqlite`, build, origin: defaultOrigin, turn });
// (the real traffic's relay — server/traffic.ts —: its keys in the stack's environment, none in a page)
const traffic = createTraffic({
  aisKey: process.env.AISSTREAM_API_KEY || undefined,
  openskyId: process.env.OPENSKY_CLIENT_ID || undefined,
  openskySecret: process.env.OPENSKY_CLIENT_SECRET || undefined,
  log: (m) => console.log(m),
});
// (the Moon's relief tiles — server/moon-tiles.ts —: built by the stack's moon-tiles service into their volume)
const moon = createMoonTiles(process.env.MOON_DIR ?? `${dir}/moon/lola`);

const server = Bun.serve({
  port,
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/traffic")) return (await traffic.handle(req, srv.requestIP(req)?.address)) ?? new Response(null, { status: 404 });
    if (url.pathname.startsWith("/svc/v1/moon/")) return (await moon.handle(url)) ?? new Response(null, { status: 404 });
    if (url.pathname === "/health") return Response.json(rooms.health(), { headers: { "access-control-allow-origin": "*" } });
    if (url.pathname === "/version") return Response.json({ build }, { headers: { "access-control-allow-origin": "*" } });
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") return rooms.upgrade(req, srv);
    return new Response("Kerr room server — https://samlepirate.org", { headers: { "content-type": "text/plain" } });
  },
  websocket: { ...rooms.websocket, maxPayloadLength: 65_536, idleTimeout: 60 },
});

const stop = () => {
  rooms.close();
  traffic.close();
  server.stop(true);
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
console.log(`rooms ${build} → ${server.url}`);
