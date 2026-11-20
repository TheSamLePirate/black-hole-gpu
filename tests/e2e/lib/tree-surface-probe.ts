// J9 diagnostic readback, outside timing windows: inspect the actual visibility and depth from the same submission.
export const TREE_SURFACE_PROBE = `(async () => {
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
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const k=y*row/4+x*4,a=V[k+3];
      if(T[k+1]>.5 && T[k+3]>=131072 && T[k+3]<262144)twinPixels++;
      if(V[k+1]>.5 && a>=131072 && a<262144){pixels++;const z=D[y*dr/4+x];
        if(Number.isFinite(z)&&z>0&&V[k+2]>0)validDepth++;
        if(I[y*dr/4+x]!==0)identified++;
        if(V[k]===0)sky++;
        if(samples.length<4)samples.push({x,y,vis:Array.from(V.subarray(k,k+4)),depth:z,id:I[y*dr/4+x]});
      }
    }
    return {aaDelta:Math.abs(pixels-twinPixels),pixels,validDepth,identified,sky,samples};
  } finally {vis.destroy();twin.destroy();depth.destroy();ids.destroy();}
})()`;
