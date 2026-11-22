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

test("Wisp v1 decoder rejects truncated/invalid packets and blocks cloud metadata hosts", () => {
  expect(decodeWispPacket(new Uint8Array([1, 2]))).toBeNull();
  expect(decodeWispPacket(new Uint8Array([0x99, 1, 0, 0, 0]))).toBeNull();
  expect(isBlockedHost("169.254.169.254")).toBe(true);
  expect(isBlockedHost("metadata.google.internal")).toBe(true);
  expect(isBlockedHost("dl-cdn.alpinelinux.org")).toBe(false);
});
