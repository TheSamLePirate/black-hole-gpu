import { expect, test } from "bun:test";
import ts from "typescript";
import { translateTo } from "../src/i18n";
import { CrewExec } from "../src/ui/crew-exec";
import { readCrewAck } from "../src/net/crewcmd";

// The crew console in French and in English (docs/CREW.md, AUDIT-CREW priority 3): no French left outside a pair in its
// sources, the pilot's answers in the asking console's language — what was asked, the gates' refusals, the game's own
// words through its dictionaries —, the arguments carried for the other screens.

test("no French outside a pair in the console's sources: every text a L(fr, en), a {fr, en}, a [fr, en] or a French table", async () => {
  const files = [...new Bun.Glob("src/crew/**/*.ts").scanSync(".")];
  const bad: string[] = [];
  const french = /[éèêàâçùûôîœÉÈÀÇ’]/;
  for (const f of files) {
    const src = await Bun.file(f).text();
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true);
    const allowed = (n: ts.Node): boolean => {
      for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
        if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === "L") return true;
        // (a template's piece: the template's own place decides)
        if (ts.isTemplateSpan(p) || ts.isTemplateExpression(p)) continue;
        if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "fr") return true;
        // (a pair: [French, English])
        if (ts.isArrayLiteralExpression(p) && p.elements.length >= 2 && p.elements.length <= 4) return true;
        if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && /_FR$/.test(p.name.text)) return true;
        if (ts.isBlock(p) || ts.isSourceFile(p)) return false;
      }
      return false;
    };
    const visit = (n: ts.Node) => {
      // (a template's own pieces only: the texts in its \${…} are looked at for themselves)
      const piece =
        ts.isStringLiteral(n) ||
        ts.isNoSubstitutionTemplateLiteral(n) ||
        ts.isTemplateHead(n) ||
        ts.isTemplateMiddle(n) ||
        ts.isTemplateTail(n);
      if (piece && french.test(n.getText(sf))) {
        if (!allowed(n)) bad.push(`${f}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${n.getText(sf).slice(0, 60)}`);
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  expect(bad).toEqual([]);
});

test("the game's words in the console's language: the dictionaries both ways, a text with values, its values too", () => {
  expect(translateTo("Refuelling off", "fr")).toBe("Ravitaillement coupé");
  expect(translateTo("Ravitaillement coupé", "en")).toBe("Refuelling off");
  expect(translateTo("Refuelling off", "en")).toBe("Refuelling off");
  expect(translateTo("Tanker: TEXACO 11, 1.5 km ahead at your height — the rendezvous to its right hose", "fr")).toBe(
    "Ravitailleur : TEXACO 11, 1,5 km devant à votre altitude — rendez-vous derrière son tuyau droit",
  );
  expect(translateTo("nothing the dictionaries know", "fr")).toBe("nothing the dictionaries know");
});

function rig(lock = false) {
  const sent: Record<string, unknown>[] = [];
  const net = {
    room: {
      role: "pilot",
      slot: 0,
      members: [
        { slot: 0, role: "pilot", name: "P" },
        { slot: 2, role: "instruments", name: "Ben" },
      ],
    },
    event: (e: Record<string, unknown>) => sent.push(e),
  };
  const tool = {
    name: "controls",
    description: "",
    params: { gear: { type: "boolean" } },
    run: async () => "Gear down",
  };
  const exec = new CrewExec({
    camera: {} as never,
    settings: { netCrewActions: !lock } as never,
    tools: () => [tool as never],
    toast: () => {},
    nameOf: () => "Ben",
    families: () => ["config"] as never,
  });
  return { exec, net: net as never, sent };
}

test("the pilot answers in the asking console's language, the arguments carried; an older console's: French", async () => {
  const en = rig();
  await en.exec.handle(en.net, 2, { kind: "crew-cmd", v: 1, id: "a", to: 0, act: "cfg.gear", args: { down: true }, lang: "en" });
  const a = readCrewAck(en.sent[0])!;
  expect(a).toMatchObject({ ok: true, what: "gear down", args: { down: true } });
  const fr = rig();
  await fr.exec.handle(fr.net, 2, { kind: "crew-cmd", v: 1, id: "b", to: 0, act: "cfg.gear", args: { down: true } });
  expect(readCrewAck(fr.sent[0])).toMatchObject({ ok: true, what: "train sorti" });
  const lockedEn = rig(true);
  await lockedEn.exec.handle(lockedEn.net, 2, {
    kind: "crew-cmd",
    v: 1,
    id: "c",
    to: 0,
    act: "cfg.gear",
    args: { down: true },
    lang: "en",
  });
  expect(String(lockedEn.sent[0]!.msg)).toBe("The pilot has locked the crew's actions");
});
