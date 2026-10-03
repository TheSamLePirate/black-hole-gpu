// Every t("…") / tf("…") / tr(…) call of the source reaches the i18n module's — not a local `t`
// (a time, often) that hides it: a hidden one is not a type error when the local is untyped, and
// throws at run time. Used by tests/i18n.test.ts.

import ts from "typescript";

export function shadowedCalls(): string[] {
  const cfg = ts.getParsedCommandLineOfConfigFile("tsconfig.json", {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })!;
  const program = ts.createProgram(
    cfg.fileNames.filter((f) => f.includes("/src/")),
    cfg.options,
  );
  const checker = program.getTypeChecker();
  const out: string[] = [];
  for (const sf of program.getSourceFiles()) {
    if (!sf.fileName.includes("/src/") || sf.isDeclarationFile) continue;
    // (the names this file imports from the i18n module: any call of one of them must reach it)
    const imported = new Set<string>();
    for (const st of sf.statements)
      if (ts.isImportDeclaration(st) && /\/i18n["']$/.test(st.moduleSpecifier.getText(sf)))
        st.importClause?.namedBindings?.forEachChild((b) => ts.isImportSpecifier(b) && imported.add(b.name.text));
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && /^(t|tf|tr)$/.test(n.expression.text)) {
        const first = n.arguments[0];
        const literal = first && (ts.isStringLiteral(first) || ts.isObjectLiteralExpression(first));
        const sym = checker.getSymbolAtLocation(n.expression);
        const decl = sym?.declarations?.[0];
        const fromI18n = decl && (ts.isImportSpecifier(decl) || decl.getSourceFile().fileName.endsWith("/src/i18n.ts"));
        if ((literal || imported.has(n.expression.text)) && !fromI18n) {
          const { line } = sf.getLineAndCharacterOfPosition(n.getStart());
          out.push(`${sf.fileName.replace(/.*\/src\//, "src/")}:${line + 1}`);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

if (import.meta.main) console.log(shadowedCalls().join("\n") || "ok");
