# Regional Sentinel-2 / WorldCover packs

WorldCover 2021 v200 classes and the matching annual Sentinel-2 RGBNIR composites,
prepared from the official ESA COGs by `bun run build:earth-surface`.

© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021),
processed by ESA WorldCover consortium.

License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Sources and original datasets: [ESA WorldCover](https://esa-worldcover.org/en/data-access),
[AWS registry](https://registry.opendata.aws/esa-worldcover-vito-composites/).
Every source URL is recorded in `manifest.json`.

Modifications: geographic reprojection and resampling, linear reflectance to sRGB,
tiling with gutters, mipmaps, UASTC/KTX2 colour encoding and lossless gzip classes.
The 2021 date is fixed; the simulation date does not update these annual images.

`regions.json` is the build input; `manifest.json` is the committed runtime index.
At most 16 pages per region; hashes address the prepared files independently of
the app build. See [implementation and budgets](../../docs/PLAN-TERRE-PHOTOREALISTE.md).

Rebuilding needs Python 3 with `scripts/earth-surface-requirements.txt` (the venv
`.cache/earth-build`, or any interpreter named by `EARTH_BUILD_PYTHON`) and Basis Universal
**2.50.0** (`basisu`, or the binary named by `BASISU`): the script refuses another version, since a
new encoder writes new bytes, new hashes and a whole new pack in the history. The version and flags
used are recorded under `encoder` in `manifest.json`. See also
[assets and repository size](../../docs/ASSETS.md).
