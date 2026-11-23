import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import net from "node:net";
import {
  decodeWispPacket,
  encodeClose,
  encodeContinue,
  encodeData,
  isBlockedHost,
  wispClose,
  wispDrain,
  wispMessage,
  wispOpen,
  wispUpgrade,
} from "../server/wisp-relay";

test("Wisp v1 packet encoding and decoding round-trip", () => {
  const cont = encodeContinue(0, 128);
  expect(cont.byteLength).toBe(9);
  const dvC = new DataView(cont.buffer);
  expect(dvC.getUint8(0)).toBe(0x03);
  expect(dvC.getUint32(1, true)).toBe(0);
  expect(dvC.getUint32(5, true)).toBe(128);

  const payload = new TextEncoder().encode("GET / HTTP/1.1\r\n\r\n");
  const dataPkt = encodeData(7, payload);
  const decodedData = decodeWispPacket(dataPkt);
  expect(decodedData?.type).toBe("data");
  if (decodedData?.type === "data") {
    expect(decodedData.streamId).toBe(7);
    expect(new TextDecoder().decode(decodedData.payload)).toBe("GET / HTTP/1.1\r\n\r\n");
  }

  const closePkt = encodeClose(7, 0x02);
  const decodedClose = decodeWispPacket(closePkt);
  expect(decodedClose).toEqual({ type: "close", streamId: 7, reason: 0x02 });

  // Build CONNECT packet: [0x01][streamId=3 LE][streamType=1 TCP][port=443 LE][hostname]
  const host = new TextEncoder().encode("dl-cdn.alpinelinux.org");
  const connect = new Uint8Array(8 + host.byteLength);
  const dv = new DataView(connect.buffer);
  dv.setUint8(0, 0x01);
  dv.setUint32(1, 3, true);
  dv.setUint8(5, 1);
  dv.setUint16(6, 443, true);
  connect.set(host, 8);
  expect(decodeWispPacket(connect)).toEqual({
    type: "connect",
    streamId: 3,
    streamType: 1,
    port: 443,
    host: "dl-cdn.alpinelinux.org",
  });
});

test("Wisp v1 decoder rejects truncated/invalid packets and blocks SSRF private/metadata hosts", () => {
  expect(decodeWispPacket(new Uint8Array([1, 2]))).toBeNull();
  expect(decodeWispPacket(new Uint8Array([0x99, 1, 0, 0, 0]))).toBeNull();
  // Cloud metadata, loopback, RFC1918, CGNAT, IPv6 ULA/loopback blocked
  for (const h of [
    "169.254.169.254",
    "metadata.google.internal",
    "localhost",
    "127.0.0.1",
    "10.0.0.5",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "::1",
    "fe80::1",
    "fd12:3456::1",
    "mybox.local",
    "service.internal",
  ]) {
    expect(isBlockedHost(h)).toBe(true);
  }
  // Public package mirrors allowed
  expect(isBlockedHost("dl-cdn.alpinelinux.org")).toBe(false);
  expect(isBlockedHost("pypi.org")).toBe(false);
  expect(isBlockedHost("registry.npmjs.org")).toBe(false);
});

test("Wisp v1 relay streams a 20 MB upstream TCP burst with zero dropped bytes and exact SHA-256 integrity", async () => {
  const TOTAL_BYTES = 20 * 1024 * 1024; // 20 MiB (> Bun's default 16 MiB WS backpressure limit!)
  const CHUNK_SIZE = 256 * 1024;
  const expectedHash = createHash("sha256");

  // 1. Local high-speed upstream TCP server blasting 20 MiB as fast as the OS accepts
  const upstream = net.createServer((sock) => {
    let sent = 0;
    const pump = () => {
      while (sent < TOTAL_BYTES) {
        const n = Math.min(CHUNK_SIZE, TOTAL_BYTES - sent);
        const buf = Buffer.allocUnsafe(n);
        for (let i = 0; i < n; i += 4) buf.writeUInt32LE((sent + i) >>> 0, i);
        expectedHash.update(buf);
        sent += n;
        if (!sock.write(buf)) {
          sock.once("drain", pump);
          return;
        }
      }
      sock.end();
    };
    pump();
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upPort = (upstream.address() as net.AddressInfo).port;

  // 2. Local Wisp server using the exact production backpressure & drain wiring
  const wispSrv = Bun.serve<unknown>({
    port: 0,
    fetch(req, srv) {
      return (
        wispUpgrade(req, srv, {
          enabled: true,
          allowOrigin: () => true,
          allowLoopbackForTest: true,
        }) ?? new Response("ok")
      );
    },
    websocket: {
      open: (ws) => wispOpen(ws),
      message: (ws, msg) => wispMessage(ws, msg),
      drain: (ws) => wispDrain(ws),
      close: (ws) => wispClose(ws),
      backpressureLimit: 1024 * 1024, // intentionally tight 1 MiB limit to force real backpressure!
      closeOnBackpressureLimit: false,
      maxPayloadLength: 512 * 1024,
    },
  });

  try {
    const gotHash = createHash("sha256");
    let gotBytes = 0;
    let closeReason = -1;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${wispSrv.port}/`);
      ws.binaryType = "arraybuffer";
      const timer = setTimeout(() => reject(new Error(`timeout after ${gotBytes}/${TOTAL_BYTES} bytes`)), 15_000);
      ws.onopen = () => {
        const hb = new TextEncoder().encode("127.0.0.1");
        const c = new Uint8Array(8 + hb.length);
        const dv = new DataView(c.buffer);
        c[0] = 0x01;
        dv.setUint32(1, 1, true);
        c[5] = 0x01;
        dv.setUint16(6, upPort, true);
        c.set(hb, 8);
        ws.send(c);
      };
      ws.onmessage = (ev) => {
        const raw = new Uint8Array(ev.data as ArrayBuffer);
        const pkt = decodeWispPacket(raw);
        if (!pkt) return;
        if (pkt.type === "data" && pkt.streamId === 1) {
          gotBytes += pkt.payload.byteLength;
          gotHash.update(pkt.payload);
        } else if (pkt.type === "close" && pkt.streamId === 1) {
          closeReason = pkt.reason;
          clearTimeout(timer);
          ws.close();
          resolve();
        }
      };
      ws.onerror = (e) => {
        clearTimeout(timer);
        reject(new Error(String(e)));
      };
    });

    expect(gotBytes).toBe(TOTAL_BYTES);
    expect(closeReason).toBe(0x02);
    expect(gotHash.digest("hex")).toBe(expectedHash.digest("hex"));
  } finally {
    wispSrv.stop(true);
    upstream.close();
  }
}, 20_000);
