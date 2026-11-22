import { expect, test } from "bun:test";
import { decodeWispPacket, encodeClose, encodeContinue, encodeData, isBlockedHost } from "../server/wisp-relay";

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
