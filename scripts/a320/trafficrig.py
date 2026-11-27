"""Bake FG rotate/translate/spin animation trees for plain traffic exteriors."""
import json
import re
import tempfile
from pathlib import Path
import numpy as np
from . import fgrig

ROT = np.array([[0,-1,0],[0,0,1],[-1,0,0]])

def prepare(root, xml, offset):
    graph = fgrig.graph_from_ac(root)
    if xml.exists():
        # Typo in FGAddon r21802 LWing.xml; mirrored RWing station is 5.88 m.
        text = xml.read_text().replace('-5.5.88','-5.88')
        text = text.replace('<property alias="../../params/n1"/>', '<property>engines/engine[0]/n1</property>')
        text = text.replace('<property alias="../../params/reverser-pos-norm"/>', '<property>engines/engine[0]/reverser-pos-norm</property>')
        text = re.sub(r'<property\s+alias="[^"]*/params/(n1|reverser-pos-norm)"\s*/>',
                      lambda m: '<property>engines/engine[0]/'+m[1]+'</property>', text)
        with tempfile.NamedTemporaryFile(mode='w',suffix='.xml') as f:
            f.write(text);f.flush()
            animations = fgrig.read_animations(f.name)
        animations = [a for a in animations if a['type'] in ('group','rotate','translate','spin')]
        fgrig.resolve_axes(root, animations)
        animations = [a for a in animations if a['type']=='group' or a.get('axis') is not None]
        # CRJ XML targets named animation groups (including spins/translations), not only AC objects.
        # Preserve those names before installing the following outer articulation.
        for animation in animations:
            created = fgrig.install(graph,[animation])[0]
            if animation.get('name'):
                for node in created: node.name = animation['name']
    return graph

def export(graph, offset, nodes, parts, rotation=None):
    rotation = np.eye(3) if rotation is None else rotation
    def visit(n,parent):
        current=parent
        if n.anim is not None and n.anim['type']!='group':
            a=n.anim
            current=len(nodes)
            o={'type':a['type'],'parent':parent,'objects':a['objects'],'prop':a.get('property',''),
               'factor':a.get('factor',1),'offset':a.get('offset',0)}
            for k in ('table','min','max'):
                if k in a:o[k]=a[k]
            axis=ROT@rotation@a['axis'];axis/=np.linalg.norm(axis) or 1
            o['axis']=axis.tolist()
            o['center']=(ROT@(rotation@(a.get('center') if a.get('center') is not None else np.zeros(3))+offset)).tolist()
            nodes.append(o)
        if n.geom is not None:parts[id(n.geom)]=current+1
        for k in n.kids:visit(k,current)
    visit(graph,-1)
