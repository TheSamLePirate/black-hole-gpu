"""Triangulate planar AC3D contours, preserving winding and original corner/UV indices."""
import numpy as np

def triangulate(points):
    n=len(points)
    if n==3:return [(0,1,2)]
    normal=np.sum(np.cross(points,np.roll(points,-1,axis=0)),axis=0)
    q=np.delete(points,int(np.argmax(np.abs(normal))),axis=1)
    cross=lambda a,b,c:float(np.cross(b-a,c-a))
    area=sum(cross(np.zeros(2),q[i],q[(i+1)%n]) for i in range(n))
    sign=1 if area>=0 else -1
    eps=max(float(np.ptp(q,axis=0).max())**2*1e-10,1e-14)
    if all(sign*cross(q[i-1],q[i],q[(i+1)%n])>=-eps for i in range(n)):
        return [(0,i,i+1) for i in range(1,n-1)]
    ids=list(range(n));out=[]
    while len(ids)>3:
        found=False
        for k,b in enumerate(ids):
            a,c=ids[k-1],ids[(k+1)%len(ids)]
            if sign*cross(q[a],q[b],q[c])<=eps:continue
            if any(j not in (a,b,c) and all(sign*cross(q[u],q[v],q[j])>=-eps for u,v in [(a,b),(b,c),(c,a)]) for j in ids):continue
            out.append((a,b,c));ids.pop(k);found=True;break
        if not found:
            # Collinear corners carry no area; remove only those, never invent crossing triangles.
            k=next((k for k,b in enumerate(ids) if abs(cross(q[ids[k-1]],q[b],q[ids[(k+1)%len(ids)]]))<=eps),None)
            if k is None:raise ValueError('non-simple or non-planar AC3D polygon')
            ids.pop(k)
    if len(ids)==3:out.append(tuple(ids))
    return out
