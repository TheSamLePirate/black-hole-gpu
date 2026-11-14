import { expect, test } from "bun:test";
import { SERVER_ERRORS, serverError } from "../src/crew/errors";
import { setLang } from "../src/crew/lang";

// The room server's errors in the crew console's language (audit 2026-11-10, NET-32; QA-10: out of crew/main.ts). Every code of
// the protocol has its words (the type holds it: Record<ErrorCode, …>); here, each in French and in English, none empty, each its
// own; an unknown code: none (the server's text said then). « bad » had none, in the console or in the game, until 14 Nov 2026.

test("every code its words, in French and in English; an unknown code none", () => {
  const codes = Object.keys(SERVER_ERRORS);
  expect(codes).toContain("bad");
  for (const l of ["fr", "en"] as const) {
    setLang(l);
    const said = codes.map((c) => serverError(c)!);
    expect(said.every((s) => typeof s === "string" && s.length > 5)).toBe(true);
    expect(new Set(said).size).toBe(codes.length);
  }
  setLang("fr");
  expect(serverError("unknown-room")).toBe("Cette salle n’existe plus.");
  expect(serverError("no-such-code")).toBeNull();
  expect(serverError("toString")).toBeNull();
});
