// A client's address behind the proxy (Nginx Proxy Manager sets X-Real-IP): that header, else the last X-Forwarded-For hop, else the
// socket's. The rooms' quotas count by it (RD2), the traffic relay's pace and the Wisp relay's per-IP caps too — before 13 Nov 2026
// the relay took the socket's address, the proxy's: every player shared one pace (audit QA-21).
//
// The headers are the proxy's word only when the socket's peer IS a trusted proxy (since 24 Nov 2026): the stack publishes its ports
// on the host (deploy/compose.yml: 3001, 3002), so a client reaching one directly could otherwise write any X-Real-IP and escape every
// per-IP cap. Trusted peers: `TRUSTED_PROXIES` (comma-separated addresses or CIDRs; `none` trusts no one), by default loopback and the
// private ranges — where Nginx Proxy Manager reaches the containers from (Docker's bridge, the LAN). A direct client from the internet
// is never in them; if the host's Docker runs the userland proxy (every published connection then seems to come from the bridge's
// gateway), set TRUSTED_PROXIES to the proxy's own address or keep the ports closed to the internet (docs/DEPLOY.md).

import { cidrMatcher } from "./ip-guard";

const DEFAULT_TRUSTED = "127.0.0.0/8, ::1, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7";

let trusted: (address: string) => boolean = makeTrusted(process.env.TRUSTED_PROXIES);

function makeTrusted(list: string | undefined): (address: string) => boolean {
  const l = (list ?? DEFAULT_TRUSTED).trim();
  if (l === "none") return () => false;
  return cidrMatcher(l || DEFAULT_TRUSTED);
}

/** Replace the trusted proxies (tests; the servers read TRUSTED_PROXIES at start). */
export function setTrustedProxies(list: string | undefined): void {
  trusted = makeTrusted(list);
}

export function clientAddress(req: Request, server: unknown): string {
  const peer = (server as { requestIP?: (r: Request) => { address: string } | null }).requestIP?.(req)?.address ?? "";
  if (peer && !trusted(peer)) return peer;
  return (
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ||
    peer
  );
}
