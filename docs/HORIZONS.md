# Horizons — the long shadows of a low Sun

*Français plus bas.* Plan: [PLAN-REFRACTION-HORIZONS.md](PLAN-REFRACTION-HORIZONS.md), phases H1–H5; status:
[progress/refraction-horizons/H4.md](progress/refraction-horizons/H4.md).

## What it is

A low Sun casts shadows tens or hundreds of kilometres long: the Moon's terminator, its south pole, the Alps at sunset. A
ray marched from every pixel cannot reach that far at a frame's cost. Instead, each world's relief is **baked** once into
**horizon maps**: for every texel, in 8 directions (16 on the polar caps), the highest elevation of the ground seen from there,
and the distance of the ridge that sets it. Shading then reads two numbers towards the Sun and compares the Sun's elevation
with that horizon, over the Sun's disc.

| Scale | Where | Reader |
|---|---|---|
| A far disc (the Moon at the telescope) | `trace.wgsl ourSegment` → `horizonLight` | the world's map (H2), its relief loaded alone (H1b) |
| The near body beyond its march (~20 km) | `nearShadow` | the same map (H3) |
| The Earth beyond the shadow cascades (~10 km, up to 150 km) | `liteSun`, `earthGround` → `earthHorizonLight` | the relief cache's levels 4–6 (H5) |

Each scale's part is combined with the others by their **minimum**: the near march, the Sun's shadow map, the cascades and the
horizon each answer in their own range.

- **Worlds baked**: the Moon, Mercury, Ceres, Mars (one at a time, 50 MB, 16–36 s on the GPU at 2 ms a frame); the Earth's three
  levels (6.3 MB), baked again when the cache moves, never when the Sun turns.
- **Seen from the point's own height** (option (d)): `tan e' = tan e + (h0 − h)/d` — a peak keeps its light past the terminator.
- **Setting**: `horizonMaps` (Settings › Sky › Worlds' relief), on by default; off, nothing is baked nor read.
- **Automation**: `__bh.renderer.horizonMaps` (`stats()`, `read()`), `horizonRow`, `earthHorizons.stats()`,
  `horizonStatus(settings)`; TARS reads the same state in its "sky" telemetry. Comparisons: `renderer.liteSkip` 524288 (the near
  body's map), 1048576 (the Earth's).
- **e2e**: `horizon-pilot`, `horizon-discs`, `horizon-near`, `earth-horizons` ([E2E-CATALOGUE.md](E2E-CATALOGUE.md)).

**Limits**: an estimate, not a proof — about ±0.3° against a texel-step reference (5–95 %); relief finer than two map texels
(~11 km on the Moon) is left to the marches; the south pole's regional data (Shackleton) is not in yet.

---

## Horizons — les ombres longues du Soleil bas

Un Soleil bas porte des ombres de dizaines ou de centaines de kilomètres : le terminateur de la Lune, son pôle sud, les Alpes au
couchant. Une marche depuis chaque pixel ne va pas si loin au prix d'une image. Le relief de chaque monde est donc **cuit** une fois
en **cartes d'horizon** : pour chaque texel, dans 8 directions (16 sur les calottes), l'élévation la plus haute du sol vu de là et la
distance de la crête qui la donne. L'éclairage lit deux nombres vers le Soleil et compare son élévation à cet horizon, sur son disque.

- **Trois échelles** : le disque lointain (la Lune au télescope, H1b + H2), le corps proche au-delà de sa marche (H3), la Terre au-delà
  des cascades d'ombre (H5) — combinées aux autres ombres par leur **minimum**.
- **Revu depuis la hauteur du point** (option (d)) : un sommet garde sa lumière au-delà du terminateur.
- **Réglage** : `horizonMaps` (Réglages › Ciel › Le relief des mondes), allumé par défaut.
- **Limites** : une estimation (±0,3° environ) ; le relief plus fin que deux texels de la carte reste aux marches ; les données
  régionales du pôle sud (Shackleton) ne sont pas encore là.
