"""Prepare the animated FGAddon r21802 CRJ900 exterior (see assets/traffic/crj-fg/README.md)."""
import sys,json,gzip,struct,math
from pathlib import Path
from xml.etree import ElementTree as X
import numpy as np
from PIL import Image
from a320.fgac import read_ac,walk
from a320.fgmesh import triangles
from a320.trafficrig import prepare,export,ROT
src=Path(sys.argv[1]);out=Path('assets/traffic/crj-fg');out.mkdir(exist_ok=True)
root=X.parse(src/'CRJ900.xml').getroot()
components=[('CRJ900',np.zeros(3),np.eye(3))]
for m in root.findall('model'):
 path=m.findtext('path','')
 if path in ['CRJ700-nosegear.xml','CRJ700-maingear.xml','CRJ700-engine.xml']:
  heading=math.radians(float(m.findtext('offsets/heading-deg','0')))
  pitch=math.radians(float(X.parse(src/path).getroot().findtext('offsets/pitch-deg','0')))
  ch,sh,cp,sp=math.cos(heading),math.sin(heading),math.cos(pitch),math.sin(pitch)
  rotation=np.array([[ch,-sh,0],[sh,ch,0],[0,0,1]])@np.array([[cp,0,sp],[0,1,0],[-sp,0,cp]])
  components.append((path[:-4],np.array([float(m.findtext('offsets/'+a+'-m','0')) for a in 'xyz']),rotation))
maps=['CRJ900-Blank.png','CRJ700-Blank.png','engine.png','maingear.png','nosegear.png','wheel.png']
atlas=Image.new('RGB',(2048,2048),'white');tile=682
for i,name in enumerate(maps):
 atlas.paste(Image.open(src/name).convert('RGB').resize((tile,tile),Image.Resampling.LANCZOS),((i%3)*tile,(i//3)*tile))
atlas.save(out/'crj900.jpg',quality=94)
nodes=[];parts={};corners=[]
for part,offset,rotation in components:
 materials,root=read_ac(str(src/(part+'.ac')))
 graph=prepare(root,src/(part+'.xml'),offset);export(graph,offset,nodes,parts,rotation)
 for obj,_ in walk(root):
  tri=triangles(obj)
  if tri is None:continue
  p=(tri['pos']@rotation.T+offset)@ROT.T;n=tri['nrm']@rotation.T@ROT.T;uv=tri['uv'].copy();uv[:,:,1]=1-uv[:,:,1]
  texture=Path(obj['texture'] or '').name;mat=160
  if texture in maps:
   i=maps.index(texture);uv=(np.clip(uv,0,1)*(tile-1)+.5+np.array([i%3,i//3])*tile)/2048
  else:
   rgb=np.array([materials[m].rgb for m in tri['mat']]);flat=np.round(np.clip(rgb,0,1)*255)
   uv[:,:,0]=(flat[:,1]*256+flat[:,0])[:,None];uv[:,:,1]=flat[:,2,None]/255;mat=161
   if any(x in obj['name'].lower() for x in ['glass','window']):
    mat=158;flat[:]=np.round(np.array([.14,.22,.27])*255)
    uv[:,:,0]=(flat[:,1]*256+flat[:,0])[:,None];uv[:,:,1]=flat[:,2,None]/255
   elif 'chrome' in obj['name'].lower():mat=159
  shape=p.shape[:2]
  corners.append(np.concatenate([p,n,np.full((*shape,1),mat),np.full((*shape,1),parts.get(id(obj),0)+.99),uv],axis=2).reshape(-1,10))
v,ix=np.unique(np.concatenate(corners).astype('<f4'),axis=0,return_inverse=True)
lo=v[:,:3].min(0);hi=v[:,:3].max(0)
b=struct.pack('<4sIII6f',b'TRFC',1,len(v),len(ix),*lo,*hi)+v.tobytes()+ix.astype('<u4').tobytes()
(out/'crj900.bin').write_bytes(gzip.compress(b,mtime=0));(out/'crj900-rig.json').write_text(json.dumps(nodes,separators=(',',':')))
print('CRJ900',len(ix)//3,'triangles',len(nodes),'nodes',lo,hi)
