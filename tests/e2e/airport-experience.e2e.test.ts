import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import observations from "../../docs/progress/airport-motion/observations.json";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
// Deterministic airport experience: real-weather authority, labelled provenance, the Airbus, CRJ and Boeing representations,
// traffic lamps in the depth-tested GPU pass, and restoring the weather when the mode is left.
// Duration: ~2 min (Earth and aircraft compilation; no live ADS-B required).
// Done when: the airport panel shows its fixture METAR, the aircraft have valid poses, GPU lamps render without errors.
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
    // Advance attitude smoothing, then keep the delayed sample within the fixture history during slow compiles.
    await app.js(`(()=>{
      const c=__bh.camera,T=Date.now()/1000,start=performance.now();c.trafficClock=()=>T+Math.min(20,(performance.now()-start)/1000);c.s.trafficDelay=30;c.trafficRigMax=1;__bh.renderer.trafficRigShare=0;__bh.airport.mode("cinema");
      c.traffic={planes:new Map(),ships:new Map()};
      ["A320","CRJ9","B738","B744","B772","B77W","A321"].forEach((type,i)=>{const p={id:"ee000"+i,cs:"TEST "+type,reg:"",type,cat:"A3",lat:48.96+i*0.004,lon:2.44+i*0.003,alt:300,gs:70,trk:0,hdg:0,vs:0,roll:0,gnd:false,t:T,src:"adsb.lol"};c.traffic.planes.set(p.id,{p,prev:null,hist:[{...p,lat:p.lat-4200/111132.95,t:T-60},p],heard:T});});
      __bh.refresh();return true;
    })()`);
    await app.waitFor(`__bh.camera.trafficNow().length===7 && __bh.renderer.trafficLamps.length>0`, 30_000);
    await app.settled(120_000);
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
      expect(c.source).toBe("observed");
      expect(c.airspeed).toBeGreaterThan(70);
      expect(c.crab).toBeGreaterThan(0);
    }
    expect(state.lamps).toBeGreaterThan(0);
    for (const model of ["a320", "a320t", "crj900", "b738", "b744", "b772", "b77w"]) expect(state.models).toContain(model);
    const caption = await app.js<string>(`document.querySelector("[data-testid=airport-caption]")?.textContent ?? ""`);
    expect(caption).not.toContain("Landed");
    await app.shot(`${OUT}/airport.png`);
    const weatherHit = await app.hit("[data-testid=airport-weather-game]");
    await app.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...weatherHit });
    await app.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...weatherHit, button: "left", clickCount: 1 });
    await Bun.sleep(400); // intentionally hold across a complete 250 ms telemetry refresh
    await app.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...weatherHit, button: "left", clickCount: 1 });
    await app.waitFor(`__bh.settings.weather==='fair'`, 5000);
    await app.click("[data-testid=airport-weather-real]");
    await app.step("2. inspect each Boeing exterior from the airport drone");
    await app.js(`(__bh.game.setDate("2026-06-21T12:00:00Z"), __bh.airport.mode("drone"), true)`);
    await app.waitFor(`!!document.querySelector('[data-testid=airport-ui-row-ee0000]')`, 10000);
    await app.js(`(document.querySelector('[data-testid=airport-ui-row-ee0000]').click(),true)`);
    await app.waitFor(
      `document.querySelector('.au-card-title')?.textContent.includes('A320') && document.querySelector('.airport-transition').hidden`,
      10000,
    );
    for (const [index, model] of ["b738", "b744", "b772", "b77w"].entries()) {
      const id = "ee000" + (index + 2);
      const row = `document.querySelector('[data-testid="airport-ui-row-${id}"]')`;
      await app.waitFor(`!!(${row})`, 10000);
      await app.js(`(${row}.click(),true)`);
      if (index === 0) {
        await app.waitFor(`!document.querySelector('.airport-transition').hidden`, 5000);
        expect(await app.js<string>(`document.querySelector('.airport-transition').textContent`)).toContain("B738");
        await app.shot(`${OUT}/flight-transition.png`);
      }
      await app.waitFor(
        `__bh.airport.state().current === "${id}" && __bh.airport.state().shot === "drone" && __bh.renderer.combatOthers.some(o=>o.id === "${model}" && Math.hypot(...o.rel)<400)`,
        15000,
      );
      await app.settled(60000);
      await app.shot(`${OUT}/${model}.png`);
    }
    await app.step("3. all twelve camera modes remain directly accessible");
    for (const mode of [
      "cinema",
      "auto",
      "tower",
      "threshold",
      "touchdown",
      "rotation",
      "climbout",
      "lineup",
      "wing",
      "chase",
      "cockpit",
      "drone",
    ]) {
      await app.click(`[data-testid=airport-ui-mode-${mode}]`);
      await app.waitFor(`__bh.airport.state().mode === "${mode}"`, 5000);
      expect(await app.js<string>(`document.querySelector('[data-testid=airport-ui-mode-${mode}]').getAttribute('aria-pressed')`)).toBe(
        "true",
      );
    }
    await app.click("[data-testid=airport-ui-fold]");
    expect(
      await app.js<number>(
        `[...document.querySelectorAll('[data-testid^=airport-ui-mode-]')].filter(e=>e.getBoundingClientRect().height>0).length`,
      ),
    ).toBe(12);
    await app.click("[data-testid=airport-ui-fold]");
    await app.click("[data-testid=airport-ui-camera-settings]");
    await app.waitFor(`!document.querySelector('#cam-pop').hidden`, 5000);
    await app.click("#cam-pop .cp-x");
    await app.click("[data-testid=airport-ui-bars]");
    await app.waitFor(`document.querySelector('.airport-bars').hidden`, 5000);
    await app.click("[data-testid=airport-ui-bars]");
    await app.waitFor(`!document.querySelector('.airport-bars').hidden`, 5000);
    await app.waitFor(`!!document.querySelector('.au-card')`, 10000);
    expect(
      await app.js<boolean>(
        `(()=>{const card=document.querySelector('.au-card').getBoundingClientRect(),dock=document.querySelector('.au-director').getBoundingClientRect();return card.bottom<=dock.top})()`,
      ),
    ).toBe(true);
    await app.step("3. switch between game weather and METAR without a frame overriding the choice");
    await app.click("[data-testid=airport-weather-game]");
    await app.waitFor(`__bh.settings.weather === "fair"`, 5000);
    await app.js(
      `(()=>{const s=document.querySelector('[data-testid=airport-weather-preset]');s.value='storm';s.dispatchEvent(new Event('change'));return true})()`,
    );
    await app.waitFor(`__bh.settings.weather === "storm" && __bh.camera.trafficAirport?.weather?.kind === "storm"`, 5000);
    await app.settled(60000);
    expect(await app.js<string>(`__bh.settings.weather`)).toBe("storm");
    expect(await app.js<string>(`document.querySelector('[data-testid=airport-ui-clock]').textContent`)).toContain("Europe/Paris");
    await app.shot(`${OUT}/airport-game-weather.png`);
    await app.click("[data-testid=airport-weather-real]");
    await app.waitFor(`__bh.settings.weather === "real" && __bh.camera.trafficAirport?.weather?.source === "metar"`, 5000);
    await app.step("3. restore weather after leaving");
    await app.js(`(__bh.airport.stop(),true)`);
    await app.waitFor(`__bh.settings.weather==="fair"`, 5000);
    expect(app.cdp.errors).toEqual([]);
  }, 200_000);
  test("five-minute Heathrow observation replay: delayed departure rolls before lifting off", async () => {
    const history = observations.tracks["4b1806"];
    const i = history.findIndex((p, i) => i > 0 && !p.gnd && history[i - 1]!.gnd);
    const a = history[i - 1]!,
      b = history[i]!;
    await app.js(`__bh.airport.start("EGLL", "wing")`);
    await app.js(
      `(()=>{const c=__bh.camera,h=${JSON.stringify(history)}.map(p=>({...p,type:'A320',cs:'REPLAY SWR46K'}));globalThis.__motionT=${a.t + 5};c.trafficClock=()=>globalThis.__motionT+120;c.s.trafficDelay=120;c.s.weather='fair';c.traffic={planes:new Map([['4b1806',{p:h.at(-1),prev:h.at(-2),hist:h,heard:${b.t}}]]),ships:new Map()};__bh.airport.activity(false);__bh.refresh();return true})()`,
    );
    await app.waitFor(`!!document.querySelector('[data-testid=airport-ui-row-4b1806]')`, 10000);
    await app.js(`(document.querySelector('[data-testid=airport-ui-row-4b1806]').click(),true)`);
    await app.waitFor(`__bh.camera.trafficNow().find(c=>c.id==='4b1806')?.phase === 'takeoff'`, 30000);
    const early = await app.js<{ gnd: boolean; over: number }>(
      `(()=>{const c=__bh.camera.trafficNow().find(c=>c.id==='4b1806');return {gnd:c.gnd,over:c.over}})()`,
    );
    expect(early.gnd).toBe(true);
    expect(early.over).toBe(0);
    await app.settled(60000);
    await app.shot(`${OUT}/observed-departure-roll.png`);
    await app.js(
      `(()=>{const c=__bh.camera;for(let t=${a.t + 5};t<${b.t - 0.1};t+=.1){globalThis.__motionT=t;c.trafficNow()}return true})()`,
    );
    await app.waitFor(`__bh.camera.trafficNow().find(c=>c.id==='4b1806')?.gnd === false`, 10000);
    const air = await app.js<{ over: number; gear: number; pitch: number }>(
      `(()=>{const c=__bh.camera.trafficNow().find(c=>c.id==='4b1806');return {over:c.over,gear:c.gear,pitch:c.pitch}})()`,
    );
    expect(air.over).toBeGreaterThan(0);
    expect(air.gear).toBeGreaterThan(0.9);
    expect(air.pitch).toBeGreaterThan(0);
    await app.waitFor(
      `(()=>{const c=__bh.camera.trafficNow().find(c=>c.id==='4b1806');const r=Math.hypot(...c.p);return c.v.reduce((s,v,i)=>s+v*c.p[i]/r,0)>1})()`,
      10000,
    );
    await app.waitFor(`parseFloat(document.querySelector('.au-card .au-telemetry > div:last-child strong')?.textContent ?? '') > 1`, 10000);
    await app.shot(`${OUT}/observed-departure-air.png`);
    expect(app.cdp.errors).toEqual([]);
    await app.js(`(__bh.airport.stop(),true)`);
  }, 180000);
});
