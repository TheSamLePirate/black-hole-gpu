// Bun's minifier drops dependency notices; retain the bundled BSD/ISC licences in every distribution.
const output = process.argv[2];
if (!output) throw new Error("usage: bun scripts/build-scenery-worker.ts <output.js>");
const result = await Bun.build({ entrypoints: ["src/system/scenery-worker.ts"], target: "browser", minify: true });
if (!result.success) throw new Error(result.logs.join("\n"));
const licence = await Bun.file("vendor/scenery-LICENSE.txt").text();
await Bun.write(output, "/*!\n" + licence + "\n*/\n" + (await result.outputs[0]!.text()));
console.log(`Scenery worker: ${output} (dependency notices retained)`);
