import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import dgram from "node:dgram";
import net from "node:net";
import { clientAddress, setTrustedProxies } from "../server/address";
import { classifyHost, isBlockedAddress, isBlockedHost } from "../src/util/ip-guard";
import {
  CLOSE_BLOCKED,
  CLOSE_THROTTLED,
  CLOSE_UNREACHABLE,
  DEFAULT_WISP_POLICY,
  decodeWispPacket,
  encodeConnect,
  encodeData,
  RateBucket,
  WISP_LIMITS,
  type WispPolicy,
  type WispResolver,
  type WispSession,
  wispClose,
  wispMessage,
  wispOpen,
  wispPolicyFromEnv,
  wispStats,
  wispUpgrade,
} from "../server/wisp-relay";

// The Wisp relay's security (review of 24 Nov 2026): each refusal has a positive witness (the attack is refused) next to a
// negative one (the same harness lets legitimate traffic through), so a refusal is the guard's, not a broken harness's.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, ms: number, what: string) {
  const t0 = performance.now();
  while (!pred()) {
    if (performance.now() - t0 > ms) throw new Error(`timeout (${ms} ms) waiting for ${what}`);
    await sleep(5);
  }
}

let ipSeq = 0;
/** A relay session driven in-process: the frames the relay sends to its client are captured. */
function relay(opts: { policy?: Partial<WispPolicy>; loopback?: boolean; resolver?: WispResolver; buffered?: () => number } = {}) {
  let data: unknown;
  const srv = {
    upgrade: (_r: Request, o: { data: unknown }) => {
      data = o.data;
      return true;
    },
  };
  const req = new Request("http://relay.test/", { headers: { upgrade: "websocket", origin: "https://samlepirate.org" } });
  const res = wispUpgrade(req, srv, {
    enabled: true,
    allowOrigin: () => true,
    allowLoopbackForTest: opts.loopback ?? false,
    clientIp: `203.0.113.${++ipSeq}`,
    policy: { ...DEFAULT_WISP_POLICY, ipBytesPerSec: 0, globalBytesPerSec: 0, ...opts.policy },
    resolver: opts.resolver,
  });
  expect(res).toBeUndefined();
  const frames: ReturnType<typeof decodeWispPacket>[] = [];
  const ws = {
    data,
    readyState: 1,
    send(f: Uint8Array) {
      frames.push(decodeWispPacket(f.slice()));
      return f.byteLength;
    },
    getBufferedAmount: () => opts.buffered?.() ?? 0,
  };
  wispOpen(ws);
  const session = data as WispSession;
  const closeOf = (id: number) => {
    const f = frames.find((p) => p?.type === "close" && p.streamId === id);
    return f?.type === "close" ? f.reason : undefined;
  };
  const dataOf = (id: number) =>
    Buffer.concat(frames.flatMap((p) => (p?.type === "data" && p.streamId === id ? [Buffer.from(p.payload)] : []))).toString();
  return { ws, frames, session, closeOf, dataOf, end: () => wispClose(ws) };
}

let echo: net.Server;
let echoPort = 0;
let echoAccepted = 0;
beforeAll(async () => {
  echo = net.createServer((s) => {
    echoAccepted++;
    s.on("data", (d) => s.write(d));
    s.on("error", () => {});
  });
  await new Promise<void>((r) => echo.listen(0, "127.0.0.1", r));
  echoPort = (echo.address() as net.AddressInfo).port;
});
afterAll(() => echo.close());

// ── 1. The address guard, numeric on the canonical address ──

const ATTACK_HOSTS = [
  // IPv6 loopback in long forms (text prefixes missed them)
  "0:0:0:0:0:0:0:1",
  "::0:1",
  "0::1",
  "[0:0:0:0:0:0:0:1]",
  "::",
  "0:0:0:0:0:0:0:0",
  // IPv4-mapped: loopback, metadata, 10/8, in hex and dotted tails
  "0:0:0:0:0:ffff:7f00:1",
  "::ffff:127.0.0.1",
  "0:0:0:0:0:ffff:a9fe:a9fe",
  "::ffff:169.254.169.254",
  "0:0:0:0:0:ffff:a00:1",
  "::ffff:10.0.0.1",
  // IPv4-compatible, NAT64, 6to4, Teredo, ULA, link-local, site-local, multicast, documentation
  "::127.0.0.1",
  "64:ff9b::a9fe:a9fe",
  "64:ff9b:1::1",
  "2002:7f00:1::1",
  "2001:0:4136:e378::1",
  "fd00::1",
  "fc00::1",
  "fe80::1",
  "FE80::1",
  "fe80::1%eth0",
  // malformed IPv6 (refused, never handed to a resolver)
  "1:2:3:4:5:6:7:8::",
  "1::2::3",
  ":::",
  "::ffff:1.2.3.256",
  "fec0::1",
  "ff02::1",
  "2001:db8::1",
  "100::1",
  // IPv4 special-purpose
  "127.0.0.1",
  "127.255.255.254",
  "0.0.0.0",
  "10.1.2.3",
  "100.64.0.1",
  "169.254.169.254",
  "172.16.0.1",
  "172.31.255.255",
  "192.168.1.1",
  "192.0.0.1",
  "198.18.0.1",
  "224.0.0.1",
  "255.255.255.255",
  // legacy numeric IPv4 forms
  "2130706433",
  "127.1",
  "0x7f.1",
  "0x7f000001",
  "0177.0.0.1",
  "017700000001",
  "127.0.0.01",
  "1.2.3.4.5",
  // local names
  "localhost",
  "LOCALHOST.",
  "metadata",
  "metadata.google.internal",
  "rooms",
  "mybox.local",
  "router.home.arpa",
  "service.internal",
];

const PUBLIC_HOSTS = [
  "8.8.8.8",
  "1.1.1.1",
  "151.101.0.223",
  "172.32.0.1",
  "100.128.0.1",
  "2606:4700:4700::1111",
  "[2a00:1450:4007:80c::200e]",
  "2001:4860:4860::8888",
  "dl-cdn.alpinelinux.org",
  "pypi.org",
  "registry.npmjs.org",
  "github.com.",
  "1e100.net",
];

test("the guard refuses every special-purpose address in any spelling, and lets public ones through", () => {
  for (const h of ATTACK_HOSTS) expect({ h, blocked: isBlockedHost(h) }).toEqual({ h, blocked: true });
  for (const h of PUBLIC_HOSTS) expect({ h, blocked: isBlockedHost(h) }).toEqual({ h, blocked: false });
  // resolved addresses: only clean literals, checked the same way
  expect(isBlockedAddress("::ffff:7f00:1")).toBe(true);
  expect(isBlockedAddress("not-an-ip")).toBe(true);
  expect(isBlockedAddress("93.184.215.14")).toBe(false);
  // canonical forms
  expect(classifyHost("[::0:1]")).toEqual({ kind: "ipv6", value: 1n, text: "::0:1" });
  expect(classifyHost("0x7f.1").kind).toBe("numeric");
});

test("CONNECT to an attack literal is refused before any socket opens; the same harness reaches 127.0.0.1 when allowed", async () => {
  const before = echoAccepted;
  const r = relay({ policy: { tcpPorts: new Set([echoPort]) } });
  let id = 1;
  for (const h of ATTACK_HOSTS) {
    wispMessage(r.ws, encodeConnect(id, 0x01, echoPort, h));
    expect({ h, reason: r.closeOf(id) }).toEqual({ h, reason: CLOSE_BLOCKED });
    id++;
  }
  expect(r.session.streams.size).toBe(0);
  await sleep(50);
  expect(echoAccepted).toBe(before);
  r.end();

  // negative witness: the loopback test switch lets the canonical 127.0.0.1 through, and the echo answers
  const ok = relay({ loopback: true, policy: { tcpPorts: new Set([echoPort]) } });
  wispMessage(ok.ws, encodeConnect(1, 0x01, echoPort, "127.0.0.1"));
  await waitFor(() => ok.session.streams.get(1)?.connected === true, 2000, "the loopback connection");
  wispMessage(ok.ws, encodeData(1, new TextEncoder().encode("ping")));
  await waitFor(() => ok.dataOf(1) === "ping", 2000, "the echo");
  // (and even with that switch, a mapped or numeric spelling of loopback is still refused)
  for (const [i, h] of ["::ffff:127.0.0.1", "0:0:0:0:0:ffff:7f00:1", "2130706433", "127.1", "0x7f.1"].entries()) {
    wispMessage(ok.ws, encodeConnect(10 + i, 0x01, echoPort, h));
    expect({ h, reason: ok.closeOf(10 + i) }).toEqual({ h, reason: CLOSE_BLOCKED });
  }
  ok.end();
});

test("a name resolving to a private or metadata address is refused; a mixed answer uses only its allowed address", async () => {
  const answers: Record<string, string[]> = {
    "meta.attacker.example": ["169.254.169.254"],
    "mapped.attacker.example": ["::ffff:10.0.0.1"],
    "lan.attacker.example": ["10.0.0.7", "192.168.0.1"],
    "mixed.example": ["10.0.0.7", "127.0.0.1"],
  };
  const resolver: WispResolver = async (host) => {
    const a = answers[host];
    if (!a) throw new Error("ENOTFOUND");
    return a.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
  const r = relay({ loopback: true, resolver, policy: { tcpPorts: new Set([echoPort]) } });
  const names = ["meta.attacker.example", "mapped.attacker.example", "lan.attacker.example"];
  for (const [i, h] of names.entries()) wispMessage(r.ws, encodeConnect(1 + i, 0x01, echoPort, h));
  await waitFor(() => names.every((_, i) => r.closeOf(1 + i) !== undefined), 2000, "the refusals");
  for (const [i] of names.entries()) expect(r.closeOf(1 + i)).toBe(CLOSE_BLOCKED);
  wispMessage(r.ws, encodeConnect(9, 0x01, echoPort, "nx.example"));
  await waitFor(() => r.closeOf(9) !== undefined, 2000, "the unresolved name");
  expect(r.closeOf(9)).toBe(CLOSE_UNREACHABLE);
  // negative witness: the allowed address of a mixed answer is the one connected
  wispMessage(r.ws, encodeConnect(20, 0x01, echoPort, "mixed.example"));
  await waitFor(() => r.session.streams.get(20)?.connected === true, 2000, "the mixed answer's connection");
  expect(r.session.streams.get(20)?.tcp?.remoteAddress).toBe("127.0.0.1");
  r.end();
});

// ── 2. Ports, Origin, rate caps, client address ──

test("ports: only the allowlist, never mail; the policy from the environment", async () => {
  const r = relay({ loopback: true, policy: { tcpPorts: new Set([echoPort, 25, 587]), udpPorts: new Set() } });
  wispMessage(r.ws, encodeConnect(1, 0x01, 25, "127.0.0.1"));
  wispMessage(r.ws, encodeConnect(2, 0x01, 587, "127.0.0.1"));
  wispMessage(r.ws, encodeConnect(3, 0x01, 6379, "127.0.0.1"));
  wispMessage(r.ws, encodeConnect(4, 0x02, 53, "127.0.0.1"));
  for (const id of [1, 2, 3, 4]) expect(r.closeOf(id)).toBe(CLOSE_BLOCKED);
  wispMessage(r.ws, encodeConnect(5, 0x01, echoPort, "127.0.0.1"));
  await waitFor(() => r.session.streams.get(5)?.connected === true, 2000, "the allowed port");
  r.end();

  const p = wispPolicyFromEnv({ WISP_TCP_PORTS: "80, 25,443,465,99999,22", WISP_UDP_PORTS: "" });
  expect([...p.tcpPorts].sort((a, b) => a - b)).toEqual([22, 80, 443]);
  expect(p.udpPorts.size).toBe(0);
  const d = wispPolicyFromEnv({});
  expect([...d.tcpPorts].sort((a, b) => a - b)).toEqual([80, 443, 9418]);
  expect([...d.udpPorts]).toEqual([53]);
});

test("an upgrade needs an allowed Origin in production; the site's own origin is let in", () => {
  let upgraded = 0;
  const srv = { upgrade: () => (++upgraded, true) };
  const allowOrigin = (o: string) => o === "https://samlepirate.org";
  const req = (origin?: string) => new Request("http://relay.test/", { headers: { upgrade: "websocket", ...(origin ? { origin } : {}) } });
  expect(wispUpgrade(req(), srv, { enabled: true, allowOrigin })?.status).toBe(403);
  expect(wispUpgrade(req("https://evil.example"), srv, { enabled: true, allowOrigin })?.status).toBe(403);
  expect(upgraded).toBe(0);
  expect(wispUpgrade(req("https://samlepirate.org"), srv, { enabled: true, allowOrigin, clientIp: "203.0.113.200" })).toBeUndefined();
  expect(upgraded).toBe(1);
  // dev (no allowOrigin): the page's own host only — a missing Origin is foreign
  expect(wispUpgrade(req(), srv, { enabled: true })?.status).toBe(403);
});

test("a token bucket spends, owes and repays at its rate", () => {
  let t = 0;
  const b = new RateBucket(1000, 500, () => t);
  expect(b.take(400)).toBe(0);
  expect(b.take(300)).toBeCloseTo(200, 6); // 200 bytes of debt at 1000 B/s
  t += 100;
  expect(b.wait()).toBeCloseTo(100, 6);
  t += 100;
  expect(b.wait()).toBe(0);
  expect(new RateBucket(0, 0, () => t).take(1e9)).toBe(0);
});

test("the per-IP byte cap paces a download; the bytes all arrive", async () => {
  const TOTAL = 768 * 1024;
  const upstream = net.createServer((s) => {
    s.end(Buffer.alloc(TOTAL, 7));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const port = (upstream.address() as net.AddressInfo).port;
  const r = relay({
    loopback: true,
    policy: { tcpPorts: new Set([port]), ipBytesPerSec: 512 * 1024, ipBurstBytes: 128 * 1024 },
  });
  const t0 = performance.now();
  wispMessage(r.ws, encodeConnect(1, 0x01, port, "127.0.0.1"));
  let got = 0;
  await waitFor(
    () => {
      got = r.frames.reduce((n, p) => n + (p?.type === "data" && p.streamId === 1 ? p.payload.byteLength : 0), 0);
      return got >= TOTAL;
    },
    5000,
    "the paced download",
  );
  const ms = performance.now() - t0;
  // (768 KiB at 512 KiB/s after a 128 KiB burst: ≥ 1.25 s — the frames wait at the WebSocket while the cap is in debt)
  expect(ms).toBeGreaterThan(1150);
  expect(wispStats().ratePauses).toBeGreaterThan(0);
  r.end();
  upstream.close();
});

test("proxy headers are believed only from a trusted proxy", () => {
  setTrustedProxies(undefined);
  const from = (peer: string) => ({ requestIP: () => ({ address: peer }) });
  const req = new Request("http://x/", { headers: { "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.2.3.4, 8.8.4.4" } });
  // a direct client from the internet writing the headers: its own address
  expect(clientAddress(req, from("81.2.69.160"))).toBe("81.2.69.160");
  expect(clientAddress(req, from("2a01:cb00::1"))).toBe("2a01:cb00::1");
  // Nginx Proxy Manager on Docker's bridge (private): its header
  expect(clientAddress(req, from("172.18.0.2"))).toBe("9.9.9.9");
  expect(clientAddress(req, from("::ffff:172.18.0.2"))).toBe("9.9.9.9");
  setTrustedProxies("192.0.2.10");
  expect(clientAddress(req, from("172.18.0.2"))).toBe("172.18.0.2");
  expect(clientAddress(req, from("192.0.2.10"))).toBe("9.9.9.9");
  setTrustedProxies("none");
  expect(clientAddress(req, from("127.0.0.1"))).toBe("127.0.0.1");
  setTrustedProxies(undefined);
});

// ── 4. Flow control: one drain handler, a bounded queue, credits honoured ──

test("a client flooding past its credits while the upstream does not read is closed at the queue cap, with one drain handler", async () => {
  const held: net.Socket[] = [];
  const sink = net.createServer({ pauseOnConnect: true }, (s) => {
    s.pause(); // never reads: the relay's writes back up
    held.push(s);
  });
  await new Promise<void>((r) => sink.listen(0, "127.0.0.1", r));
  const port = (sink.address() as net.AddressInfo).port;
  const r = relay({ loopback: true, policy: { tcpPorts: new Set([port]) } });
  wispMessage(r.ws, encodeConnect(1, 0x01, port, "127.0.0.1"));
  await waitFor(() => r.session.streams.get(1)?.connected === true, 2000, "the sink connection");
  const stream = r.session.streams.get(1)!;
  const chunk = new Uint8Array(64 * 1024);
  let maxQueued = 0;
  let maxDrainListeners = 0;
  for (let i = 0; i < 2000 && r.closeOf(1) === undefined; i++) {
    wispMessage(r.ws, encodeData(1, chunk));
    maxQueued = Math.max(maxQueued, stream.clientQueuedBytes);
    if (stream.tcp) maxDrainListeners = Math.max(maxDrainListeners, stream.tcp.listenerCount("drain"));
    if (i % 32 === 0) await sleep(1);
  }
  expect(r.closeOf(1)).toBe(CLOSE_THROTTLED);
  expect(maxQueued).toBeLessThanOrEqual(WISP_LIMITS.maxStreamQueueBytes);
  expect(maxDrainListeners).toBe(1);
  expect(r.session.inQueuedBytes).toBe(0);
  r.end();
  for (const s of held) s.destroy();
  sink.close();
}, 15_000);

test("a client honouring its credits uploads everything through a slow reader, never throttled", async () => {
  const TOTAL_PACKETS = 160; // 10 MiB in 64 KiB packets, > the queue cap: only the credits keep it bounded
  const hash = createHash("sha256");
  let got = 0;
  const slow = net.createServer((s) => {
    s.on("data", (d: Buffer) => {
      hash.update(d);
      got += d.byteLength;
      s.pause();
      setTimeout(() => s.resume(), 2);
    });
  });
  await new Promise<void>((r) => slow.listen(0, "127.0.0.1", r));
  const port = (slow.address() as net.AddressInfo).port;
  const r = relay({ loopback: true, policy: { tcpPorts: new Set([port]) } });
  const sent = createHash("sha256");
  // (unkernel's client: the stream-0 credit to start, then each CONTINUE sets the credit)
  let credit: number = WISP_LIMITS.initialBuffer;
  let seen = 0;
  wispMessage(r.ws, encodeConnect(1, 0x01, port, "127.0.0.1"));
  let maxQueued = 0;
  for (let i = 0; i < TOTAL_PACKETS; ) {
    for (; seen < r.frames.length; seen++) {
      const f = r.frames[seen];
      if (f?.type === "continue" && f.streamId === 1) credit = f.remaining;
    }
    expect(r.closeOf(1)).toBeUndefined();
    if (credit <= 0) {
      await sleep(1);
      continue;
    }
    const p = new Uint8Array(64 * 1024).fill(i & 255);
    sent.update(p);
    wispMessage(r.ws, encodeData(1, p));
    credit--;
    i++;
    maxQueued = Math.max(maxQueued, r.session.streams.get(1)?.clientQueuedBytes ?? 0);
  }
  await waitFor(() => got >= TOTAL_PACKETS * 64 * 1024, 10_000, `the upload (${got} bytes)`);
  expect(hash.digest("hex")).toBe(sent.digest("hex"));
  expect(r.closeOf(1)).toBeUndefined();
  expect(maxQueued).toBeLessThanOrEqual(WISP_LIMITS.maxStreamQueueBytes);
  r.end();
  slow.close();
}, 20_000);

// ── 4b. UDP: connected to its destination, inbound bounded ──

test("UDP: the destination's datagrams come back, a stranger's never; inbound past the session cap is dropped", async () => {
  const dest = dgram.createSocket("udp4");
  await new Promise<void>((r) => dest.bind(0, "127.0.0.1", r));
  const destPort = dest.address().port;
  let blast = 0;
  dest.on("message", (m, rinfo) => {
    if (m.toString() === "blast") {
      blast = rinfo.port;
      return;
    }
    dest.send(m, rinfo.port, rinfo.address);
  });
  let buffered = 0;
  const r = relay({ loopback: true, policy: { udpPorts: new Set([destPort]) }, buffered: () => buffered });
  wispMessage(r.ws, encodeConnect(1, 0x02, destPort, "127.0.0.1"));
  await waitFor(() => r.session.streams.get(1)?.connected === true, 2000, "the UDP stream");
  wispMessage(r.ws, encodeData(1, new TextEncoder().encode("ping")));
  await waitFor(() => r.dataOf(1) === "ping", 2000, "the UDP echo");

  // a stranger writing to the relay's UDP port
  const relayPort = r.session.streams.get(1)!.udp!.address().port;
  const stranger = dgram.createSocket("udp4");
  await new Promise<void>((res) => stranger.send(Buffer.from("spoof"), relayPort, "127.0.0.1", () => res()));
  await sleep(150);
  expect(r.dataOf(1)).toBe("ping");

  // the client stops reading (WebSocket buffer full): the destination's flood is dropped past the cap, not queued
  buffered = WISP_LIMITS.wsHighWaterBytes * 4;
  const droppedBefore = wispStats().udpDropped;
  wispMessage(r.ws, encodeData(1, new TextEncoder().encode("blast")));
  await waitFor(() => blast > 0, 2000, "the blast request");
  // (8 000-byte datagrams: macOS caps loopback UDP at 9 216 bytes; paced so the kernel's receive buffer does not drop them first)
  const big = Buffer.alloc(8000, 1);
  for (let i = 0; i < 1200; i++) {
    dest.send(big, blast, "127.0.0.1");
    if (i % 40 === 39) await sleep(2);
  }
  await sleep(300);
  expect(r.session.outQueuedBytes).toBeLessThanOrEqual(WISP_LIMITS.maxSessionOutBytes + 65_536);
  expect(wispStats().udpDropped).toBeGreaterThan(droppedBefore);
  r.end();
  stranger.close();
  dest.close();
}, 10_000);
