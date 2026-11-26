# The navigation database (assets/nav/v1)

The world's radio aids (VOR, VOR-DME, VORTAC, NDB, DME), named fixes and airways, in the runways' 5° tiles, made by
`scripts/build-navdb.ts` from FlightGear's Navaids (fgdata `Navaids/nav.dat.gz`, `fix.dat.gz`, `awy.dat.gz`): Robin A. Peel's
data, cycle 2013.10, © 2013 Robin A. Peel, **GNU General Public License v2 or later** (see the files' own headers). Modified:
converted to JSON, the VOR/DME pairs folded, the airway segments filed under both ends' tiles. Read by `src/world/navdb.ts`.
Not for real-world navigation.
