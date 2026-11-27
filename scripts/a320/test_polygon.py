import unittest
import numpy as np
from .polygon import triangulate

class PolygonTest(unittest.TestCase):
    def test_concave_l_retains_area_and_winding(self):
        for points in [[[0,0,0],[3,0,0],[3,1,0],[1,1,0],[1,3,0],[0,3,0]]]:
            for p in [np.array(points,float),np.array(points[::-1],float)]:
                tris=triangulate(p)
                self.assertEqual(len(tris),len(p)-2)
                areas=[np.cross(p[b]-p[a],p[c]-p[a])[2]/2 for a,b,c in tris]
                self.assertAlmostEqual(sum(abs(x) for x in areas),5)
                self.assertTrue(all(x*areas[0]>0 for x in areas))
    def test_convex_quad(self):
        self.assertEqual(triangulate(np.array([[0,0,0],[1,0,0],[1,1,0],[0,1,0]],float)),[(0,1,2),(0,2,3)])

if __name__=='__main__':unittest.main()
