import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
// Deterministic airport experience: real-weather authority, labelled provenance, all three aircraft representations,
// traffic lamps in the depth-tested GPU pass, and restoring the weather when the mode is left.
// Duration: ~2 min (Earth and aircraft compilation; no live ADS-B required).
// Done when: the airport panel shows its fixture METAR, the three aircraft have valid poses, GPU lamps render without errors.
const OUT = "remote-results/airport-experience";
describe.skipIf(!E2E)("airport experience: weather and traffic integration", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({
      hash: "scene=game:artemis",
      width: 1440,
      height: 900,
      initScript: `(()=>{const original=fetch;globalThis.fetch=(input,options)=>{const url=String(input instanceof Request?input.url:input);if(url.includes("metar.vatsim.net"))return Promise.resolve(new Response("LFPB 262200Z 09020KT 9999 SCT020 15/10 Q1013"));if(url.includes("overpass"))return Promise.resolve(Response.json({elements:[]}));return original(input,options);};})()`,
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
    await app.js(`(()=>{
      const c=__bh.camera,T=Date.now()/1000,start=performance.now();c.trafficClock=()=>T+(performance.now()-start)/1000;c.s.trafficDelay=30;c.trafficRigMax=0;__bh.renderer.trafficRigShare=0;__bh.airport.mode("cinema");
      c.traffic={planes:new Map(),ships:new Map()};
      ["A320","CRJ9","B738"].forEach((type,i)=>{const p={id:"ee000"+i,cs:"TEST "+type,reg:"",type,cat:"A3",lat:48.96+i*0.004,lon:2.44+i*0.003,alt:300,gs:70,trk:0,hdg:0,vs:0,roll:0,gnd:false,t:T,src:"adsb.lol"};c.traffic.planes.set(p.id,{p,prev:null,hist:[{...p,lat:p.lat-4200/111132.95,t:T-60},p],heard:T});});
      __bh.refresh();return true;
    })()`);
    await app.waitFor(`__bh.camera.trafficNow().length===3 && __bh.renderer.trafficLamps.length>0`, 30_000);
    await app.settled(120_000);
    const state = await app.js<any>(
      `({weather:__bh.settings.weather,source:__bh.camera.trafficAirport?.weather?.source,craft:__bh.camera.trafficNow().map(c=>({type:c.type,crab:c.crab,airspeed:c.airspeed,source:c.provenance,finite:[...c.p,...c.fwd].every(Number.isFinite)})),models:__bh.camera.trafficShips(__bh.camera.viewController()).map(c=>c.id),lamps:__bh.renderer.trafficLamps.length})`,
    );
    console.log(JSON.stringify(state));
    expect(state.weather).toBe("real");
    expect(state.source).toBe("metar");
    expect(state.craft).toHaveLength(3);
    for (const c of state.craft) {
      expect(c.finite).toBe(true);
      expect(c.source).toBe("observed");
      expect(c.airspeed).toBeGreaterThan(70);
      expect(c.crab).toBeGreaterThan(0);
    }
    expect(state.lamps).toBeGreaterThan(0);
    for (const model of ["a320", "a320t", "crj900"]) expect(state.models).toContain(model);
    const caption = await app.js<string>(`document.querySelector("[data-testid=airport-caption]")?.textContent ?? ""`);
    expect(caption).not.toContain("Landed");
    await app.shot(`${OUT}/airport.png`);
    await app.step("2. restore weather after leaving");
    await app.js(`(__bh.airport.stop(),true)`);
    await app.waitFor(`__bh.settings.weather==="fair"`, 5000);
    expect(app.cdp.errors).toEqual([]);
  }, 200_000);
});
