import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { captureLoadedCharacter } from "./lib/character-ready";

afterAll(stopServer);

// (each start followed by 4 s of steps: a jump's view is carried and blended away — controller/camrig.ts, no cut —,
// the eye drawn reaches the walker's only then)
/** Walker started in a block of tree cover round him (WorldCover 10, 3 px each side alike), within 400 px. */
const TREE = `(()=>{
  const c=__bh.renderer.earthScenery.contact,b=c.reply.bounds,u=c.u,f=c.f,offset=f[2]*4,N=512;
  for(let radius=0;radius<200;radius+=2)for(let k=0;k<96;k++){
    const a=k/96*Math.PI*2,x=Math.floor(256+Math.cos(a)*radius),y=Math.floor(256+Math.sin(a)*radius);
    if(x<0||y<0||x>=N||y>=N||(u[offset+y*N+x]>>>24)!==10)continue;
    let ok=true;for(let j=-3;j<=3&&ok;j++)for(let i=-3;i<=3&&ok;i++){const xx=x+i,yy=y+j;if(xx<0||yy<0||xx>=N||yy>=N||(u[offset+yy*N+xx]>>>24)!==10)ok=false;}
    if(!ok)continue;
    const lat=b[3]-(y+.5)/N*(b[3]-b[1]),lon=b[0]+(x+.5)/N*(b[2]-b[0]);
    if(__bh.camera.character.start('earth',lat,lon)!==null)continue;
    for(let i=0;i<240;i++)__bh.step(1/60);__bh.touch();return true;
  }
  return false;
})()`;
test.skipIf(!E2E)(
  "pink CPU tree and building colliders are visible on foot and switch off",
  async () => {
    const app = await App.boot({ hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, width: 960, height: 540, tiles: true });
    try {
      await app.js(
        `(()=>{__bh.freeze(true);__bh.game.setDate('2021-06-21T15:00:00Z');Object.assign(__bh.settings,{earthScenery:'balanced',earthTerrain:true,earthSurface:'materials',earthGrass:'off',earthClouds:0,volumetricClouds:false,sceneryHitboxes:true,dynamicResolution:false,realtimeSubsampling:2,temporalReprojection:false});__bh.camera.character.start('earth',48.93,2.43);__bh.step(0);__bh.touch();return true;})()`,
      );
      await app.waitFor("__bh.renderer.earthScenery.contact && !__bh.renderer.earthScenery.pending", 120000);
      for (const kind of ["tree", "building"]) {
        // (the trees: the procedural forest's grid since 78d0a1a, no longer boxes of the scenery's hierarchy — a
        // block of WorldCover's tree cover (class 10) found in the raster round the walker, as grass-aaa finds its
        // kinds; the buildings: the hierarchy's nearest boxes)
        const found = await app.js<boolean>(
          kind === "tree"
            ? TREE
            : `(()=>{const c=__bh.renderer.earthScenery.contact,f=c.f,p=c.local(__bh.camera.character.q),candidates=[];for(let i=0;i<f[0];i++){const n=16+i*8;if(f[n+7]<0)continue;const b=(f[1]+f[n+7])*4,tree=f[b+3]<.5;if(tree!==${kind === "tree"})continue;const x=(f[n]+f[n+4])/2,y=f[n+1]-8;candidates.push({x,y,d:(x-p[0])**2+(y-p[1])**2});}candidates.sort((a,b)=>a.d-b.d);for(const point of candidates.slice(0,100)){const lat=c.reply.lat+point.y/111132,lon=c.reply.lon+point.x/(111320*Math.cos(c.reply.lat*Math.PI/180));const e=__bh.camera.character.start('earth',lat,lon);if(e!==null)continue;for(let i=0;i<240;i++)__bh.step(1/60);__bh.touch();return true;}return false;})()`,
        );
        expect(found).toBe(true);
        await app.waitFor(
          `(()=>{const e=document.querySelector('[data-testid="scenery-hitboxes"]');return e&&!e.hidden&&Number(e.dataset.${kind === "tree" ? "trees" : "buildings"})>0&&Number(e.dataset.segments)>0;})()`,
          120000,
        );
        const alignment = await app.js<{ distanceM: number; cpu: number[]; gpu: number[] }>(
          `(()=>{const c=__bh.camera.character,f=c.frame(),contact=__bh.renderer.earthScenery.contact;const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];const up=c.up(),right=cross(c.forward,up),basis=[right,up,c.forward],w=f.axes.map(a=>dot(f.origin,a));const eye=c.q.map((x,i)=>x-basis.reduce((s,b,j)=>s+b[i]*w[j],0));const cpu=contact.local(eye),params=__bh.renderer.earthScenery.params(),gpu=Array.from(params.slice(12,15));return {cpu,gpu,distanceM:Math.hypot(...cpu.map((x,i)=>x-gpu[i]))};})()`,
        );
        await Bun.write(`remote-results/pink-hitboxes-${kind}-alignment.json`, JSON.stringify(alignment, null, 2));
        expect(alignment.distanceM).toBeLessThan(0.05);
        await captureLoadedCharacter(app, `pink-hitboxes-${kind}`);
      }
      await app.js("(()=>{__bh.settings.sceneryHitboxes=false;__bh.touch();return true;})()");
      await app.waitFor(`document.querySelector('[data-testid="scenery-hitboxes"]').hidden`);
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  300000,
);
