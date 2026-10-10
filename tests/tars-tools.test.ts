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
  // ("/": the commands and his skills; "/mo": model, mode)
  expect(complete("/mo", ctx).map((s) => s.label)).toEqual(["/model <modèle>", "/mode act|plan|watch"]);
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
