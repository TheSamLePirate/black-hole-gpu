import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
// Deterministic airport experience: real-weather authority, labelled provenance, the Airbus, CRJ and Boeing representations,
// traffic lamps in the depth-tested GPU pass, and restoring the weather when the mode is left.
// Duration: ~4 min (Earth and aircraft compilation; no live ADS-B required).
// Done when: seven exteriors have humid wing emissions, uploaded trail segments, captures and no GPU errors.
const VIEW = process.env.AIRLINER_SKIN ? "wing" : "drone";
const OUT = process.env.AIRLINER_SKIN ? "remote-results/airliner-skin" : "remote-results/airliner-fx";
describe.skipIf(!E2E)("airliner effects and exterior quality", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({
      hash: "scene=game:artemis",
      width: 1440,
      height: 900,
      initScript: `(()=>{const original=fetch;globalThis.fetch=(input,options)=>{const url=String(input instanceof Request?input.url:input);if(url.includes("metar.vatsim.net"))return Promise.resolve(new Response("LFPB 262200Z 09020KT 9999 SCT020 15/15 Q1013"));if(url.includes("overpass"))return Promise.resolve(Response.json({elements:[]}));return original(input,options);};})()`,
    });
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });
  test("airport weather overrides a preset and the GPU receives lamps for each model", async () => {
    await app.step("1. airport weather and deterministic aircraft");
    await app.js(`(__bh.settings.weather="fair",true)`);
    await app.js(`__bh.airport.start("LFPB","tower")`);
    await app.waitFor(`document.querySelector("[data-testid=airport-ui-metar]")?.textContent.includes("09020KT")`, 30_000);
    // Advance attitude smoothing, then keep the delayed sample within the fixture history during slow compiles.
    await app.js(`(()=>{
      const c=__bh.camera,T=Date.now()/1000,start=performance.now();c.trafficClock=()=>T+(performance.now()-start)/1000;c.s.trafficDelay=30;c.trafficRigMax=1;__bh.renderer.trafficRigShare=0;__bh.airport.mode("cinema");
      c.traffic={planes:new Map(),ships:new Map()};
      ["A320","CRJ9","B738","B744","B772","B77W","A321"].forEach((type,i)=>{const p={id:"ee000"+i,cs:"TEST "+type,reg:"",type,cat:"A3",lat:48.96+i*0.004,lon:2.44+i*0.003,alt:300,gs:70,trk:0,hdg:0,vs:0,roll:0,gnd:false,t:T,src:"adsb.lol"};c.traffic.planes.set(p.id,{p,prev:null,hist:[{...p,lat:p.lat-4200/111132.95,t:T-60},p],heard:T});});
      __bh.refresh();return true;
    })()`);
    await app.waitFor(`__bh.camera.trafficNow().length===7 && __bh.renderer.trafficLamps.length>0`, 30_000);
    await app.settled(180_000);
    await app.waitFor(`["b738","b744","b772","b77w"].every(id=>__bh.renderer.ship?.has(id))`, 60000);
    const state = await app.js<any>(
      `({weather:__bh.settings.weather,source:__bh.camera.trafficAirport?.weather?.source,craft:__bh.camera.trafficNow().map(c=>({type:c.type,crab:c.crab,airspeed:c.airspeed,source:c.provenance,finite:[...c.p,...c.fwd].every(Number.isFinite)})),models:__bh.camera.trafficShips(__bh.camera.viewController()).map(c=>c.id),lamps:__bh.renderer.trafficLamps.length})`,
    );
    console.log(JSON.stringify(state));
    expect(state.weather).toBe("real");
    expect(state.source).toBe("metar");
    expect(state.craft).toHaveLength(7);
    for (const c of state.craft) {
      expect(c.finite).toBe(true);
      expect(["observed", "reconstructed"]).toContain(c.source);
      expect(c.airspeed).toBeGreaterThan(70);
      expect(c.crab).toBeGreaterThan(0);
    }
    expect(state.lamps).toBeGreaterThan(0);
    for (const model of ["a320", "a320t", "crj900", "b738", "b744", "b772", "b77w"]) expect(state.models).toContain(model);
    const caption = await app.js<string>(`document.querySelector("[data-testid=airport-caption]")?.textContent ?? ""`);
    expect(caption).not.toContain("Landed");
    await app.shot(`${OUT}/airport.png`);
    await app.step("2. inspect every exterior and its humid wing condensation");
    await app.js(`(__bh.game.setDate("2026-06-21T12:00:00Z"), __bh.airport.mode("${VIEW}"), true)`);
    await app.js(`(globalThis.__fixturePlanes=new Map(__bh.camera.traffic.planes),true)`);
    for (const [index, model] of ["a320", "crj900", "b738", "b744", "b772", "b77w", "a320t"].entries()) {
      if (process.env.AIRLINER_MODEL && process.env.AIRLINER_MODEL !== model) continue;
      await app.step(`condensation and occlusion: ${model}`);
      const id = "ee000" + index;
      if (model === "a320t") await app.js(`(__bh.renderer.trafficRigShare=1000,true)`);
      await app.js(`(__bh.camera.traffic.planes=new Map(globalThis.__fixturePlanes),true)`);
      const row = `document.querySelector('[data-testid="airport-ui-row-${id}"]')`;
      await app.waitFor(`!!(${row})`, 10000);
      await app.js(
        `(()=>{${row}.click();const c=__bh.camera;c.traffic.planes=new Map([["${id}",globalThis.__fixturePlanes.get("${id}")]]);c.contrails.clear();return true;})()`,
      );
      await app.waitFor(
        `__bh.airport.state().current === "${id}" && __bh.airport.state().shot === "${VIEW}" && __bh.renderer.combatOthers.some(o=>(o.id === "${model}" || o.alt?.id === "${model}") && Math.hypot(...o.rel)<400)`,
        15000,
      );
      await app.settled(60000);
      await app.waitFor(
        `(()=>{const sources=__bh.camera.contrailStep?.src.filter(s=>s.key.startsWith("x${id}"))??[];const segments=__bh.renderer.shipContrails?.n??0;if(sources.some(s=>s.kind===3)&&segments>0){globalThis.__fxEvidence={sources,segments};return true;}return false;})()`,
        15000,
      );
      const fx = await app.js<any>(`globalThis.__fxEvidence`);
      expect(fx.sources.length).toBeGreaterThan(0);
      expect(fx.segments).toBeGreaterThan(0);
      console.log(
        model,
        JSON.stringify({ sources: fx.sources.map((s: any) => ({ key: s.key, kind: s.kind, str: s.str })), segments: fx.segments }),
      );
      if (model === "a320") {
        const pointers = await app.js<number[]>(
          `(()=>{const a=__bh.renderer.ship.instData,out=[];for(let i=0;i<40;i++)if(a[i*20+16]===21)out.push(a[i*20+19]);return out;})()`,
        );
        expect(pointers.length).toBeGreaterThan(0);
        for (const base of pointers) {
          expect(base).toBeGreaterThanOrEqual(40);
          expect(base).toBeLessThan(40 + 8 * 192);
        }
      }
      await app.shot(`${OUT}/${model}.png`);
      if (process.env.AIRLINER_SKIN) continue;
      await app.js(`(__bh.airport.mode("chase"),true)`);
      await app.waitFor(`__bh.airport.state().shot==="chase"`, 10000);
      await app.settled(60000);
      await app.shot(`${OUT}/${model}-chase.png`);
      await app.js(`(__bh.airport.mode("${VIEW}"),true)`);
      await app.step(`cruise exhausts: ${model}`);
      await app.js(
        `(()=>{const c=__bh.camera,T=Date.now()/1000,start=performance.now(),old=globalThis.__fixturePlanes.get("${id}").p;const p={...old,alt:11000,gs:230,t:T};c.trafficClock=()=>T+(performance.now()-start)/1000;c.traffic.planes=new Map([[p.id,{p,prev:null,hist:[{...p,lat:p.lat-13800/111132.95,t:T-60},p],heard:T}]]);c.contrails.clear();__bh.refresh();return true;})()`,
      );
      await app.waitFor(
        `__bh.camera.contrailStep?.src.filter(s=>s.key.startsWith("a${id}:") && s.kind===0).length===${model === "b744" ? 4 : 2}`,
        30000,
      );
      await app.waitFor(`__bh.camera.contrails.trails.some(t=>t.key.startsWith("a${id}:")&&t.pts.length>8)`, 15000);
      await app.waitFor(`(()=>{const p=__bh.camera.trafficNow().find(p=>p.id==="${id}");return p&&p.airspeed>190&&p.gear<0.05;})()`, 60000);
      await app.settled(90000);
      await app.shot(`${OUT}/${model}-cruise.png`);
      await app.js(
        `(()=>{const c=__bh.camera,T=globalThis.__fixturePlanes.get("${id}").p.t,start=performance.now();c.trafficClock=()=>T+10+(performance.now()-start)/1000;return true;})()`,
      );
    }
    await app.step("3. restore weather after leaving");
    await app.js(`(__bh.airport.stop(),true)`);
    await app.waitFor(`__bh.settings.weather==="fair"`, 5000);
    expect(app.cdp.errors).toEqual([]);
  }, 720_000);
});
