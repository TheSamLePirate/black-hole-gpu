#!/usr/bin/env bun
/** Human dashboard + finite, schema-versioned CLI for LLMs. No server. */
export { collect, parsePower, parseGpuRegistry, normalizeMacmon, assess } from "./src/legacy.ts";

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  if (args[0] && (!args[0].startsWith("-") || args[0] === "--version")) {
    const { main } = await import("./src/cli.ts");
    await main(args[0] === "--version" ? ["version", ...args.slice(1)] : args);
  } else {
    const { main } = await import("./src/legacy.ts");
    try { await main(); }
    catch (error) { console.error(`Erreur : ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
    if (args.includes("--help")) console.log("\nCLI pour LLM : snapshot, record, monitor, latest, analyze, compare, doctor, catalog, schema.\nDétails : bun mac-thermal.ts help");
  }
}
