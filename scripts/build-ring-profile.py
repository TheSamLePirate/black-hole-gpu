"""
Saturn's rings' fine radial profile (PLAN-PLANETES-AAA P9 G3): Cassini's radio occultation of 2005 May 3 (Rev 7, egress,
X band, 43 m DSN station), its normal optical depth reconstructed at 1 km resolution, sampled every 250 m — NASA PDS Ring-Moon
Systems Node, CORSS_8001 (Marouf et al.):
  https://pds-rings.seti.org/holdings/volumes/CORSS_8xxx/CORSS_8001/data/Rev007/Rev007E/Rev007E_RSS_2005_123_X43_E/
    RSS_2005_123_X43_E_TAU_01KM.TAB (52 MB) → assets/dem/
binned to 1 km from 69 800 to 140 900 km (the game's ring map's span — solar.ts): each kilometre's optical depth from its
mean transmission (−ln of the mean of e^−τ), held at the measurement's threshold where the ring is opaque to it (the B
ring's core), none (65 535) where the occultation did not reach — below 72 760 km: the coarse map there.

Output: assets/planets/saturn-rings-tau.bin — 71 100 little-endian u16, τ × 10 000.

usage: python3 scripts/build-ring-profile.py
"""
import os

import numpy as np

ROOT = os.path.join(os.path.dirname(__file__), "..")
R0, R1 = 69800, 140900
t = np.loadtxt(os.path.join(ROOT, "assets/dem/RSS_2005_123_X43_E_TAU_01KM.TAB"), delimiter=",", usecols=(0, 1, 2, 6, 8))
r = t[:, 0] + t[:, 1] + t[:, 2]
tau = np.minimum(np.maximum(t[:, 3], 0.0), t[:, 4])
n = R1 - R0
k = np.floor(r - R0).astype(int)
ok = (k >= 0) & (k < n)
s = np.bincount(k[ok], weights=np.exp(-tau[ok]), minlength=n)
c = np.bincount(k[ok], minlength=n)
out = np.full(n, 65535, np.uint16)
has = c > 0
out[has] = np.clip(np.round(-np.log(np.maximum(s[has] / c[has], 1e-6)) * 10000), 0, 65534).astype(np.uint16)
out.astype("<u2").tofile(os.path.join(ROOT, "assets/planets/saturn-rings-tau.bin"))
print("ring profile:", int(has.sum()), "of", n, "km measured; τ", float(out[has].min()) / 1e4, "…", float(out[has].max()) / 1e4)
for name, a, b in (("C", 74658, 92000), ("B", 92000, 117580), ("Cassini division", 117580, 122170), ("A", 122170, 136775)):
    v = out[a - R0 : b - R0]
    v = v[v < 65535] / 1e4
    print(f"  {name}: mean τ {v.mean():.2f}")
