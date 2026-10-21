# Nuages AAA — progression

Plan : [PLAN-NUAGES-AAA.md](../../PLAN-NUAGES-AAA.md). M1 Max, Chrome headless, 1600 × 1000, détail high/veryFar, raster ¼.

## N0 — référence (vue figée, rayons neufs à chaque image)

| Scène | tracé ×4 | raster ¼ |
|---|---|---|
| cumulus au-dessus de l'avion (Tarifa, 700 m, « nuageux ») | 18,1 ms · 40,6 dB | 31,3 ms · 38,6 dB |
| cumulus vus de dessus (3 400 m) | 32,0 ms · 47,8 dB | 52,0 ms · 48,2 dB |
| couvert sur les Alpes | 42,9 ms · 39,3 dB | 53,3 ms · 40,9 dB |
| orage (Tarifa, 900 m) | 39,9 ms · 21,9 dB | 101,8 ms · 20,9 dB |

## N1, N1b — la passe de nuages et son historique — fait

- `trace.wgsl clouds` : les nuages le long des rayons marchés une fois par texel de demi-image (un bloc 2 × 2), bornés par la
  surface la plus proche du bloc (visibilité raster) ; sortie : lumière et couverture, distance du nuage, borne, profondeur
  [M]. `earthClouds` factorisé de `earthLook` (identique) ; `CLOUDS_BUFFERED` : `earthLook` prend les nuages du tampon.
- `system/cloud-pass.ts cloudsBuffered` : les pixels (shade, main) lisent les quatre texels autour d'eux, pondérés par la
  ressemblance de leurs bornes (une crête ne donne pas ses nuages au ciel voisin).
- `post.wgsl cloudTemporal` : l'historique propre aux nuages, reprojeté avec **leur** profondeur (la caméra et la dérive de
  la passe temporelle), borné au 3 × 3 courant (lumière prémultipliée, couverture), 15 % de l'image ; recopié comme historique.
- `renderer.cloudPassOn`, `renderer.cloudHistoryOn`, `renderer.cloudPassStats`.
- **Trouvé en route** : l'indicateur de la passe était décidé dans `writeParams` avant que la clé de l'image ait tous ses
  bits — la variante `clouds` jamais trouvée, la passe jamais dessinée ; décidé désormais au moment du dispatch.

Mesure alternée (A, B, A, B — le premier mode de chaque scène mesuré avant la météo prête, écarté) :

| Scène | sans la passe | avec |
|---|---|---|
| cumulus au-dessus | `shade` 19,8 ms | 19,7–21,1 + passe 0,8 ms : pas de gain |
| cumulus vus de dessus | 4,3 + trace 8,5 ms | 2,4–3,4 + 5,2–7,2 + 0,7–1,0 : −2 à −3 ms |
| couvert, Alpes | 8,4 + 7,4 ms | 7,0–7,3 + 6,3–6,5 + 1,6 : ≈ −0,5 ms |
| orage | 21,8 + 7,2 ms | 19,1–19,2 + 5,7–5,8 + 2,0 : ≈ −1,5 ms |

Gain modeste : à l'ombrage ¼, un quart des pixels marchaient déjà leurs nuages, autant que la demi-résolution. Sur vue figée
touchée à chaque image (l'historique ne s'accumule pas), l'image perd 1 à 5 dB (bords adoucis par la demi-résolution). La
valeur de la passe : un historique reprojeté avec la profondeur des nuages (en mouvement), le ciel ombré à la demi-résolution
plutôt qu'à un rayon par bloc 4 × 4, et un budget propre pour la lumière (N2).
