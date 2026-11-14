// A client's address behind the proxy (Nginx Proxy Manager sets X-Real-IP): that header, else the last X-Forwarded-For hop, else the
// socket's. The rooms' quotas count by it (RD2) and the traffic relay's pace too — before 13 Nov 2026 the relay took the socket's
// address, the proxy's: every player shared one pace (audit QA-21). Trusted as the proxy's word: the server is meant to be
// reached through it (the port published in clear is NET-31's, for its owner).

export function clientAddress(req: Request, server: unknown): string {
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ??
    (server as { requestIP?: (r: Request) => { address: string } | null }).requestIP?.(req)?.address ??
    ""
  );
}
