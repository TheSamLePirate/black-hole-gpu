# The A320

Everything in this folder is derived from **FlightGear's A320-family** (<https://github.com/legoboyvdlp/A320-family>,
branch `dev`, revision `fec1ecba767c8fffd145337b27012e89c01e3ade`), © 2025 Josh Davidson, Jonathan Redpath, merspieler,
Matthew Maring, Thorsten Herrmann, Semir Gebran (its `README.copyright.md`; its model after Immersive Design Group's:
`Docs/THANKS.md`), licensed under the **GNU General Public License, version 2** (`LICENSE`, here). These derived files
are distributed under the same licence.

| File | From | Made by |
|---|---|---|
| `a320.bin` | `Models/Fuselage/res/A320-216.ac`, `CFM56.ac`; the animations of `Models/Fuselage/fuselage.xml`, `a320.cfm.xml`, `Models/A320-common.xml` (and its lights' places) | `scripts/build-a320.py` (with `scripts/a320/fgac.py`, `fgrig.py`) |
| `rig.json` | the same animations, readable | `scripts/build-a320.py` |
| `a320-albedo-{1,2}.ktx2`, `a320-normal-{0,1,2}.ktx2` | `Models/Fuselage/res/Static-Elements.png`, `LandingGears.png`, `placards.png`; `Models/Liveries/CFM/2k/CFM56-white.png`; `Models/Effects/Lightmaps/Fuse-Main-Normal.png`, `Engine-CFM56-Normal.png` | `scripts/build-a320-maps.py` |
| `a320-livery-{SWR,AUA,DAL,AAL}{,-engine}.ktx2` | `Models/Liveries/CFM/4k/*-fuselage.png`, `2k/*-engine.png` | `scripts/build-a320-maps.py` |
| `a320-livery-{kerr,white}{,-engine}.ktx2` | `SWR-fuselage.png` (its titles, fin and registration painted over), `CFM56-white.png`, `DAL-engine.png` (its nacelle's outline) | `scripts/build-a320-maps.py` |
| `a320-cockpit.bin`, `a320-cockpit-{0..3}.ktx2` | `Models/FlightDeck/res/fd_complete.ac` and its textures, `Models/Instruments/*/res/*.ac`; `Models/FlightDeck/a320.flightdeck.xml` (animations, controls, tooltips); `Systems/a320-cockpit.xml` (the animations' lags) | `scripts/build-a320-cockpit.py`, `scripts/build-a320-maps.py cockpit` |
| `src/a320/systems/sysdata.json`, `inputs.md` | the 13 JSBSim system files of `FDE/A320-200-CFM.xml` (`Systems/a320-fuel.xml`, `-electrical.xml`, `-hydraulic.xml`, `-pneumatic.xml`, `-aircond.xml`, `-ignition.xml`, `-lights.xml`, `-indicators.xml`, `-engine-fire.xml`, `-adr.xml`, `-apu.xml`, `-oxygen.xml`, `-misc.xml`) and the initial values of `A320-main.xml`, `A320-200-CFM-set.xml` — run as they are by `src/a320/systems/jsbsys.ts` | `scripts/build-a320-systems.py` |
| `src/a320/systems/nasal/*.ts` | `Nasal/Systems/APU.nas`, `ADIRS/ADR.nas`, `fire.nas`, `electrical.nas`, `hydraulics.nas`, `pneumatics.nas`, `fuel.nas` — ported to TypeScript | by hand |
| `src/a320/ecam/messages.ts`, `logic.ts`, `fwcdata.json`, `proprules.json` | `Nasal/ECAM/ECAM-messages.nas`, `ECAM-logic.nas` (converted), `ECAM-controller.nas`, `ECAM-phases.nas`, `ECAM-main.nas`, `SystemDisplay.nas` (ported); `Systems/a320-fwc.xml`, `a320-fwc-phases.xml`, `ecam-proprules.xml` | `scripts/build-a320-fwc.py`, `scripts/build-a320-systems.py` |
| `src/a320/failures.ts` | the failure properties of `AircraftConfig/fail.xml`, `Nasal/Systems/fbw.nas` | by hand |
| `src/a320/checklists.json` | `A32X-Checklists.xml` (its markers turned into the ship's frame) | `scripts/build-a320-checklists.py` |
| `sounds/*.ogg` | `Sounds/SASA/` (the CFM56-5B's cockpit, outside and wing recordings, its start; the APU, the packs, the wind, the gear, the flaps' motor, the rolling, the touchdown), `Sounds/Cockpit/`, `Sounds/GPWS/`, `Sounds/Hydraulic/`, `Sounds/Effects/` — the cabin announcements (`Sounds/Announce/`) left out; the overhead panel's button sound is Amanda Santos's "botaodepressao" (CC0 — FlightGear's `Docs/THANKS.md`, <https://freesound.org/people/amandasantos/sounds/392148/>) | `scripts/build-a320-sounds.py` (Opus: mono 48 kbps, stereo 64 kbps, 48 kHz) |
| `src/a320/sound/sounddata.json`, `assets.ts`, `inputs.md` | `Sounds/cfm56-sound.xml`, `A320-common-sound.xml` (the sounds), `Systems/cfm56-sound.xml`, `sound-common.xml` (their property rules), `A320-main.xml` (the sound properties' initial values) — played by `src/a320/sound/model.ts` as SimGear's `SGXmlSound` | `scripts/build-a320-sounds.py` |
| `du/*.svg` | `Models/Instruments/PFD/res/pfd.svg`, `Upper-ECAM/res/cfm-eis2.svg` (`ewd-cfm.svg`), `Lower-ECAM/res/*.svg` (`sd-*.svg`), `IESI/res/iesi.svg` (`isis.svg`), `DCDU/DCDU.svg`, `Common/res/du-test.svg` — unchanged, drawn and driven by `src/a320/du/` after FlightGear's Nasal | copied |

**Changes**: the AC3D files read and turned into the game's frame (x to the craft's left, y up, z its nose; the belly at
y = 0); the polygons triangulated, their normals smoothed within each object's crease angle; FlightGear's animations
kept as a rig the game evaluates as SimGear does (`src/a320/rig.ts`); ambient occlusion baked per vertex; the maps
gathered into three texture layers and re-encoded as KTX2 (UASTC); the house's "Kerr" and plain white liveries painted
from SWISS's. **The source form**: the files above in FlightGear's repository, with the build scripts named.

The real airlines' liveries (Swiss, Austrian, Delta, American) carry their owners' names and trade marks: the game
offers them as options only; its default is the house's.

Binary (little endian, gzip): see the header of `scripts/build-a320.py` ("A320" v1).

## The displays' font

`fonts/ECAMFontRegular.ttf`, `fonts/ECAMFontBold100em.ttf`: the ECAM font of **FlyByWire Simulations** (as FlightGear's
A320-family ships it in `Fonts/`), licensed under the **GNU General Public License, version 3** (`fonts/LICENSE-GPL-3.0.txt`); unchanged. The
FlightGear set's other cockpit fonts (Honeywell MCDU, Airbus7Seg, AirbusRMP) carry no licence and are not used.
