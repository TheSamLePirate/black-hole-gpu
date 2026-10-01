# The International Space Station

`iss-lod0.bin` (93 k triangles) and `iss-lod1.bin` (537 k) are built by `scripts/build-iss.py` (run
with Blender, which decodes the model's Draco geometry and WebP textures) from NASA's model of the
station as flown, `ISS2.glb` — not in the repository (96 MB):

- **International Space Station (ISS)**, NASA (NASA 3D Resources, https://science.nasa.gov/3d-resources/).
  NASA's 3D models are free to use; credit NASA. The model is in the station's IGOAL frame, its joints
  named: the solar arrays' alpha joints and beta gimbals, the radiators' joints.

Each vertex keeps its colour (baked from the textures), its surface (hull, solar cells, radiator) and
the joint that moves it; the joints' pivots and axes and the two US docking ports (IDA-2, IDA-3) are in
the files' header (see the script).

The orbit comes from CelesTrak's latest elements for the station (NORAD 25544), fetched by the game,
propagated with SGP4 (`src/system/sgp4.ts`).
