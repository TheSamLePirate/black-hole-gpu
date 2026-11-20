// J9 diagnostic readback, outside timing windows: inspect the actual visibility and depth from the same submission.
export function treeSurfaceProbe(save: string | null = null) {
  return `(async () => {
  const R=__bh.renderer,d=R.device,tex=R.terrainRaster.distanceTexture(),own=R.terrainRaster.surfaceTextures();
  const width=tex.width,height=tex.height,row=Math.ceil(width*16/256)*256,dr=Math.ceil(width*4/256)*256,mr=Math.ceil(width*8/256)*256;
  const vis=d.createBuffer({size:row*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const twin=d.createBuffer({size:row*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const depth=d.createBuffer({size:dr*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const ids=d.createBuffer({size:dr*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const mot=d.createBuffer({size:mr*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try {
    const enc=d.createCommandEncoder();
    enc.copyTextureToBuffer({texture:tex},{buffer:vis,bytesPerRow:row},[width,height]);
    enc.copyTextureToBuffer({texture:tex},{buffer:twin,bytesPerRow:row},[width,height]);
    enc.copyTextureToBuffer({texture:own.depth,aspect:"depth-only"},{buffer:depth,bytesPerRow:dr},[width,height]);
    enc.copyTextureToBuffer({texture:own.identity},{buffer:ids,bytesPerRow:dr},[width,height]);
    enc.copyTextureToBuffer({texture:own.motion},{buffer:mot,bytesPerRow:mr},[width,height]);
    d.queue.submit([enc.finish()]);await Promise.all([vis.mapAsync(GPUMapMode.READ),twin.mapAsync(GPUMapMode.READ),depth.mapAsync(GPUMapMode.READ),ids.mapAsync(GPUMapMode.READ),mot.mapAsync(GPUMapMode.READ)]);
    const V=new Float32Array(vis.getMappedRange()),D=new Float32Array(depth.getMappedRange()),I=new Uint32Array(ids.getMappedRange());
    const T=new Float32Array(twin.getMappedRange()),M=new Uint16Array(mot.getMappedRange());
    let pixels=0,twinPixels=0,validDepth=0,identified=0,sky=0,leafPixels=0,barkPixels=0,motionValid=0,motionMoving=0;const samples=[];
    const save=${JSON.stringify(save)}, cellIds=save?new Uint32Array(width*height):null, distances=save?new Float32Array(width*height):null, counts=new Map();
    const objCodes=save?new Uint8Array(width*height):null, objIds=save?new Uint32Array(width*height):null, objDistances=save?new Float32Array(width*height):null;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const k=y*row/4+x*4,a=V[k+3],idx=y*width+x,code=Math.floor(a/262144);
      if(T[k+1]>.5 && T[k+3]>=131072 && T[k+3]<262144)twinPixels++;
      if(V[k+1]>.5 && a>=131072 && a<262144){pixels++;const z=D[y*dr/4+x],bits=Math.floor(a),m=y*(mr/2)+x*4;
        if(bits&65536)leafPixels++;else barkPixels++;
        if(M[m+2]===0x3c00){motionValid++;if((M[m]&0x7fff)!==0||(M[m+1]&0x7fff)!==0)motionMoving++;}
        if(save){const id=V[k+1];cellIds[idx]=id;distances[idx]=V[k+2];counts.set(id,(counts.get(id)||0)+1);}
        if(Number.isFinite(z)&&z>0&&V[k+2]>0)validDepth++;
        if(I[y*dr/4+x]!==0)identified++;
        if(V[k]===0)sky++;
        if(samples.length<4)samples.push({x,y,vis:Array.from(V.subarray(k,k+4)),depth:z,id:I[y*dr/4+x]});
      }else if(save && code>=57 && V[k+2]>0){
        objCodes[idx]=code;objIds[idx]=I[y*dr/4+x];objDistances[idx]=V[k+2];
      }
    }
    if(save){globalThis.__j9Surfaces??={};globalThis.__j9Surfaces[save]={width,height,ids:cellIds,distances,objCodes,objIds,objDistances};}
    return {aaDelta:Math.abs(pixels-twinPixels),pixels,validDepth,identified,sky,leafPixels,barkPixels,motionValid,motionMoving,samples,trees:[...counts].sort((a,b)=>b[1]-a[1])};
  } finally {vis.destroy();twin.destroy();depth.destroy();ids.destroy();mot.destroy();}
})()`;
}
export const TREE_SURFACE_PROBE = treeSurfaceProbe();

export const TREE_OCCLUSION_PICK = `(() => {
  const C=globalThis.__j9Surfaces.complete,rows=new Map();
  for(let y=0;y<C.height;y++){
    const spans=new Map();
    for(let x=0;x<C.width;x++){const id=C.ids[y*C.width+x];if(!id)continue;
      const s=spans.get(id);if(s){s[1]=x;s[2]=Math.max(s[2],C.distances[y*C.width+x]);}else spans.set(id,[x,x,C.distances[y*C.width+x]]);}
    for(const [id,[a,b,far]] of spans){let gaps=0;
      for(let x=a+1;x<b;x++){const k=y*C.width+x,other=C.ids[k];if(other && other!==id && C.distances[k]>far)gaps++;}
      rows.set(id,(rows.get(id)||0)+gaps);}
  }
  const candidates=[...rows].sort((a,b)=>b[1]-a[1]);
  if(!candidates[0]?.[1])throw Error("No visible second geometry tree inside a first tree's scanline span");
  return {id:candidates[0][0],visibleGaps:candidates[0][1]};
})()`;

// Compare independent draws of an isolated front tree, the remaining trees, and the complete scene.
// Only real geometry samples enter this witness. A hole must be bracketed by the isolated tree on its scanline.
export const TREE_OCCLUSION_COMPARE = `(() => {
  const {complete:C,front:F,back:B}=globalThis.__j9Surfaces;
  if(C.width!==F.width || C.width!==B.width || C.height!==F.height || C.height!==B.height)throw Error("surface dimensions changed");
  let overlap=0,wrongDepth=0,holes=0,wrongHole=0;const behind=new Set();
  for(let y=0;y<F.height;y++){
    let first=F.width,last=-1;
    for(let x=0;x<F.width;x++)if(F.ids[y*F.width+x]){first=Math.min(first,x);last=x;}
    for(let x=first;x<=last;x++){
      const k=y*F.width+x,f=F.ids[k],b=B.ids[k];if(!b)continue;
      if(f){overlap++;const expected=F.distances[k]<B.distances[k]?F:B;
        if(C.ids[k]!==expected.ids[k] || Math.abs(C.distances[k]-expected.distances[k])>.002)wrongDepth++;
      }else{holes++;behind.add(b);if(C.ids[k]!==b || Math.abs(C.distances[k]-B.distances[k])>.002)wrongHole++;}
    }
  }
  return {overlap,wrongDepth,holes,wrongHole,behind:[...behind]};
})()`;

export const TREE_OBJECT_PICK = `(() => {
  const C=globalThis.__j9Surfaces.complete,rows=new Map();
  for(let y=0;y<C.height;y++){
    const spans=new Map();
    for(let x=0;x<C.width;x++){const id=C.ids[y*C.width+x];if(!id)continue;
      const s=spans.get(id);if(s){s[1]=x;s[2]=Math.max(s[2],C.distances[y*C.width+x]);}else spans.set(id,[x,x,C.distances[y*C.width+x]]);}
    for(const [id,[a,b,far]] of spans){let gaps=0;
      for(let x=a+1;x<b;x++){const k=y*C.width+x;if(!C.ids[k] && C.objCodes[k]>=57 && C.objDistances[k]>far)gaps++;}
      rows.set(id,(rows.get(id)||0)+gaps);}
  }
  const candidates=[...rows].sort((a,b)=>b[1]-a[1]);
  if(!candidates[0]?.[1])throw Error("No visible raster object/building inside a near tree's scanline span");
  return {id:candidates[0][0],visibleObjectGaps:candidates[0][1]};
})()`;

export const TREE_OBJECT_COMPARE = `(() => {
  const {complete:C,front:F,back:B}=globalThis.__j9Surfaces;
  if(C.width!==F.width || C.width!==B.width || C.height!==F.height || C.height!==B.height)throw Error("surface dimensions changed");
  let overlap=0,wrongDepth=0,holes=0,wrongHole=0;const codes=new Set();
  for(let y=0;y<F.height;y++){
    let first=F.width,last=-1;
    for(let x=0;x<F.width;x++)if(F.ids[y*F.width+x]){first=Math.min(first,x);last=x;}
    for(let x=first;x<=last;x++){
      const k=y*F.width+x,f=F.ids[k],bObj=B.objCodes[k];if(!bObj || B.ids[k])continue;
      if(f){
        if(F.distances[k]<B.objDistances[k]){
          overlap++;
          if(C.ids[k]!==f || Math.abs(C.distances[k]-F.distances[k])>.002)wrongDepth++;
        }
      }else{
        holes++;codes.add(bObj);
        if(C.ids[k]!==0 || C.objCodes[k]!==bObj || C.objIds[k]!==B.objIds[k] || Math.abs(C.objDistances[k]-B.objDistances[k])>.002)wrongHole++;
      }
    }
  }
  return {overlap,wrongDepth,holes,wrongHole,codes:[...codes]};
})()`;

// J9-5 diagnostic readback of the 2048x2048 trees' shadow map (layer 0 of tsmTex):
// measures near (<=75 m in Sun plane from camera) and far/out-of-frustum (>95 m) occluded texels,
// with A/A=0 twin readback in the same submission and saved near window for proxy vs 3D alpha-cut comparison.
export function treeShadowProbe(save: string | null = null) {
  return `(async () => {
  const R=__bh.renderer,d=R.device,tex=R.tsmTex,fr=R.tsmFrame,scp=R.earthScenery.params();
  if(!tex || tex.width<2048)throw Error("trees' shadow map not allocated");
  const W=tex.width,H=tex.height,row=W*4;
  const buf=d.createBuffer({size:row*H,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const twin=d.createBuffer({size:row*H,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try {
    const enc=d.createCommandEncoder();
    enc.copyTextureToBuffer({texture:tex,aspect:"depth-only",origin:[0,0,0]},{buffer:buf,bytesPerRow:row},[W,H,1]);
    enc.copyTextureToBuffer({texture:tex,aspect:"depth-only",origin:[0,0,0]},{buffer:twin,bytesPerRow:row},[W,H,1]);
    d.queue.submit([enc.finish()]);
    await Promise.all([buf.mapAsync(GPUMapMode.READ),twin.mapAsync(GPUMapMode.READ)]);
    const A=new Float32Array(buf.getMappedRange()),B=new Float32Array(twin.getMappedRange());
    const qx=(scp[12]??0)-fr[12],qy=(scp[13]??0)-fr[13],qz=(scp[14]??0)-fr[14];
    const rw=Math.max(fr[3],1),uw=Math.max(fr[7],1);
    const uCam=0.5+0.5*(qx*fr[0]+qy*fr[1]+qz*fr[2])/rw;
    const vCam=0.5-0.5*(qx*fr[4]+qy*fr[5]+qz*fr[6])/uw;
    const cx=Math.round(uCam*W),cy=Math.round(vCam*H),mPerTex=2*rw/W;
    let aaDelta=0,totalOccluded=0,nearOccluded=0,farOccluded=0;
    const winR=96,winW=winR*2+1,saveKey=${JSON.stringify(save)},win=saveKey?new Float32Array(winW*winW):null;
    for(let y=0;y<H;y++){
      const dy=(y-cy)*mPerTex;
      for(let x=0;x<W;x++){
        const idx=y*W+x,z=A[idx];
        if(z!==B[idx])aaDelta++;
        const dx=(x-cx)*mPerTex,dist=Math.hypot(dx,dy);
        if(z<0.9999){
          totalOccluded++;
          if(dist<=75)nearOccluded++;
          else if(dist>95)farOccluded++;
        }
        if(win && Math.abs(x-cx)<=winR && Math.abs(y-cy)<=winR){
          win[(y-(cy-winR))*winW+(x-(cx-winR))]=z;
        }
      }
    }
    if(saveKey && win){
      globalThis.__j9Shadows??={};
      globalThis.__j9Shadows[saveKey]={winW,win,totalOccluded,nearOccluded,farOccluded,tsmDraws:R.tsmDraws};
    }
    return {aaDelta,totalOccluded,nearOccluded,farOccluded,tsmDraws:R.tsmDraws,cx,cy};
  } finally {buf.destroy();twin.destroy();}
})()`;
}

export const TREE_SHADOW_COMPARE = `(() => {
  const S=globalThis.__j9Shadows;
  if(!S?.proxy || !S?.geom)throw Error("Missing saved proxy/geom shadow snapshots");
  const P=S.proxy.win,G=S.geom.win,N=P.length;
  let bothOccluded=0,carvedOpenings=0,detailAdded=0;
  for(let i=0;i<N;i++){
    const pOcc=P[i]<0.9999,gOcc=G[i]<0.9999;
    if(pOcc && gOcc)bothOccluded++;
    else if(pOcc && !gOcc)carvedOpenings++;
    else if(!pOcc && gOcc)detailAdded++;
  }
  return {
    bothOccluded,
    carvedOpenings,
    detailAdded,
    proxyNear:S.proxy.nearOccluded,
    geomNear:S.geom.nearOccluded,
    farOccluded:S.geom.farOccluded,
  };
})()`;

export const TREE_CONTACT_PROBE = `(() => {
  const R=__bh.renderer,C=R.earthScenery.contact;
  if(!C || !C.forest)throw Error("SceneryContact forest not ready");
  const scp=R.earthScenery.params(),F=C.frame;
  const q=[
    F.origin[0]+(scp[12]??0)*F.east[0]+(scp[13]??0)*F.north[0]+(scp[14]??0)*F.up[0],
    F.origin[1]+(scp[12]??0)*F.east[1]+(scp[13]??0)*F.north[1]+(scp[14]??0)*F.up[1],
    F.origin[2]+(scp[12]??0)*F.east[2]+(scp[13]??0)*F.north[2]+(scp[14]??0)*F.up[2],
  ];
  const lines=C.collisionLines(q,60);
  return {trees:lines.trees,buildings:lines.buildings,segments:lines.vertices.length/6};
})()`;
