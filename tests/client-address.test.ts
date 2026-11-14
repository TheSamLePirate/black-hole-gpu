import { expect, test } from "bun:test";
import { clientAddress } from "../server/address";

// A client's address behind the proxy (audit 2026-11-10, QA-21): X-Real-IP, else X-Forwarded-For's last hop, else the socket's — the
// rooms' quotas and the traffic relay's pace by it (the relay took the socket's, the proxy's: one pace for every player).

test("X-Real-IP first, then X-Forwarded-For's last hop, then the socket's", () => {
  const sock = { requestIP: () => ({ address: "172.18.0.2" }) };
  const at = (h: Record<string, string>) => clientAddress(new Request("http://x/traffic/plane", { headers: h }), sock);
  expect(at({ "x-real-ip": "10.0.0.1", "x-forwarded-for": "1.2.3.4, 10.0.0.9" })).toBe("10.0.0.1");
  expect(at({ "x-forwarded-for": "1.2.3.4, 10.0.0.9" })).toBe("10.0.0.9");
  expect(at({})).toBe("172.18.0.2");
  expect(clientAddress(new Request("http://x/"), {})).toBe("");
});
