# Animated CRJ900 exterior

Ryan "Skyop" Miller, D-JSB, Daniel M. and FlightGear CRJ700-family contributors.
Geometry and neutral textures: CC BY 4.0. XML animations and wheel.png: GNU GPL v2 or later.
The upstream LICENSE is preserved in LICENSE.txt; GPL-2.txt supplies the GPL text.

Source: FGAddon revision 21802, CRJ700-family:
https://svn.code.sf.net/p/flightgear/fgaddon/!svn/bc/21802/trunk/Aircraft/CRJ700-family/
https://sourceforge.net/p/flightgear/fgaddon/21802/tree/trunk/Aircraft/CRJ700-family/

Conversion: `python3 scripts/build-crj-fg.py <prepared-directory>` from the repository root,
using NumPy, Pillow and the project's AC3D parser and FlightGear animation graph reader.
Inputs: Models/CRJ900.ac, CRJ900.xml, CRJ700-nosegear.ac/.xml, CRJ700-maingear.ac/.xml,
CRJ700-engine.ac/.xml; neutral CRJ900-Blank.png and CRJ700-Blank.png, engine.png, maingear.png,
nosegear.png, wheel.png. Place inputs together in the prepared directory.

Changes: exterior only; engines/gear placed with the XML assembly offsets and engine rotations;
textures combined in a 2048² atlas; rigid animation hierarchy exported as JSON and part indices
baked into TRFC vertices. Cockpit, interior, source halo/light polygons and effects excluded.
The game supplies airline colours, depth-tested lamps and condensation.

Replaces the static Sketchfab CRJ at runtime. Old mesh files remain as historical build/test inputs;
the renderer imports this directory. No CRJ cockpit or new flight dynamics are supplied.
