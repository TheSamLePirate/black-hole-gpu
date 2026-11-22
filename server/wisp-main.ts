// Standalone Production Wisp v1 WebSocket-to-TCP Relay for the Linux OBC (wss://code.samlepirate.org/).
// Runs inside the Portainer `kerr` stack (deploy/compose.yml, service `wisp`, port 3002) using the same
// Bun image as `rooms` (deploy/Dockerfile.rooms), behind Nginx Proxy Manager (TLS + WebSockets Support).
//
// Endpoints:
//   GET /health   → JSON health & counters (CORS open, used by Docker HEALTHCHECK & monitoring)
//   WS  / or /wisp → Wisp v1 binary protocol (CONNECT / DATA / CONTINUE / CLOSE)

import { clientAddress } from "./address";
import { defaultOrigin } from "./rooms";
import { WISP_LIMITS, wispClose, wispMessage, wispOpen, wispStats, wispUpgrade } from "./wisp-relay";

const port = Number(process.env.PORT ?? 3002);
const build = process.env.BUILD_SHA ?? "dev";
const maxClients = Math.max(1, Math.min(256, Number(process.env.WISP_MAX_CLIENTS ?? WISP_LIMITS.maxClients) || WISP_LIMITS.maxClients));
const maxPerIp = Math.max(1, Math.min(32, Number(process.env.WISP_MAX_PER_IP ?? 8) || 8));

const extraOrigins = (process.env.WISP_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const allowOrigin = (o: string): boolean => {
  if (defaultOrigin(o)) return true;
  try {
    const u = new URL(o);
    if (u.origin === "https://code.samlepirate.org") return true;
    return extraOrigins.includes(u.origin);
  } catch {
    return false;
  }
};

const server = Bun.serve<unknown>({
  port,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json(
        { ok: true, protocol: "wisp/1", build, maxClients, ...wispStats() },
        { headers: { "access-control-allow-origin": "*" } },
      );
    }
    if (url.pathname === "/version") {
      return Response.json({ build, service: "wisp" }, { headers: { "access-control-allow-origin": "*" } });
    }
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      return wispUpgrade(req, srv, {
        enabled: true,
        maxClients,
        maxClientsPerIp: maxPerIp,
        clientIp: clientAddress(req, srv),
        allowOrigin,
      });
    }
    return new Response("Kerr Linux OBC Wisp v1 relay — wss://code.samlepirate.org/\n", {
      headers: { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*" },
    });
  },
  websocket: {
    open: (ws) => wispOpen(ws),
    message: (ws, msg) => wispMessage(ws, msg),
    close: (ws) => wispClose(ws),
    maxPayloadLength: 256 * 1024,
    idleTimeout: 120,
  },
});

const stop = () => {
  server.stop(true);
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
console.log(`wisp ${build} → ${server.url} (maxClients=${maxClients}, maxPerIp=${maxPerIp})`);
