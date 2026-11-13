// The dev server's relay to Deepgram (TARS's ear and voice — server.ts): who it lets in, and for how long. The key of .env never
// leaves the server; spending it is for this server's own pages only (audit 2026-11-10, TA-14: a connection with no Origin — a
// script, any machine of the local network or the Tailscale — was let in, for as long as it liked, its queue unbounded).

export const EAR_LIMITS = {
  /** relays open at once */
  open: 4,
  /** a relay's life [s]: the ear's (a push-to-talk is seconds; a long dictation minutes), the voice's (a line) */
  listenS: 15 * 60,
  speakS: 2 * 60,
  /** what the page may send before Deepgram's side is open [bytes] */
  queueBytes: 4 << 20,
};

let openNow = 0;

/** Whether a WebSocket upgrade to the relay is let in: null — yes —, else the refusal to send. */
export function earRelayRefusal(req: Request): Response | null {
  const url = new URL(req.url);
  const origin = req.headers.get("origin");
  // (a browser's page always says where it comes from; none — a script — or another's: refused)
  if (!origin) return new Response("forbidden", { status: 403 });
  let host = "";
  try {
    host = new URL(origin).host;
  } catch {
    return new Response("forbidden", { status: 403 });
  }
  if (host !== url.host) return new Response("forbidden", { status: 403 });
  if (openNow >= EAR_LIMITS.open) return new Response("busy", { status: 429 });
  return null;
}

/** A relay opened, or closed (the count of those open). */
export const earOpened = () => ++openNow;
export const earClosed = () => (openNow = Math.max(0, openNow - 1));

/** The size of a message [bytes]. */
const bytesOf = (m: string | ArrayBuffer | Uint8Array) => (typeof m === "string" ? m.length * 2 : m.byteLength);

/** Whether a message still fits the queue kept before Deepgram's side opens. */
export function queueFits(queue: (string | ArrayBuffer | Uint8Array)[], m: string | ArrayBuffer | Uint8Array): boolean {
  let n = bytesOf(m);
  for (const q of queue) n += bytesOf(q);
  return n <= EAR_LIMITS.queueBytes;
}
