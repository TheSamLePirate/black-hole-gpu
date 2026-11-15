import { expect, test } from "bun:test";
import { setLang } from "../src/i18n";
import { ago, crewLinkOf, errorText, rememberRoom, why } from "../src/ui/netpanel-pure";

// The room panel's decisions out of src/ui/netpanel.ts (audit 2026-11-10, QA-10): the known rooms, an error's words, "how long ago",
// the crew console's link — the same code, now tested.

test("a room remembered first, what was known of it kept, 20 at most", () => {
  const list = Array.from({ length: 20 }, (_, i) => ({ code: `R${i}`, name: `room ${i}`, used: i }));
  list[5] = { ...list[5]!, owner: "me" } as (typeof list)[number];
  const r = rememberRoom(list, { code: "R5", name: "renamed", used: 99 });
  expect(r[0]).toEqual({ code: "R5", name: "renamed", owner: "me", used: 99 });
  expect(r.length).toBe(20);
  expect(r.filter((k) => k.code === "R5").length).toBe(1);
  const n = rememberRoom(list, { code: "NEW", name: "new", used: 100 });
  expect(n[0]!.code).toBe("NEW");
  expect(n.length).toBe(20);
  expect(n.at(-1)!.code).toBe("R18");
});

test("an error in the pilot's words: the protocol's codes, the server unreachable, else its own message", () => {
  setLang("en");
  expect(errorText("full")).toBe("The room is full (8 devices)");
  expect(errorText("bad")).toBeDefined();
  expect(errorText("nonsense")).toBeUndefined();
  expect(why({ code: "password" })).toBe("Wrong password");
  expect(why(new Error("timeout"))).toBe("The room server cannot be reached");
  expect(why(new Error("boom"))).toBe("boom");
});

test("how long ago, short; the crew's link with its server", () => {
  setLang("en");
  const now = 1_000_000_000;
  expect(ago(now - 20_000, now)).toBe("1 min ago");
  expect(ago(now - 3 * 3600_000, now)).toBe("3 h ago");
  expect(ago(now - 2 * 86400_000, now)).toBe("2 d ago");
  expect(ago(now + 5000, now)).toBe("");
  expect(crewLinkOf("https://example.org/kerr/index.html", "ABCD", null)).toBe("https://example.org/kerr/crew/#join=ABCD");
  expect(crewLinkOf("https://example.org/kerr/", "ABCD", "wss://x.y/r")).toBe(
    "https://example.org/kerr/crew/#join=ABCD&server=wss%3A%2F%2Fx.y%2Fr",
  );
});
