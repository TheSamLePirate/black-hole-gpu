// bh-cli.mjs — Universal CLI implementation for the entire Black Hole GPU `__bh` API & all 73 TARS tools.
// Invoked by `/obc/scripts/bh` directly via `exec node /obc/lib/bh-cli.mjs "$@"` so stdin pipes work natively!

import fs from "node:fs";
import { AvionicsBus } from "/obc/lib/obc.mjs";

const bus = new AvionicsBus();
const args = process.argv.slice(2);
const rawFlag = args.includes("--raw");
const jsonFlag = args.includes("--json");
const stdinFlag = args.includes("--stdin");
const cleanArgs = args.filter((a) => a !== "--raw" && a !== "--json" && a !== "--stdin");
const cmd = cleanArgs[0] ?? "help";

function parseVal(s) {
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]")) || (s.startsWith('"') && s.endsWith('"'))) {
    try {
      return JSON.parse(s);
    } catch {
      return s;
    }
  }
  return s;
}

function readStdinIfRequested(force = false) {
  if (!force && !stdinFlag) return "";
  if (process.stdin.isTTY) return "";
  try {
    return fs.readFileSync(0, "utf8").trim();
  } catch {
    return "";
  }
}

function printOut(res, rawMode = false) {
  if (!res.ok) {
    console.error(`\x1b[1;31mERROR:\x1b[0m ${res.error ?? "unknown error"}`);
    process.exit(1);
  }
  if (rawMode && typeof res.result === "string") {
    console.log(res.result);
  } else {
    console.log(JSON.stringify(res.result, null, 2));
  }
}

switch (cmd) {
  case "help":
  case "-h":
  case "--help": {
    console.log(`\x1b[1;36m╔══════════════════════════════════════════════════════════════╗\x1b[0m
\x1b[1;36m║\x1b[1;37m       bh — UNIVERSAL __bh API & TARS CLI (IN / OUT)         \x1b[1;36m║\x1b[0m
\x1b[1;36m╚══════════════════════════════════════════════════════════════╝\x1b[0m
  bh ls [path]                   List members of __bh (or nested path)
  bh get <path> [--depth N]      Read any value as JSON (pipeable)
  bh set <path> <val|--stdin>    Set any property (auto-refreshes settings.*)
  bh call <path> [args...]       Call any __bh method (sync or async)
  bh tools [filter]              List all 73 TARS tools
  bh tool <name> [k=v...|--stdin] Run any TARS tool (key=val, JSON, or --stdin)
  bh search <query>              Search __bh paths & TARS tools
  bh eval "<expr>"               Evaluate CSP-safe __bh chain/assignment
  bh watch <path> [ms] [count]   Stream live NDJSON updates of a path
  bh tui                         Open full interactive __bh Explorer TUI

Examples:
  bh ls camera
  bh get fleet.active --raw
  bh set settings.vessel a320
  bh tool approach action=list field=KSFO
  echo '{"action":"list","field":"LFPB"}' | bh tool approach --stdin
  bh tool jet_autopilot alt=3000 hdgDeg=250 spd=180 ap=true athr=true`);
    process.exit(0);
  }

  case "ls": {
    const path = cleanArgs[1] ?? "";
    const res = bus.bhLs(path);
    if (!res.ok) printOut(res);
    if (jsonFlag || !process.stdout.isTTY) {
      console.log(JSON.stringify(res.result, null, 2));
      break;
    }
    const entries = res.result ?? [];
    const kindColor = { fn: "36", obj: "33", arr: "35", num: "32", bool: "32", str: "37", null: "90" };
    console.log(`\x1b[1;36m__bh${path ? `.${path}` : ""}\x1b[0m (${entries.length} members)`);
    for (const e of entries) {
      const c = kindColor[e.kind] ?? "37";
      console.log(`  \x1b[${c}m${e.kind.padEnd(4)}\x1b[0m ${e.name.padEnd(28)} \x1b[2m${e.preview}\x1b[0m`);
    }
    break;
  }

  case "get": {
    const path = cleanArgs[1] ?? "";
    const di = cleanArgs.indexOf("--depth");
    const depth = di >= 0 && cleanArgs[di + 1] ? Number(cleanArgs[di + 1]) : 3;
    printOut(bus.bhGet(path, depth), rawFlag);
    break;
  }

  case "set": {
    const path = cleanArgs[1];
    if (!path) {
      console.error("Usage: bh set <path> <value>");
      process.exit(1);
    }
    const rawVal = cleanArgs.length >= 3 ? cleanArgs.slice(2).join(" ") : readStdinIfRequested(true);
    if (rawVal === "") {
      console.error("Usage: bh set <path> <value> (or pipe with --stdin)");
      process.exit(1);
    }
    printOut(bus.bhSet(path, parseVal(rawVal)), rawFlag);
    break;
  }

  case "call": {
    const path = cleanArgs[1];
    if (!path) {
      console.error("Usage: bh call <path> [args...]");
      process.exit(1);
    }
    let callArgs = cleanArgs.slice(2).map(parseVal);
    if (callArgs.length === 0 && stdinFlag) {
      const stdinText = readStdinIfRequested(true);
      if (stdinText) {
        const parsed = parseVal(stdinText);
        callArgs = Array.isArray(parsed) ? parsed : [parsed];
      }
    }
    printOut(bus.bhCall(path, ...callArgs), rawFlag);
    break;
  }

  case "tools": {
    const filter = (cleanArgs[1] ?? "").toLowerCase();
    const res = bus.bhTools();
    if (!res.ok) printOut(res);
    const list = (res.result ?? []).filter((t) => !filter || t.name.toLowerCase().includes(filter) || t.description.toLowerCase().includes(filter));
    if (jsonFlag || !process.stdout.isTTY) {
      console.log(JSON.stringify(list, null, 2));
      break;
    }
    console.log(`\x1b[1;36mTARS TOOLS\x1b[0m (${list.length})`);
    for (const t of list) {
      console.log(`  \x1b[1;32m${t.name.padEnd(20)}\x1b[0m [${t.params.slice(0, 6).join(", ")}]`);
    }
    break;
  }

  case "tool": {
    const name = cleanArgs[1];
    if (!name) {
      console.error("Usage: bh tool <name> [key=val ... | JSON | --stdin]");
      process.exit(1);
    }
    const toolArgs = {};
    if (stdinFlag) {
      const stdinText = readStdinIfRequested(true);
      if (stdinText && stdinText.startsWith("{")) Object.assign(toolArgs, JSON.parse(stdinText));
    }
    for (const tok of cleanArgs.slice(2)) {
      if (tok.startsWith("{") && tok.endsWith("}")) {
        Object.assign(toolArgs, JSON.parse(tok));
      } else {
        const eq = tok.indexOf("=");
        if (eq > 0) {
          toolArgs[tok.slice(0, eq)] = parseVal(tok.slice(eq + 1));
        }
      }
    }
    printOut(bus.bhTool(name, toolArgs), rawFlag);
    break;
  }

  case "search": {
    const q = cleanArgs.slice(1).join(" ");
    const res = bus.bhSearch(q);
    if (!res.ok) printOut(res);
    if (jsonFlag || !process.stdout.isTTY) {
      console.log(JSON.stringify(res.result, null, 2));
      break;
    }
    const { paths = [], tools = [] } = res.result ?? {};
    console.log(`\x1b[1;36m__bh paths matching "${q}" (${paths.length}):\x1b[0m`);
    for (const p of paths.slice(0, 30)) console.log(`  ${p.kind.padEnd(4)} __bh.${p.path.padEnd(32)} \x1b[2m${p.preview}\x1b[0m`);
    console.log(`\x1b[1;32mTARS tools matching "${q}" (${tools.length}):\x1b[0m`);
    for (const t of tools) console.log(`  ${t.name.padEnd(20)} \x1b[2m${t.description}\x1b[0m`);
    break;
  }

  case "eval": {
    const expr = cleanArgs.slice(1).join(" ") || readStdinIfRequested(true);
    if (!expr) {
      console.error('Usage: bh eval "<expression with bh>"');
      process.exit(1);
    }
    printOut(bus.bhEval(expr), rawFlag);
    break;
  }

  case "watch": {
    const path = cleanArgs[1] ?? "";
    const ms = Math.max(50, Number(cleanArgs[2] ?? 500) || 500);
    const maxCount = Math.max(0, Number(cleanArgs[3] ?? 0) || 0);
    let n = 0;
    const tick = () => {
      const r = bus.bhGet(path, 2);
      if (r.ok) console.log(JSON.stringify(r.result));
      n++;
      if (maxCount > 0 && n >= maxCount) process.exit(0);
    };
    tick();
    setInterval(tick, ms);
    break;
  }

  default:
    console.error(`Unknown subcommand "${cmd}". Run: bh help`);
    process.exit(1);
}
