// J9 diagnostic readback, outside timing windows: inspect the actual visibility and depth from the same submission.
export function treeSurfaceProbe(save: string | null = null) {
  return `(async () => {
  const R=__bh.renderer,d=R.device,tex=R.terrainRaster.distanceTexture(),own=R.terrainRaster.surfaceTextures();
  const width=tex.width,height=tex.height,row=Math.ceil(width*16/256)*256,dr=Math.ceil(width*4/256)*256;
  const vis=d.createBuffer({size:row*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const twin=d.createBuffer({size:row*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const depth=d.createBuffer({size:dr*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const ids=d.createBuffer({size:dr*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try {
    const enc=d.createCommandEncoder();
    enc.copyTextureToBuffer({texture:tex},{buffer:vis,bytesPerRow:row},[width,height]);
    enc.copyTextureToBuffer({texture:tex},{buffer:twin,bytesPerRow:row},[width,height]);
    enc.copyTextureToBuffer({texture:own.depth,aspect:"depth-only"},{buffer:depth,bytesPerRow:dr},[width,height]);
    enc.copyTextureToBuffer({texture:own.identity},{buffer:ids,bytesPerRow:dr},[width,height]);
    d.queue.submit([enc.finish()]);await Promise.all([vis.mapAsync(GPUMapMode.READ),twin.mapAsync(GPUMapMode.READ),depth.mapAsync(GPUMapMode.READ),ids.mapAsync(GPUMapMode.READ)]);
    const V=new Float32Array(vis.getMappedRange()),D=new Float32Array(depth.getMappedRange()),I=new Uint32Array(ids.getMappedRange());
    const T=new Float32Array(twin.getMappedRange());
    let pixels=0,twinPixels=0,validDepth=0,identified=0,sky=0;const samples=[];
    const save=${JSON.stringify(save)}, cellIds=save?new Uint32Array(width*height):null, distances=save?new Float32Array(width*height):null, counts=new Map();
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const k=y*row/4+x*4,a=V[k+3];
      if(T[k+1]>.5 && T[k+3]>=131072 && T[k+3]<262144)twinPixels++;
      if(V[k+1]>.5 && a>=131072 && a<262144){pixels++;const z=D[y*dr/4+x];
        if(save){const id=V[k+1];cellIds[y*width+x]=id;distances[y*width+x]=V[k+2];counts.set(id,(counts.get(id)||0)+1);}
        if(Number.isFinite(z)&&z>0&&V[k+2]>0)validDepth++;
        if(I[y*dr/4+x]!==0)identified++;
        if(V[k]===0)sky++;
        if(samples.length<4)samples.push({x,y,vis:Array.from(V.subarray(k,k+4)),depth:z,id:I[y*dr/4+x]});
      }
    }
    if(save){globalThis.__j9Surfaces??={};globalThis.__j9Surfaces[save]={width,height,ids:cellIds,distances};}
    return {aaDelta:Math.abs(pixels-twinPixels),pixels,validDepth,identified,sky,samples,trees:[...counts].sort((a,b)=>b[1]-a[1])};
  } finally {vis.destroy();twin.destroy();depth.destroy();ids.destroy();}
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
