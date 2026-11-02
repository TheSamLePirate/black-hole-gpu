import { outputSchemas, CATALOG, VERSION } from "./model.ts";
import { mkdir } from "node:fs/promises";
const directory = `${import.meta.dir}/../dist`;
await mkdir(directory, { recursive: true });
const result = await Bun.build({ entrypoints: [`${import.meta.dir}/../mac-thermal.ts`], outdir: directory,
  target: "bun", naming: "mac-thermal.js", minify: false });
if (!result.success) throw new Error(result.logs.map(String).join("\n"));
await Bun.write(`${import.meta.dir}/../schema.json`, JSON.stringify(outputSchemas(), null, 2) + "\n");
await Bun.write(`${import.meta.dir}/../metric-catalog.json`, JSON.stringify({ schemaVersion: VERSION, metrics: CATALOG }, null, 2) + "\n");
console.log("Built standalone dist/mac-thermal.js, schema.json and metric-catalog.json");
