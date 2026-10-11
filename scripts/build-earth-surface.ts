// Reproducible regional packs; COG preparation is offline, Basis encoding bounded to two processes.
import { $ } from "bun";
import { renameSync, unlinkSync } from "node:fs";

const python = process.env.EARTH_BUILD_PYTHON ?? ".cache/earth-build/bin/python";
await $`${python} scripts/earth-surface-build.py`;
const manifest = await Bun.file(".cache/earth-surface/manifest.json").json();
const jobs: { region: string; page: string }[] = manifest.regions.flatMap((r: { id: string; pages: string[] }) =>
  r.pages.map((page) => ({ region: r.id, page })),
);
await Promise.all(
  Array.from({ length: 2 }, async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      const png = `.cache/earth-surface/${job.region}-${job.page}.png`;
      const target = `assets/earth-surface/v1/${job.region}/${job.page}.ktx2`;
      await $`basisu -uastc -uastc_level 1 -uastc_rdo_l 1.0 -ktx2 -ktx2_zstandard_level 18 -mipmap -file ${png} -output_file ${target}`.quiet();
      console.log(target);
    }
  }),
);
// Content-addressed URLs: regeneration can never serve an old page from the tile cache.
for (const region of manifest.regions) {
  region.pages = await Promise.all(
    region.pages.map(async (name: string) => {
      const directory = `assets/earth-surface/v1/${region.id}`;
      const hashFile = async (extension: string) => {
        const path = `${directory}/${name}.${extension}`;
        const hash = new Bun.CryptoHasher("sha256")
          .update(await Bun.file(path).arrayBuffer())
          .digest("hex")
          .slice(0, 8);
        const file = `${name}-${hash}.${extension}`;
        renameSync(path, `${directory}/${file}`);
        return file;
      };
      return { name, color: await hashFile("ktx2"), cover: await hashFile("classes.gz") };
    }),
  );
  const keep = new Set(region.pages.flatMap((p: { color: string; cover: string }) => [p.color, p.cover]));
  for await (const file of new Bun.Glob("*").scan(`assets/earth-surface/v1/${region.id}`))
    if (!keep.has(file)) unlinkSync(`assets/earth-surface/v1/${region.id}/${file}`);
}
await Bun.write("assets/earth-surface/manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
