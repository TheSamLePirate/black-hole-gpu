import { expect, test } from "bun:test";
import { AirportAtc, type AtcMove, runwaySpoken, spell, telephony, towerName } from "../src/traffic/atc";

// The airport's radio (docs/PLAN-AEROPORT-AAA.md V10 — src/traffic/atc.ts): the exchanges made from the movements, each said once, in
// ICAO phraseology — the callsigns in radiotelephony, the runways and figures digit by digit.

test("the words: callsigns, runways, the tower's name", () => {
  expect(telephony("DAL2534")).toBe("Delta two five three four");
  expect(telephony("BAW117")).toBe("Speedbird one one seven");
  expect(telephony("SKW225X")).toBe("Skywest two two five X-ray");
  // (a designator unknown, a registration: spelled; a transponder's « 00000000 »: its registration)
  expect(telephony("ZZZ12")).toBe("Zulu Zulu Zulu one two");
  expect(telephony("N302NB")).toBe("November three zero two November Bravo");
  expect(telephony("00000000", "N288AK")).toBe("November two eight eight Alfa Kilo");
  expect(spell("9")).toBe("niner");
  expect(runwaySpoken("24R")).toBe("two four right");
  expect(runwaySpoken("7L")).toBe("zero seven left");
  expect(runwaySpoken("25")).toBe("two five");
  expect(towerName("Los Angeles International Airport")).toBe("Los Angeles");
  expect(towerName("Paris-Charles de Gaulle Airport")).toBe("Paris Charles de Gaulle");
});

test("an arrival and a departure: their exchanges in order, each once", () => {
  const atc = new AirportAtc("Los Angeles");
  const arr: AtcMove = { id: "a", cs: "DAL2534", reg: "N368NB", dep: false, gnd: false, eta: 60, speed: 72, over: 250, runway: "24R" };
  const dep: AtcMove = { id: "d", cs: "SWA4411", reg: "", dep: true, gnd: true, eta: 50, speed: 0, over: 0, runway: "25R" };
  // (far out: nothing yet; the departure lined up and still: ready, line up and wait)
  let L = atc.step([{ ...arr, eta: 140 }, dep]);
  expect(L.map((l) => l.text)).toEqual([
    "Los Angeles Tower, Southwest four four one one, holding short runway two five right, ready for departure.",
    "Southwest four four one one, runway two five right, line up and wait.",
    "Line up and wait runway two five right, Southwest four four one one.",
  ]);
  // (a minute out: its call — 60 s at 72 m/s, two miles —, cleared to land, the read-back; said once)
  L = atc.step([arr, dep]);
  expect(L.map((l) => `${l.who}: ${l.text}`)).toEqual([
    "pilot: Los Angeles Tower, Delta two five three four, two mile final runway two four right.",
    "tower: Delta two five three four, Los Angeles Tower, runway two four right, cleared to land.",
    "pilot: Cleared to land runway two four right, Delta two five three four.",
  ]);
  expect(atc.step([arr, dep])).toEqual([]);
  // (the departure rolling: cleared for takeoff; climbing past 300 m: Departure; the arrival rolled out: Ground)
  expect(atc.step([{ ...dep, speed: 20, eta: 25 }]).map((l) => l.text)[0]).toBe(
    "Southwest four four one one, runway two five right, cleared for takeoff.",
  );
  expect(atc.step([{ ...dep, gnd: false, eta: -30, over: 400, speed: 90 }]).map((l) => l.text)[0]).toBe(
    "Southwest four four one one, contact Departure, good day.",
  );
  expect(atc.step([{ ...arr, gnd: true, eta: -25, speed: 20, over: 0 }]).map((l) => l.who)).toEqual(["tower", "pilot"]);
});
