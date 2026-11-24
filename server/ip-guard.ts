// Address guard for the relays that open sockets on a client's behalf (the OBC's Wisp relay, server/wisp-relay.ts; the
// client-address trust of server/address.ts). Every check is numeric, on the canonical address — never on the text a client
// sent: before 24 Nov 2026 `isBlockedHost` matched text prefixes, so `0:0:0:0:0:0:0:1`, `::0:1`, `0:0:0:0:0:ffff:7f00:1` or
// `0:0:0:0:0:ffff:a9fe:a9fe` (loopback, the cloud metadata service) went through, an IP literal skipping the resolver's check.
//
// - IPv4: special-purpose ranges of the IANA registry (RFC 6890 and successors) refused: this network, private, CGNAT, loopback,
//   link-local (metadata), IETF protocol assignments, documentation, benchmarking, 6to4 relay, multicast, reserved, broadcast.
// - IPv6: only global unicast (2000::/3) can pass, minus its special blocks (IETF 2001::/23 — Teredo, ORCHID, benchmarking —,
//   documentation, 6to4). Everything else (::, ::1, IPv4-mapped ::ffff:0:0/96, IPv4-compatible ::/96, NAT64 64:ff9b::/96 and
//   64:ff9b:1::/48, discard 100::/64, ULA fc00::/7, link-local fe80::/10, site-local fec0::/10, multicast ff00::/8) is refused.
// - Legacy numeric IPv4 forms a resolver or a URL parser would accept (`2130706433`, `127.1`, `0x7f.1`, `0177.0.0.1`): refused
//   outright — no legitimate client writes them, and their meaning differs between parsers. A host name whose last label is
//   numeric is read as such a form (the WHATWG URL rule).
// - Zoned IPv6 (`fe80::1%eth0`) refused.

import net from "node:net";

/** A host as written by a client, classified. */
export type HostLiteral =
  | { kind: "ipv4"; value: number; text: string }
  | { kind: "ipv6"; value: bigint; text: string }
  /** A numeric form that is not a canonical dotted quad (refused). */
  | { kind: "numeric"; text: string }
  | { kind: "name"; text: string };

/** A canonical dotted-quad IPv4 (four decimal labels 0–255, no leading zeros) → its 32-bit value, else null. */
export function parseIpv4(s: string): number | null {
  const m = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/.exec(s);
  if (!m) return null;
  return ((Number(m[1]) << 24) | (Number(m[2]) << 16) | (Number(m[3]) << 8) | Number(m[4])) >>> 0;
}

/** An IPv6 literal (no zone, optional embedded IPv4 tail) → its 128-bit value, else null. */
export function parseIpv6(s: string): bigint | null {
  if (!s || s.includes("%") || net.isIP(s) !== 6) return null;
  let text = s.toLowerCase();
  // (an embedded IPv4 tail → two hextets)
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) {
    const v4 = parseIpv4(tail[1]!);
    if (v4 === null) return null;
    text = `${text.slice(0, -tail[1]!.length)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : null;
  const groups = rest === null ? head : [...head, ...new Array(8 - head.length - rest.length).fill("0"), ...rest];
  if (groups.length !== 8) return null;
  let v = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    v = (v << 16n) | BigInt(Number.parseInt(g, 16));
  }
  return v;
}

/** Classify a host as a client wrote it (brackets and one trailing dot tolerated). */
export function classifyHost(host: string): HostLiteral {
  let h = host.trim().toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (h.includes(":")) {
    const v6 = parseIpv6(h);
    return v6 === null ? { kind: "numeric", text: h } : { kind: "ipv6", value: v6, text: h };
  }
  if (h.endsWith(".")) h = h.slice(0, -1);
  const v4 = parseIpv4(h);
  if (v4 !== null) return { kind: "ipv4", value: v4, text: h };
  // (the WHATWG URL rule: a last label that is a number makes the whole host an IPv4 attempt — `127.1`, `0x7f.1`, `2130706433`)
  const last = h.split(".").pop() ?? "";
  if (/^(0x[0-9a-f]*|\d+)$/.test(last)) return { kind: "numeric", text: h };
  return { kind: "name", text: h };
}

const V4_BLOCKED: readonly [number, number][] = (
  [
    ["0.0.0.0", 8], // this network
    ["10.0.0.0", 8], // private
    ["100.64.0.0", 10], // CGNAT
    ["127.0.0.0", 8], // loopback
    ["169.254.0.0", 16], // link-local, cloud metadata (169.254.169.254)
    ["172.16.0.0", 12], // private
    ["192.0.0.0", 24], // IETF protocol assignments
    ["192.0.2.0", 24], // TEST-NET-1
    ["192.88.99.0", 24], // 6to4 relay anycast
    ["192.168.0.0", 16], // private
    ["198.18.0.0", 15], // benchmarking
    ["198.51.100.0", 24], // TEST-NET-2
    ["203.0.113.0", 24], // TEST-NET-3
    ["224.0.0.0", 4], // multicast
    ["240.0.0.0", 4], // reserved, broadcast
  ] as const
).map(([a, bits]) => [parseIpv4(a)!, bits]);

/** Whether an IPv4 (32-bit value) is in a special-purpose range. */
export function isBlockedIpv4(v: number): boolean {
  for (const [base, bits] of V4_BLOCKED) {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if (((v & mask) >>> 0) === base) return true;
  }
  return false;
}

const V6_BLOCKED_IN_GLOBAL: readonly [bigint, number][] = (
  [
    ["2001::", 23], // IETF protocol assignments (Teredo 2001::/32, benchmarking, ORCHID)
    ["2001:db8::", 32], // documentation
    ["2002::", 16], // 6to4 (embeds an IPv4)
    ["3fff::", 20], // documentation (RFC 9637)
  ] as const
).map(([a, bits]) => [parseIpv6(a)!, bits]);

const inPrefix6 = (v: bigint, base: bigint, bits: number) => v >> BigInt(128 - bits) === base >> BigInt(128 - bits);

/** Whether an IPv6 (128-bit value) may NOT be reached: outside global unicast 2000::/3, or in one of its special blocks. */
export function isBlockedIpv6(v: bigint): boolean {
  if (!inPrefix6(v, 0x2000n << 112n, 3)) return true;
  return V6_BLOCKED_IN_GLOBAL.some(([base, bits]) => inPrefix6(v, base, bits));
}

/** Host names that never reach the public internet. */
export function isBlockedName(name: string): boolean {
  const h = name.toLowerCase().replace(/\.$/, "");
  if (!h || h.length > 253) return true;
  // (a single label — `metadata`, `rooms`, `kerr` — is a container's or the LAN's name, never a public host)
  if (!h.includes(".")) return true;
  if (!/^[a-z0-9_.-]+$/.test(h) || h.includes("..")) return true;
  return [".localhost", ".local", ".internal", ".home.arpa", ".lan", ".intranet", ".corp", ".private", ".localdomain"].some((s) =>
    h.endsWith(s),
  );
}

/**
 * Whether a host as written by a client is refused before any resolution: a special-purpose IP literal (any spelling), a
 * non-canonical numeric form, or a local name. A name that passes must still have each resolved address checked
 * (`isBlockedAddress`).
 */
export function isBlockedHost(host: string): boolean {
  const c = classifyHost(host);
  if (c.kind === "ipv4") return isBlockedIpv4(c.value);
  if (c.kind === "ipv6") return isBlockedIpv6(c.value);
  if (c.kind === "numeric") return true;
  return isBlockedName(c.text);
}

/** Whether a resolved address (as a resolver returns it) is refused; anything that is not a clean IP literal is. */
export function isBlockedAddress(address: string): boolean {
  const c = classifyHost(address);
  if (c.kind === "ipv4") return isBlockedIpv4(c.value);
  if (c.kind === "ipv6") return isBlockedIpv6(c.value);
  return true;
}

/** Whether an address is a loopback one (127/8, ::1) — the unit tests' upstream servers. */
export function isLoopbackAddress(address: string): boolean {
  const c = classifyHost(address);
  if (c.kind === "ipv4") return c.value >>> 24 === 127;
  if (c.kind === "ipv6") return c.value === 1n;
  return false;
}

/** A CIDR list (`10.0.0.0/8, ::1, 172.18.0.2`) → a matcher of addresses (IPv4-mapped IPv6 peers matched as IPv4). */
export function cidrMatcher(list: string): (address: string) => boolean {
  const v4: [number, number][] = [];
  const v6: [bigint, number][] = [];
  for (const raw of list.split(",")) {
    const item = raw.trim();
    if (!item) continue;
    const [addr, bitsText] = item.split("/");
    const c = classifyHost(addr ?? "");
    if (c.kind === "ipv4") {
      const bits = bitsText === undefined ? 32 : Number(bitsText);
      if (Number.isInteger(bits) && bits >= 0 && bits <= 32) v4.push([c.value, bits]);
    } else if (c.kind === "ipv6") {
      const bits = bitsText === undefined ? 128 : Number(bitsText);
      if (Number.isInteger(bits) && bits >= 0 && bits <= 128) v6.push([c.value, bits]);
    }
  }
  return (address: string) => {
    const c = classifyHost(address);
    let v4v: number | null = c.kind === "ipv4" ? c.value : null;
    if (c.kind === "ipv6" && c.value >> 32n === 0xffffn) v4v = Number(c.value & 0xffffffffn);
    if (v4v !== null) {
      return v4.some(([base, bits]) => {
        const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
        return ((v4v! & mask) >>> 0) === ((base & mask) >>> 0);
      });
    }
    if (c.kind === "ipv6") return v6.some(([base, bits]) => bits === 0 || inPrefix6(c.value, base, bits));
    return false;
  };
}
