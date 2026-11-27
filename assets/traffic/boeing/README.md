# Boeing traffic exteriors

FlightGear FGAddon aircraft contributors — GNU GPL v2. Derived from FGAddon revision **21802**:
https://sourceforge.net/p/flightgear/fgaddon/21802/tree/trunk/Aircraft/

- `737-800`: David Culp, Syd Adams, Innis Cunningham, Michael Soitanen.
- `747-400`: Gijs de Rooy, Jonathan Redpath, Ivan Ngeow, Markus Bulik, Alexander Barrett, Ron Jensen.
- `777`: Justin Smithies, Syd Adams, Thorsten Brehm, Arminair, Hyde Yamakawa, Juigi Zollo,
  Jean-Yves Lebleu, Isaak Dieleman, Josh Davidson, Sidi Liang, Yongfan Li, Lars Van Hattum.
  See also `777-AUTHORS.txt` and the three included licence files.

Original source trees (including AC3D geometry, textures, XML assemblies and notices):
https://svn.code.sf.net/p/flightgear/fgaddon/!svn/bc/21802/trunk/Aircraft/737-800/
https://svn.code.sf.net/p/flightgear/fgaddon/!svn/bc/21802/trunk/Aircraft/747-400/
https://svn.code.sf.net/p/flightgear/fgaddon/!svn/bc/21802/trunk/Aircraft/777/

## Conversion

`scripts/build-boeing.py` uses the project's `scripts/a320/fgac.py` and `fgmesh.py`, NumPy and Pillow.
Run from the repository root: `python3 scripts/build-boeing.py <prepared-source-directory>`.
The directory contains subdirectories `737-800`, `747-400`, `777`, with the referenced AC, XML
and texture files flattened from each package's Models directory. Include the white 777 `white.png`
and 747 `blank.png` liveries alongside them. See the script's `models` and `maps` lists for inputs.

Changes: bake exterior components and four CF6 engine placements for the 747; convert to
(left, up, nose) metres; remove FlightGear luminous halo polygons; pack plain part colours;
combine the 747 maps into an atlas; use neutral paint maps; export gzip TRFC geometry and JPEG maps.
B738, B744, B772 and B77W retain distinct meshes. Other members of these families use scaled
representations; 757/767/787 and Airbus widebodies still use the existing fallback.

The runtime supplies airline colours, depth-tested lamps and model-specific effect attachments.
Rotate/translate/spin trees are exported by `scripts/a320/trafficrig.py` and evaluated
by the same runtime as the A320; the source animations now drive the gear, surfaces and fans.
Locked-track constraints and unobserved compression/flex inputs are not evaluated by this importer. No Boeing cockpit or new flight model is included.
