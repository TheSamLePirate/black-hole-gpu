import { expect, test } from "bun:test";
import { earRelayRefusal } from "../server/ear-relay";

// The dev server's relay to Deepgram, its door (server/ear-relay.ts; audit TA-14): the key of .env spent only by this server's own
// pages. Before 13 Nov 2026 a connection with no Origin — a script, any machine of the local network or the Tailscale — was let in.

const up = (headers: Record<string, string>) =>
  new Request("http://kerr.local:3000/__deepgram?model=nova-3", { headers: { upgrade: "websocket", ...headers } });

test("the page's own origin let in; another's refused; none — not a browser's page — refused", () => {
  expect(earRelayRefusal(up({ origin: "http://kerr.local:3000" }))).toBeNull();
  expect(earRelayRefusal(up({ origin: "http://evil.example" }))?.status).toBe(403);
  expect(earRelayRefusal(up({}))?.status).toBe(403);
});

test("a few at once: past four open, refused until one closes", async () => {
  const { earOpened, earClosed, EAR_LIMITS } = await import("../server/ear-relay");
  for (let i = 0; i < EAR_LIMITS.open; i++) earOpened();
  expect(earRelayRefusal(up({ origin: "http://kerr.local:3000" }))?.status).toBe(429);
  earClosed();
  expect(earRelayRefusal(up({ origin: "http://kerr.local:3000" }))).toBeNull();
  for (let i = 0; i < EAR_LIMITS.open; i++) earClosed();
});

test("the queue before Deepgram opens: bounded", async () => {
  const { queueFits, EAR_LIMITS } = await import("../server/ear-relay");
  const chunk = new Uint8Array(1 << 20);
  const q: Uint8Array[] = [];
  while (queueFits(q, chunk)) q.push(chunk);
  expect(q.length).toBe(Math.floor(EAR_LIMITS.queueBytes / chunk.byteLength));
});
