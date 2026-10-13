# Astronaute sous licence — false-earth

Modèle demandé par l’utilisateur le 12 octobre 2026. L’utilisateur a confirmé posséder la licence
CGTrader appropriée avant l’import des assets. Ces assets commerciaux ne sont pas sous licence MIT.
Les conditions de la licence achetée continuent de s’appliquer ; ne pas les proposer comme modèles
ou textures autonomes, ni les réutiliser dans un autre projet sans droit approprié.

Source : [false-earth, Ming-Jyun Hung](https://github.com/momentchan/false-earth), commit
`468a0cfd71698400103198a8eb91d5176fe4f59e`. Son README identifie CGTrader comme origine de l’astronaute.
Modèle, textures et animations proviennent de `public/models/` et `public/textures/` à cette révision.
Le modèle natif omet les meshes internes « Person », comme l’application d’origine, et conserve les
parties de combinaison, casque et sac. 51 654 sommets, 90 827 triangles, 70 articulations.

Préparation avec Bun, sans dépendance de rendu supplémentaire :

```sh
bunx --bun @gltf-transform/cli@4.5.1 copy /chemin/licencie/models/Astronaut.glb /chemin/licencie/models/Astronaut-decoded.glb
bun scripts/build-astronaut.ts /chemin/licencie
```

Le répertoire doit contenir aussi `Idle.glb`, `Walking.glb`, `Running.glb`, `WalkingBack.glb` sous
`models/`, et les huit KTX2 d’origine sous `textures/Body/` et `textures/Details/`.
`astronaut.bin` contient mesh, rig et clips, dans le format natif SKN1 compressé gzip. Les textures
2K sont transcodées par le worker Basis existant, avec mipmaps résidents 1K sur BC7/ASTC et 512 sur
RGBA pour limiter la mémoire. Le skinning des sommets et leurs ombres sont calculés sur GPU.

Spécification : [glTF 2.0, Khronos](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html).
Importer des assets ne signifie pas importer le code ou la scène React/Three de la démonstration.
