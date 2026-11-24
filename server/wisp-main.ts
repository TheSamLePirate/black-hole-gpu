// Standalone Production Wisp v1 WebSocket-to-TCP Relay for the Linux OBC (wss://code.samlepirate.org/).
// Runs inside the Portainer `kerr` stack (deploy/compose.yml, service `wisp`, port 3002) using the same
// Bun image as `rooms` (deploy/Dockerfile.rooms), behind Nginx Proxy Manager (TLS + WebSockets Support).
//
// Endpoints:
//   GET /health   → JSON health & counters (CORS open, used by Docker HEALTHCHECK & monitoring)
//   WS  / or /wisp → Wisp v1 binary protocol (CONNECT / DATA / CONTINUE / CLOSE)
//
// Environment (docs/DEPLOY.md, "The Linux OBC Wisp v1 relay"):
//   PORT                       listening port (3002)
//   WISP_MAX_CLIENTS           WebSocket clients at once (64, at most 256)
//   WISP_MAX_PER_IP            WebSocket clients per client IP (12, at most 32)
//   WISP_ORIGINS               extra allowed Origins, comma-separated (the site's own are built in); an upgrade without an
//                              allowed Origin is refused (403)
//   WISP_TCP_PORTS             destination TCP ports allowed (80,443,9418); 25/465/587/2525 always refused
//   WISP_UDP_PORTS             destination UDP ports allowed (53; empty: no UDP)
//   WISP_IP_BYTES_PER_SEC      bytes/s per client IP, both directions (4 MiB/s; 0: no cap)
//   WISP_GLOBAL_BYTES_PER_SEC  bytes/s for the whole relay (24 MiB/s; 0: no cap)
//   WISP_IP_CONNECTS_PER_SEC   stream CONNECTs/s per client IP (20)
//   TRUSTED_PROXIES            peers whose X-Real-IP / X-Forwarded-For are believed (server/address.ts; default loopback +
//                              private ranges, `none` for no one)

import { clientAddress } from "./address";
import { defaultOrigin } from "./rooms";
import {
  WISP_LIMITS,
  wispClose,
  wispDrain,
  wispMessage,
  wispOpen,
  wispPolicyFromEnv,
  wispStats,
  wispUpgrade,
} from "./wisp-relay";

const port = Number(process.env.PORT ?? 3002);
const build = process.env.BUILD_SHA ?? "dev";
const maxClients = Math.max(1, Math.min(256, Number(process.env.WISP_MAX_CLIENTS ?? WISP_LIMITS.maxClients) || WISP_LIMITS.maxClients));
const maxPerIp = Math.max(1, Math.min(32, Number(process.env.WISP_MAX_PER_IP ?? 12) || 12));

const policy = wispPolicyFromEnv();

const extraOrigins = (process.env.WISP_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const allowOrigin = (o: string): boolean => {
  if (defaultOrigin(o)) return true;
  try {
    const u = new URL(o);
    if (u.protocol === "https:" && (u.hostname === "samlepirate.org" || u.hostname.endsWith(".samlepirate.org"))) return true;
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
        policy,
      });
    }
    return new Response("Kerr Linux OBC Wisp v1 relay — wss://code.samlepirate.org/\n", {
      headers: { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*" },
    });
  },
  websocket: {
    open: (ws) => wispOpen(ws),
    message: (ws, msg) => wispMessage(ws, msg),
    drain: (ws) => wispDrain(ws),
    close: (ws) => wispClose(ws),
    backpressureLimit: 8 * 1024 * 1024,
    closeOnBackpressureLimit: false,
    // (a client packet is at most 64 KiB — unkernel's MAX_PACKET — plus its 5-byte header)
    maxPayloadLength: 128 * 1024,
    idleTimeout: 120,
    sendPings: true,
  },
});

const stop = () => {
  server.stop(true);
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
console.log(
  `wisp ${build} → ${server.url} (maxClients=${maxClients}, maxPerIp=${maxPerIp}, tcp=${[...policy.tcpPorts].join(",")}, ` +
    `udp=${[...policy.udpPorts].join(",") || "off"}, ip=${policy.ipBytesPerSec} B/s, global=${policy.globalBytesPerSec} B/s)`,
);
