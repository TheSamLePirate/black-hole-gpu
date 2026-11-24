// Cross-origin isolation for the Linux OBC's multi-CPU (docs/PLAN-LINUX-OBC.md §2, docs/DEPLOY.md).
//
// Unkernel runs more than one vCPU (SMP) only with SharedArrayBuffer, which a browser gives a page only when it is
// cross-origin isolated: served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy:
// credentialless` (credentialless, not require-corp: the tiles of IGN, OSM, swisstopo… are fetched with CORS and keep
// working). Isolation has costs for the rest of the game — a popup to another site (the OpenRouter sign-in) loses its
// link to the page, a cross-origin frame would need its own COEP — so it is only asked for by a player who uses the
// OBC: the `kerr_coi` cookie, read by every server of the page (nginx's map, the dev server, the Service Worker on
// GitHub Pages) at the next load.
//   - absent: not isolated; the first boot of the OBC with more than one vCPU asks for it (from the next load on);
//   - "1": isolated; "0": the player turned it off (never set again by itself).

export const COI_COOKIE = "kerr_coi";

/** The cookie's value in a Cookie header (or `document.cookie`): "1", "0" or null (absent). */
export function coiCookieValue(cookieHeader: string | null | undefined): "1" | "0" | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === COI_COOKIE) return v === "1" ? "1" : v === "0" ? "0" : null;
  }
  return null;
}

/**
 * Whether a page's response is served cross-origin isolated: the player's cookie, unless the server forces it
 * (`force`: the dev server's KERR_COI=1 / =0, or the older KERR_NO_COI=1 for off).
 */
export function coiWanted(cookieHeader: string | null | undefined, force?: "1" | "0" | null): boolean {
  if (force === "1") return true;
  if (force === "0") return false;
  return coiCookieValue(cookieHeader) === "1";
}

/** The two headers of an isolated page. */
export const COI_HEADERS: readonly [string, string][] = [
  ["Cross-Origin-Opener-Policy", "same-origin"],
  ["Cross-Origin-Embedder-Policy", "credentialless"],
];

/** A page's response with its isolation headers set (`on`) or removed — the rest as it was. */
export function withCoi(res: Response, on: boolean): Response {
  const has = res.headers.has("cross-origin-opener-policy") || res.headers.has("cross-origin-embedder-policy");
  if (!on && !has) return res;
  const headers = new Headers(res.headers);
  for (const [k, v] of COI_HEADERS) {
    if (on) headers.set(k, v);
    else headers.delete(k);
  }
  // (the same URL with or without isolation: a cache keeps the two apart)
  const vary = headers.get("vary");
  if (!vary) headers.set("vary", "Cookie");
  else if (!/\bcookie\b/i.test(vary)) headers.set("vary", `${vary}, Cookie`);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// ---- in the page

function readCookie(): string {
  try {
    return typeof document !== "undefined" ? document.cookie : "";
  } catch {
    return "";
  }
}

/** The page's isolation: on now, asked for (from the next load), and whether the player turned it off. */
export function isolationState(): { isolated: boolean; wanted: boolean; refused: boolean } {
  const v = coiCookieValue(readCookie());
  const isolated = typeof crossOriginIsolated === "boolean" ? crossOriginIsolated : false;
  return { isolated, wanted: v === "1", refused: v === "0" };
}

/** The player's choice (Settings of the OBC's machine manager): isolated from the next load on, or not. */
export function setIsolationWanted(on: boolean) {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  try {
    document.cookie = `${COI_COOKIE}=${on ? "1" : "0"}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  } catch {}
}

/**
 * The OBC booted with more than one vCPU in a page not isolated: isolation asked for from the next load — once,
 * and never against the player's "no".
 */
export function askIsolationForSmp(cpus: number): boolean {
  if (cpus <= 1) return false;
  const st = isolationState();
  if (st.isolated || st.wanted || st.refused) return false;
  setIsolationWanted(true);
  return true;
}
