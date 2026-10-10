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

test("commands, skills and mentions: parsed and completed as typed (C1–C2, C5)", async () => {
  const { complete, parseCommand, unmention } = await import("../src/ai/commands");
  const ctx = {
    models: [
      { id: "z-ai/glm-5.3-flash", name: "GLM-5.3 Flash" },
      { id: "anthropic/claude-haiku-5.5", name: "Claude Haiku 5.5" },
    ],
    screens: ["map_globe", "entry_corridor"],
    bodies: [
      { id: "moon", name: "Lune" },
      { id: "mars", name: "Mars" },
    ],
    sites: [{ name: "Le Bourget", body: "earth" }],
    settings: [{ key: "music", label: "Musique" }],
    notes: ["Le pilote s'appelle Cooper"],
    skills: [{ name: "retour", description: "Rentrer au Bourget", prompt: "Ramène-nous au Bourget", at: 0 }],
  };
  // ("/": the commands and his skills; "/mo": model, mode, the Moon's way)
  expect(complete("/mo", ctx).map((s) => s.label)).toEqual(["/model <modèle>", "/mode act|plan|watch", "/moonpath <mode> <date>"]);
  expect(complete("/re", ctx).map((s) => s.label)).toContain("/retour");
  // (an argument's values, by value or hint)
  expect(complete("/model hai", ctx).map((s) => s.text)).toEqual(["/model anthropic/claude-haiku-5.5"]);
  expect(complete("/mode p", ctx).map((s) => s.text)).toEqual(["/mode plan"]);
  // (mentions: a body, a site with its spaces quoted)
  expect(complete("emmène-nous vers @lu", ctx).map((s) => s.text)).toEqual(["emmène-nous vers @Lune "]);
  expect(complete("pose-nous au @bo", ctx).map((s) => s.text)).toEqual(['pose-nous au @"Le Bourget" ']);
  expect(complete("bonjour", ctx)).toEqual([]);
  expect(parseCommand("/model glm")).toEqual({ name: "model", arg: "glm" });
  expect(parseCommand("/retour vite", ctx.skills)?.skill?.prompt).toBe("Ramène-nous au Bourget");
  expect(parseCommand("/nope")).toBeNull();
  expect(parseCommand("vise Mars")).toBeNull();
  expect(unmention('pose-nous au @"Le Bourget" puis vise @Mars')).toBe("pose-nous au Le Bourget puis vise Mars");
});

test("every game action as a / command: read by position or by name, completed as typed (C6)", async () => {
  const { gameCall, completeGame } = await import("../src/ai/game-commands");
  const tools: import("../src/ai/tool-schema").ToolSpec[] = [
    { name: "set_target", description: "", params: { name: { type: "string" as const } } },
    {
      name: "camera",
      description: "",
      params: {
        mount: { type: "string" as const, enum: ["cockpit", "chase"] },
        shipView: { type: "boolean" as const },
        spectator: { type: "boolean" as const },
      },
    },
    {
      name: "place_ship",
      description: "",
      params: {
        mode: { type: "string" as const, enum: ["orbit", "ground", "glide"] },
        body: { type: "string" as const },
        site: { type: "string" as const },
        altKm: { type: "number" as const },
      },
    },
    { name: "controls", description: "", params: { gear: { type: "boolean" as const }, throttle: { type: "number" as const } } },
    { name: "set_settings", description: "", params: { changes: { type: "array" as const, items: { type: "string" as const } } } },
    {
      name: "set_date",
      description: "",
      params: { date: { type: "string" as const }, hours: { type: "number" as const }, now: { type: "boolean" as const } },
    },
  ];
  const sites = ["Edwards Air Force Base", "Paris - Le Bourget"];
  expect(gameCall("/target Lune", tools)).toEqual({ tool: "set_target", args: { name: "Lune" } });
  expect(gameCall("/cockpit", tools)).toEqual({ tool: "camera", args: { mount: "cockpit" } });
  expect(gameCall("/teleport orbit Lune 100", tools, sites)).toEqual({
    tool: "place_ship",
    args: { mode: "orbit", body: "Lune", altKm: 100 },
  });
  expect(gameCall("/teleport glide edwards", tools, sites)).toEqual({ tool: "place_ship", args: { mode: "glide", site: "edwards" } });
  expect(gameCall("/teleport orbit body=mars altKm=300", tools, sites)).toEqual({
    tool: "place_ship",
    args: { mode: "orbit", body: "mars", altKm: 300 },
  });
  expect(gameCall("/gear up", tools)).toEqual({ tool: "controls", args: { gear: false } });
  expect(gameCall("/throttle 0,5", tools)).toEqual({ tool: "controls", args: { throttle: 0.5 } });
  expect(gameCall("/set music off", tools)).toEqual({ tool: "set_settings", args: { changes: [{ key: "music", value: "off" }] } });
  expect(gameCall("/date +24", tools)).toEqual({ tool: "set_date", args: { hours: 24 } });
  expect(gameCall("/tool camera shipView=true", tools)).toEqual({ tool: "camera", args: { shipView: true } });
  expect(gameCall("/gear up down", tools)).toEqual({ error: 'too many arguments: "down"' });
  expect(gameCall("/help", tools)).toBeNull();
  const ctx = {
    bodies: [{ value: "Lune" }, { value: "Mars" }],
    sites: sites.map((value) => ({ value })),
    mounts: [{ value: "cockpit" }, { value: "chase" }],
    screens: [],
    scenes: [],
    saves: [],
    settings: [{ key: "music", label: "Musique", values: ["true", "false"] }],
    sky: [],
    keys: [],
    tools,
  };
  expect(completeGame("/teleport ", ctx)!.map((s) => s.label)).toEqual(["orbit", "ground", "glide"]);
  expect(completeGame("/teleport orbit Lu", ctx)!.map((s) => s.text)).toEqual(["/teleport orbit Lune "]);
  expect(completeGame("/teleport glide bou", ctx)!.map((s) => s.text)).toEqual(['/teleport glide "Paris - Le Bourget" ']);
  expect(completeGame("/view ch", ctx)!.map((s) => s.label)).toEqual(["chase"]);
  expect(completeGame("/set music ", ctx)!.map((s) => s.label)).toEqual(["true", "false"]);
  expect(completeGame("/tool cam", ctx)!.map((s) => s.label)).toEqual(["camera"]);
  expect(completeGame("/tool camera sh", ctx)!.map((s) => s.label)).toEqual(["shipView="]);
  expect(completeGame("/tool camera mount=co", ctx)!.map((s) => s.label)).toEqual(["mount=cockpit"]);
  expect(completeGame("/cockpit x", ctx)).toEqual([]);
});

test("the real weather anywhere at a date (PLAN-CIEL C1): weather_at, its / command", async () => {
  const { gameTools } = await import("../src/ai/game-tools");
  const { gameCall } = await import("../src/ai/game-commands");
  const burgos = (await import("./data/openmeteo-2026-08-12-burgos.json")).default;
  const host = { camera: { weatherPlace: () => null }, settings: {}, tools: {} } as unknown as import("../src/ai/game-tools").GameHost;
  const tool = gameTools(host).find((t) => t.name === "weather_at")!;
  const asked: string[] = [];
  const fetch0 = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    asked.push(String(url));
    return new Response(JSON.stringify(burgos), { status: 200 });
  }) as unknown as typeof fetch;
  try {
    const r = (await tool.run({ lat: 42.5, lon: -2.5, date: "2026-08-12T18:30:00Z" }, new AbortController().signal)) as {
      reachable: boolean;
      weather: { source: string; layers: unknown[] };
    };
    expect(r.reachable).toBe(true);
    expect(r.weather.source).toBe("model");
    expect(r.weather.layers).toEqual([]);
    expect(asked[0]).toContain("latitude=42.50&longitude=-2.50");
    const far = (await tool.run({ lat: 0, lon: 0, date: "2067-01-01T00:00:00Z" }, new AbortController().signal)) as { reachable: boolean };
    expect(far.reachable).toBe(false);
  } finally {
    globalThis.fetch = fetch0;
  }
  expect(gameCall("/weatherat 42.5 -2.5 2026-08-12T18:30Z", [tool])).toEqual({
    tool: "weather_at",
    args: { lat: 42.5, lon: -2.5, date: "2026-08-12T18:30Z" },
  });
});

test("the sky in TARS's telemetry (PLAN-CIEL C3): the Sun's and the Moon's heights, true and refracted", async () => {
  const { telemetry } = await import("../src/ai/telemetry");
  const sky = {
    over: "earth",
    heightM: 12,
    refraction: { refractivity: 2.93e-4, horizonArcmin: 35.3 },
    sun: { altDeg: -0.25, apparentAltDeg: 0.27, azDeg: 300 },
  };
  const cam = { skyInfo: () => sky } as unknown as import("../src/controls").CameraController;
  expect(telemetry(cam, ["sky"])).toEqual({ sky });
});

test("the eclipse calculator for TARS (PLAN-CIEL C5): find_eclipses, eclipse_local, their / commands", async () => {
  const { readFileSync } = await import("node:fs");
  const { addEphemeris } = await import("../src/system/de440");
  const b = readFileSync("assets/ephemeris/de440.bin");
  addEphemeris(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const { gameTools } = await import("../src/ai/game-tools");
  const host = {
    camera: {},
    settings: {},
    tools: {},
    utcNow: () => Date.UTC(2026, 0, 1),
  } as unknown as import("../src/ai/game-tools").GameHost;
  const tools = gameTools(host);
  const find = tools.find((t) => t.name === "find_eclipses")!;
  const sig = new AbortController().signal;
  const r = (await find.run({ kinds: ["solar", "lunar"] }, sig)) as {
    count: number;
    events: { kind: string; type: string; t: string; saros: number }[];
  };
  expect(r.events.map((e) => `${e.kind} ${e.type} ${e.t.slice(0, 10)}`).slice(0, 4)).toEqual([
    "solar annular 2026-02-17",
    "lunar total 2026-03-03",
    "solar total 2026-08-12",
    "lunar partial 2026-08-28",
  ]);
  const local = tools.find((t) => t.name === "eclipse_local")!;
  const burgos = (await local.run({ date: "2026-08-12", kind: "solar", lat: 42.34, lon: -3.7 }, sig)) as {
    here: { type: string; contacts: { name: string; t: string }[] };
  };
  expect(burgos.here.type).toBe("total");
  expect(burgos.here.contacts.map((c) => c.name)).toEqual(["C1", "C2", "C3", "C4"]);
  expect(burgos.here.contacts[1]!.t).toStartWith("2026-08-12T18:2");
  const { gameCall } = await import("../src/ai/game-commands");
  expect(gameCall("/eclipses solar,lunar", tools)).toEqual({ tool: "find_eclipses", args: { kinds: ["solar", "lunar"] } });
});

test("the multiple exposure for TARS (PLAN-CIEL C8): multiple_exposure, its labels, /analemma", async () => {
  const { gameTools } = await import("../src/ai/game-tools");
  const { gameCall } = await import("../src/ai/game-commands");
  const asked: import("../src/ui/multiexposure").MxRequest[] = [];
  const host = {
    camera: { weatherPlace: () => ({ body: "earth", lat: 42.34, lon: -3.7 }) },
    settings: {},
    tools: {},
    utcNow: () => Date.UTC(2026, 0, 1),
    multiExposure: async (r: import("../src/ui/multiexposure").MxRequest) => (asked.push(r), { rendered: 54 }),
    issPasses: (lat: number, lon: number, from: number, days: number) => [
      {
        start: from,
        top: from + 120e3,
        end: from + 300e3,
        maxAlt: 66 + lat * 0 + lon * 0 + days * 0,
        mag: -3.7,
        seenFrom: from + 10e3,
        seenTo: from + 290e3,
      },
    ],
  } as unknown as import("../src/ai/game-tools").GameHost;
  const tools = gameTools(host);
  const mx = tools.find((t) => t.name === "multiple_exposure")!;
  const r = (await mx.run(
    { kind: "analemma", time: "11:30", cadence: 20, position: true, dates: "all" },
    new AbortController().signal,
  )) as { exposures: number };
  expect(r.exposures).toBe(54);
  expect(asked[0]).toMatchObject({
    kind: "analemma",
    lat: 42.34,
    lon: -3.7,
    minutesUtc: 690,
    cadence: 10,
    base: "dusk",
    dates: "all",
    position: true,
  });
  await mx.run({ kind: "analemma" }, new AbortController().signal);
  expect(asked[1]).toMatchObject({ minutesUtc: 720, cadence: 7, dates: "monthly", position: false });
  await mx.run(
    { kind: "eclipse", eclipse: "lunar", date: "2026-03-03", lat: 35, lon: -100, before: 12, framing: "sky", share: true },
    new AbortController().signal,
  );
  expect(asked[2]).toMatchObject({
    kind: "eclipse",
    eclipse: "lunar",
    date: Date.UTC(2026, 2, 3),
    lat: 35,
    lon: -100,
    before: 10,
    after: 5,
    framing: "sky",
    base: "central",
    sky: "clear",
    times: true,
    share: true,
    caption: true,
  });
  await mx.run({ kind: "eclipse", eclipse: "lunar", date: "2026-03-03", layout: "shadow" }, new AbortController().signal);
  expect(asked.at(-1)).toMatchObject({ eclipse: "lunar", layout: "shadow" });
  await mx.run({ kind: "eclipse", eclipse: "transit", date: "2032-11-13", planet: "mercury" }, new AbortController().signal);
  expect(asked.at(-1)).toMatchObject({ eclipse: "transit", layout: "transit", planet: "mercury" });
  asked.splice(3);
  await mx.run({ kind: "trails", date: "2026-10-10", hours: 4, count: 500, comet: true }, new AbortController().signal);
  expect(asked[3]).toMatchObject({
    kind: "trails",
    date: Date.UTC(2026, 9, 10),
    hours: 4,
    count: 200,
    toward: "pole",
    fov: 70,
    comet: true,
  });
  await mx.run({ kind: "moon", mode: "lunar", date: "2026-10-01", days: 29 }, new AbortController().signal);
  expect(asked[4]).toMatchObject({ kind: "moon", mode: "lunar", days: 29, lit: true });
  await mx.run({ kind: "iss", date: "2026-10-18T05:20:00Z", dashes: true }, new AbortController().signal);
  expect(asked[5]).toMatchObject({ kind: "iss", date: Date.UTC(2026, 9, 18, 5, 20), dashes: true });
  expect(gameCall("/startrails 2026-10-10 4 south comet=true", tools)).toEqual({
    tool: "multiple_exposure",
    args: { kind: "trails", date: "2026-10-10", hours: 4, toward: "south", comet: true },
  });
  expect(gameCall("/moonpath lunar 2026-10-01", tools)).toEqual({
    tool: "multiple_exposure",
    args: { kind: "moon", mode: "lunar", date: "2026-10-01" },
  });
  expect(gameCall("/issphoto 2026-10-18T05:20Z", tools)).toEqual({
    tool: "multiple_exposure",
    args: { kind: "iss", date: "2026-10-18T05:20Z" },
  });
  expect(gameCall("/eclipsephoto solar 2026-08-12 lat=42.34 lon=-3.7 framing=sky", tools)).toEqual({
    tool: "multiple_exposure",
    args: { kind: "eclipse", eclipse: "solar", date: "2026-08-12", lat: 42.34, lon: -3.7, framing: "sky" },
  });
  expect(gameCall('/analemma "Paris - Le Bourget" 12:00 7 position=true', tools)).toEqual({
    tool: "multiple_exposure",
    args: { kind: "analemma", site: "Paris - Le Bourget", time: "12:00", cadence: 7, position: true },
  });
});

test("the ISS's passes for TARS (PLAN-CIEL C10): iss_passes, a read tool, /isspasses", async () => {
  const { gameTools } = await import("../src/ai/game-tools");
  const { gameCall } = await import("../src/ai/game-commands");
  const { READ_TOOLS } = await import("../src/ai/subagents");
  const host = {
    camera: { weatherPlace: () => ({ body: "earth", lat: 48.86, lon: 2.35 }) },
    settings: {},
    tools: {},
    utcNow: () => Date.UTC(2026, 9, 10),
  } as unknown as import("../src/ai/game-tools").GameHost;
  const real = await import("../src/photo/iss-pass");
  (host as { issPasses?: unknown }).issPasses = real.issPasses;
  const tools = gameTools(host);
  const t = tools.find((x) => x.name === "iss_passes")!;
  const r = (await t.run({ days: 10 }, new AbortController().signal)) as {
    passes: { from: string; maxAltDeg: number; magnitude: number }[];
  };
  expect(r.passes.length).toBeGreaterThan(2);
  expect(r.passes.some((p) => p.magnitude < -2.5)).toBe(true);
  expect(READ_TOOLS.has("iss_passes")).toBe(true);
  expect(gameCall("/isspasses", tools)).toEqual({ tool: "iss_passes", args: {} });
});

test("an eclipse at the camera's place for TARS (PLAN-CIEL C11): its phase in the sky's telemetry, its waking", async () => {
  const { readFileSync } = await import("node:fs");
  const { addEphemeris } = await import("../src/system/de440");
  const b = readFileSync("assets/ephemeris/de440.bin");
  addEphemeris(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const { eclipseNow } = await import("../src/eclipse/earth-moon");
  const D = Math.PI / 180;
  // (Burgos, 12 August 2026: partial at 18:00, total at 18:29; the Moon of 3 March 2026 from the Kansas: total at 11:33)
  expect(eclipseNow(42.34 * D, -3.7 * D, 0, Date.UTC(2026, 7, 12, 18, 0), 12, -10).phase).toBe("solar_partial");
  const tot = eclipseNow(42.34 * D, -3.7 * D, 0, Date.UTC(2026, 7, 12, 18, 29, 15), 8, -10);
  expect(tot.phase).toBe("solar_total");
  expect(tot.sunHidden).toBe(1);
  // (a new Moon: never in the Earth's shadow)
  expect(tot.moonInUmbra).toBe(0);
  expect(eclipseNow(35 * D, -100 * D, 0, Date.UTC(2026, 2, 3, 11, 33), -20, 18).phase).toBe("lunar_total");
  expect(eclipseNow(35 * D, -100 * D, 0, Date.UTC(2026, 2, 3, 11, 33), -20, -5).phase).toBe("");
  const { Triggers } = await import("../src/ai/triggers");
  const T = new Triggers({ get: () => null, set: () => true, clear: () => {} });
  expect(T.match({ kind: "eclipse", to: "solar_total" }).map((r) => r.id)).toEqual(["reflex-eclipse"]);
});
