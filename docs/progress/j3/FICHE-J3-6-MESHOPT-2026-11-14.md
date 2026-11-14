# J3-6 — meshoptimizer sur les maillages des appareils : évaluation (14 novembre 2026, ~00:02 UTC)

**Nature** : évaluation datée pour la question 4 de Sam (PLAN-J3 §8 : « meshoptimizer adopté pour les appareils ? »). **Rien n'est adopté** :
la bibliothèque a été installée dans le dossier temporaire de la session, hors du dépôt ; aucune dépendance ajoutée, aucun maillage changé.
Méthode de CLAUDE.md (bibliothèques) : documentation officielle de la version lue (le `README.md` du paquet), licence, compatibilité Bun,
coût d'intégration, gain mesuré sur nos fichiers.

## La version examinée

- **meshoptimizer 1.3.0** (npm), licence **MIT**. Modules JS + WebAssembly séparés : `MeshoptEncoder` (prétraitement `reorderMesh`,
  encodage des sommets et des indices), `MeshoptDecoder` (décodage, 1–3 Go/s en SIMD d'après sa documentation — **non mesuré ici**),
  `MeshoptSimplifier` (niveaux de détail), `MeshoptClusterizer`, `MeshoptTangents`. Chaque module attend sa promesse `ready`.
- **Bun** : importé et exécuté tel quel sous Bun (`bun eval.ts`), WebAssembly compris — aucun ajustement.
- **Intégration** : hors de la boucle d'image, dans les scripts de construction (`scripts/build-*.ts`, qui produisent nos `.bin`) ; le décodeur
  n'entrerait dans le bundle que si l'encodage meshopt était livré (sinon, réordonnancement et niveaux de détail n'ajoutent rien au bundle).

## Ce qui a été mesuré

Nos maillages au format commun (en-tête de 40 octets, sommets 8 ou 10 flottants, indices u32) ; F-35, A320, ISS et astronaute ont d'autres
en-têtes, **non évalués**. Le transfert : Pages et le serveur envoient les `.bin` en gzip (`content-encoding: gzip`, `ford.bin` 1,41 Mo
transférés pour 6,5 Mo — vérifié le 14 nov.), donc la référence est **gzip**, pas la taille brute.

| Maillage | Triangles | Brut | gzip (≈ transfert) | meshopt sans perte + gzip | Écart | Défauts de cache (ACMR) tel quel → réordonné | Simplifié : part atteinte @ erreur relative |
|---|---:|---:|---:|---:|---:|---|---|
| ranger.bin | 32050 | 1005 Ko | 573 Ko | 378 Ko | −34 % | 0.946 → 0.71 | 50 % : 0.5 @ 0.0000244 ; 25 % : 0.25 @ 0.0000593 |
| endurance.bin | 96046 | 5667 Ko | 3192 Ko | 2700 Ko | −15 % | 2.481 → 1.534 | 50 % : 0.349 @ 0.0238 ; 25 % : 0.241 @ 0.0397 |
| lander.bin | 37351 | 1969 Ko | 1211 Ko | 984 Ko | −19 % | 1.809 → 1.101 | 50 % : 0.5 @ 0.000472 ; 25 % : 0.304 @ 0.046 |
| ford.bin | 116429 | 6547 Ko | 1354 Ko | 1286 Ko | −5 % | 1.403 → 1.154 | 50 % : 0.5 @ 0.000395 ; 25 % : 0.094 @ 0.00961 |
| implacable.bin | 95666 | 9144 Ko | 3685 Ko | 3416 Ko | −7 % | 2.202 → 2.148 | 50 % : 0.49 @ 0.000732 ; 25 % : 0.229 @ 0.00195 |
| cargo.bin | 53466 | 4286 Ko | 1301 Ko | 1537 Ko | +18 % | 2.111 → 1.756 | 50 % : 0.321 @ 0.0401 ; 25 % : 0.297 @ 0.047 |
| tanker.bin | 44980 | 3523 Ko | 1184 Ko | 1493 Ko | +26 % | 2.132 → 1.71 | 50 % : 0.468 @ 0.0245 ; 25 % : 0.353 @ 0.047 |
| crj900.bin | 5172 | 708 Ko | 186 Ko | 222 Ko | +19 % | 1.992 → 1.982 | 50 % : 0.849 @ 0.036 ; 25 % : 0.849 @ 0.036 |

(ACMR : sommets transformés par triangle avec un cache FIFO de 16 — l'idéal ≈ 0,5–0,7. Erreur relative : la déviation sur l'étendue du maillage,
0,05 demandés au plus, l'option `Prune`. Encodage : `reorderMesh` pour la taille, `encodeVertexBuffer` + `encodeIndexBuffer`, **sans
quantification** — l'étape qui perd de l'information et donne d'ordinaire l'essentiel du gain n'a pas été essayée.)

## Lecture

- **Taille transférée** : sans quantification, le gain sur gzip va de **−34 %** (Ranger) à **+26 %** (pétrolier ; cargo +18 %, CRJ900 +19 % : plus gros) ; sur l'ensemble évalué,
  12,7 → 12,0 Mo, **−5 %**. Le gain réel de meshopt viendrait de la quantification des positions, normales et UV : une perte de précision à décider et à
  vérifier à l'image (et le décodeur dans le bundle). **Pas un gain de chargement établi.**
- **GPU** : le réordonnancement réduit les sommets transformés par triangle de 3 à 40 % (Endurance 2,48 → 1,53, Lander 1,81 → 1,10). Le coût
  des appareils dans l'image n'a pas été mesuré à part ; **règle 1** : sans fiche qui le chiffre, ce n'est pas un lot de performance (les
  appareils sont quelques dizaines de milliers de triangles par image).
- **Niveaux de détail** : le simplificateur atteint 50 % des triangles avec une erreur ≤ 0,07 % de l'étendue sur le Ranger, le Lander et les
  porte-avions, et 25 % à ≤ 1 % sur les porte-avions — l'usage le plus prometteur (le trafic lointain, les porte-avions vus de loin), à
  rapprocher du coût par passe des appareils quand il sera mesuré. Le CRJ900 plafonne à 85 % (coutures d'attributs : 10 252 sommets utiles sur
  16 584 — non soudés) ; l'Endurance, le cargo et le pétrolier y perdent 2 à 5 % de leur étendue.

## Recommandation (pour la question 4)

Ne pas adopter meshoptimizer **pour la taille** aujourd'hui (gain nul sans quantification). Le garder comme **outil de construction des niveaux
de détail** du trafic et des porte-avions, à ouvrir quand le coût des appareils dans l'image sera chiffré (règle 1) — il s'intègre sans ajustement
sous Bun, hors du bundle. Rien n'est changé en attendant.

## Reproduire

Dans un dossier hors du dépôt : `bun add meshoptimizer@1.3.0`, puis le script ci-dessous (`bun eval.ts <dépôt> > out.json`).

```ts
// Evaluation of meshoptimizer 1.3.0 (MIT) on the game's craft meshes — PLAN-J3 J3-6, Sam's question 4 (no adoption: measured here,
// outside the repository). Per mesh: the bytes as shipped (raw / gzip), meshopt-encoded (+ gzip), the vertex cache's misses per triangle
// (ACMR, a 16-entry FIFO) as built and after reorderMesh, and what the simplifier reaches at 50 % / 25 % of the triangles (its error,
// relative to the mesh's extent).
//   bun eval.ts <repo> > out.json
import { gunzipSync, gzipSync } from "node:zlib";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

const repo = process.argv[2]!;
const files = [
  "assets/f35/f35.bin",
  "assets/a320/a320.bin",
  "assets/ranger/ranger.bin",
  "assets/endurance/endurance.bin",
  "assets/lander/lander.bin",
  "assets/iss/iss-lod1.bin",
  "assets/character/astronaut.bin",
  "assets/carriers/ford.bin",
  "assets/carriers/implacable.bin",
  "assets/traffic/cargo.bin",
  "assets/traffic/tanker.bin",
  "assets/traffic/crj900.bin",
];
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;

const acmr = (idx: Uint32Array, cache = 16) => {
  const fifo: number[] = [];
  const inC = new Set<number>();
  let miss = 0;
  for (const v of idx) {
    if (inC.has(v)) continue;
    miss++;
    fifo.push(v);
    inC.add(v);
    if (fifo.length > cache) inC.delete(fifo.shift()!);
  }
  return miss / (idx.length / 3);
};

const out: Record<string, unknown>[] = [];
for (const f of files) {
  const shipped = new Uint8Array(await Bun.file(`${repo}/${f}`).arrayBuffer());
  const gz = shipped[0] === 0x1f && shipped[1] === 0x8b;
  const raw = gz ? new Uint8Array(gunzipSync(shipped)) : shipped;
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const magic = new TextDecoder().decode(raw.slice(0, 4));
  const nv = dv.getUint32(8, true),
    ni = dv.getUint32(12, true);
  const strideF = (raw.byteLength - 40 - ni * 4) / (nv * 4);
  if (!Number.isInteger(strideF) || strideF < 3) {
    out.push({ f, magic, nv, ni, skipped: `stride ${strideF.toFixed(3)} (header not 40 bytes)` });
    continue;
  }
  const verts = new Float32Array(raw.slice(40, 40 + nv * strideF * 4).buffer);
  const idx = new Uint32Array(raw.slice(40 + nv * strideF * 4, 40 + nv * strideF * 4 + ni * 4).buffer);
  const acmr0 = acmr(idx);
  // (reordered for transmission size, as recommended for the Web)
  const idxR = idx.slice();
  const [remap, unique] = MeshoptEncoder.reorderMesh(idxR, true, true);
  const vR = new Float32Array(unique * strideF);
  for (let i = 0; i < nv; i++) if (remap[i] !== 0xffffffff) vR.set(verts.subarray(i * strideF, (i + 1) * strideF), remap[i]! * strideF);
  const acmrR = acmr(idxR);
  const encV = MeshoptEncoder.encodeVertexBuffer(new Uint8Array(vR.buffer), unique, strideF * 4);
  const encI = MeshoptEncoder.encodeIndexBuffer(new Uint8Array(idxR.buffer), ni, 4);
  const enc = encV.byteLength + encI.byteLength;
  // (and reordered for the GPU — optsize false —: its cache's misses)
  const idxG = idx.slice();
  MeshoptEncoder.reorderMesh(idxG, true, false);
  // (the simplifier on the positions — the first three floats —; error relative to the extent)
  const pos = new Float32Array(unique * 3);
  for (let i = 0; i < unique; i++) pos.set(vR.subarray(i * strideF, i * strideF + 3), i * 3);
  const lod = (share: number) => {
    const [s, err] = MeshoptSimplifier.simplify(idxR, pos, 3, Math.floor((ni * share) / 3) * 3, 0.05, ["Prune"]);
    return { tris: s.length / 3, share: +(s.length / ni).toFixed(3), errorRel: +err.toPrecision(3) };
  };
  out.push({
    f,
    magic,
    nv,
    tris: ni / 3,
    strideFloats: strideF,
    unique,
    shippedKB: Math.round(shipped.byteLength / 1024),
    shippedGzip: gz,
    rawKB: Math.round(raw.byteLength / 1024),
    rawGzipKB: Math.round(gzipSync(raw, { level: 9 }).byteLength / 1024),
    meshoptKB: Math.round(enc / 1024),
    meshoptGzipKB: Math.round(gzipSync(Buffer.concat([Buffer.from(encV), Buffer.from(encI)]), { level: 9 }).byteLength / 1024),
    acmrAsBuilt: +acmr0.toFixed(3),
    acmrReorderSize: +acmrR.toFixed(3),
    acmrReorderGpu: +acmr(idxG).toFixed(3),
    lod50: lod(0.5),
    lod25: lod(0.25),
  });
  console.error(`done ${f}`);
}
console.log(JSON.stringify(out, null, 1));
```
