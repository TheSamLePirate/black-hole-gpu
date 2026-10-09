import { expect, test } from "bun:test";
import { keyCatalog, resolveBody, resolveSite } from "../src/ai/game-tools";
import { checkSetting, findSettings } from "../src/ai/settings-tools";
import { orderReply, parseOrders } from "../src/ai/offline-orders";
import { defaultSettings } from "../src/settings";

// PLAN-TARS-AGENT A2: what TARS's tools resolve before they act — a body or a site by its name in either
// language, every key of the game, a setting found by words (French too) and a value checked against the
// schema (a choice among its options, a number in its range).

test("bodies and sites by name, English or French", () => {
  expect(resolveBody("Lune")).toBe("moon");
  expect(resolveBody("moon")).toBe("moon");
  expect(resolveBody("la Terre".replace("la ", ""))).toBe("earth");
  expect(resolveBody("Saturne")).toBe("saturn");
  expect(resolveBody("Gargantua")).toBe("hole");
  expect(resolveBody("station spatiale")).toBe("iss");
  expect(resolveBody("Ganymède")).toBe("ganymede");
  expect(resolveBody("Miller")).toBe("miller");
  expect(resolveBody("Narnia")).toBeNull();
  expect(resolveSite("Edwards")?.icao).toBe("KEDW");
  expect(resolveSite("bourget")?.body).toBe("earth");
  expect(resolveSite("Jezero")?.body).toBe("mars");
  expect(resolveSite("Edwards", "mars")).toBeNull();
});

test("every key action of the game, by id", () => {
  const ids = keyCatalog().map((k) => k.id);
  for (const id of [
    "auto:land",
    "auto:entry",
    "hold:prograde",
    "gear",
    "map",
    "missions",
    "quality:game",
    "warp:1",
    "quickSave",
    "constellations",
  ])
    expect(ids).toContain(id);
  expect(ids).not.toContain("held");
  expect(new Set(ids).size).toBe(ids.length);
});

test("settings found by words in either language; values checked against the schema", () => {
  const s = defaultSettings();
  expect(findSettings("musique", s).map((d) => d.key)).toContain("music");
  expect(findSettings("crash speed", s)[0]!.key).toBe("crashSpeed");
  const wind = findSettings("vent", s).find((d) => d.key === "wind")!;
  expect(wind.type).toBe("choice");
  expect(checkSetting("wind", "9", s)).toEqual({ ok: false, error: "wind must be one of 0, 1, 2, 3" });
  expect(checkSetting("wind", "2", s)).toEqual({ ok: true, value: 2 });
  expect(checkSetting("music", "false", s)).toEqual({ ok: true, value: false });
  expect(checkSetting("music", "non", s)).toEqual({ ok: true, value: false });
  expect(checkSetting("crashSpeed", 500, s).ok).toBe(false);
  expect(checkSetting("crashSpeed", "20", s)).toEqual({ ok: true, value: 20 });
  expect(checkSetting("waterColor", "#12AB34", s)).toEqual({ ok: true, value: "#12ab34" });
  expect(checkSetting("nope", 1, s).ok).toBe(false);
  // (a choice by its label)
  expect(checkSetting("flightMode", "Plane", s)).toEqual({ ok: true, value: "plane" });
});

test("offline: the common orders turned into the tools' calls (A4); questions are not orders", () => {
  const o = (q: string) => parseOrders(q).map((x) => `${x.tool} ${JSON.stringify(x.args)}`);
  expect(o("Vise Mars, puis passe le temps à 100 fois.")).toEqual(['set_target {"name":"mars"}', 'time {"warp":100}']);
  expect(o("Pose-nous à Edwards")).toEqual(['autopilot {"mode":"entry","site":"edwards"}']);
  expect(o("Land")).toEqual(['autopilot {"mode":"land"}']);
  expect(o("Décolle vers 300 km")).toEqual(['autopilot {"mode":"takeoff","altKm":300}']);
  expect(o("Sors le train")).toEqual(['controls {"gear":true}']);
  expect(o("gear up")).toEqual(['controls {"gear":false}']);
  expect(o("Téléporte-nous en orbite de 100 km autour de la Lune")).toEqual(['place_ship {"mode":"orbit","body":"lune","altKm":100}']);
  expect(o("Passe en vue cockpit et ouvre la carte")).toEqual(['camera {"mount":"cockpit"}', 'interface {"map":true}']);
  expect(o("temps réel")).toEqual(['time {"warp":1}']);
  expect(o("oublie tout")).toEqual(['memory {"action":"clear"}']);
  expect(o("Coupe l'autopilote")).toEqual(['autopilot {"mode":"none"}']);
  expect(o("warp 1000")).toEqual(['time {"warp":1000}']);
  for (const q of ["Comment ça va ?", "Où sommes-nous ?", "How much fuel?", "Raconte une blague"]) expect(o(q)).toEqual([]);
  expect(orderReply("fr", [{ tool: "a", ok: true }])).toBe("C'est fait.");
  expect(orderReply("en", [{ tool: "a", ok: false, error: "no runway" }])).toBe("Couldn't: no runway.");
});
