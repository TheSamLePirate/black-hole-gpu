// The hitch probe (PLAN-J7 J7-0): every gap between two animation frames over 50 ms in the page, and what changed across it — its cause read
// from the steps the game already traces: a tracer compile (renderer.compileLog, compilingNow), a long task of the main thread (the
// PerformanceObserver's "longtask": a script, a parse, a GC run on it), the JS heap dropping (a collection), the relief's and the
// photographs' tiles, the game's log (a save, a message), the view (the mount, the game's mode — ship, foot, free, photo —, an offline render, the craft, the canvas's size), the GPU's device, the GPU
// itself (the frame's GPU time as long as the gap). A gap's longtasks arrive after it (their observer's callback is a later task): a gap
// is judged 300 ms after, then sent out as a `console.debug("[hitch]…")` line — the Bun side appends it to a file as it comes
// (tests/e2e/lib/app.ts, E2E_HITCH=1: the probe in every page booted, remote-results/hitches/<test>.jsonl), nothing read at a close.
// Witnesses (tests/e2e/hitch-probe.e2e.test.ts): a 200 ms wait injected in a frame seen and given to the main thread; a held flight, twice,
// without a gap over 100 ms.

/** the page's side: idempotent; `window.__hitch` — `gaps`, `frames`, `over50`, `over100`, `max`, `inject(ms)` (a busy wait in a frame) */
export const HITCH_PROBE = `(() => {
  if (window.__hitch) return 1;
  const H = (window.__hitch = { gaps: [], frames: 0, over50: 0, over100: 0, max: 0 });
  const tasks = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) { tasks.push({ s: e.startTime, d: e.duration }); if (tasks.length > 400) tasks.shift(); }
    }).observe({ type: "longtask", buffered: false });
  } catch {}
  const snap = () => {
    const b = window.__bh, R = b && b.renderer;
    let compiling = 0;
    try { compiling = R ? R.compilingNow.length : 0; } catch {}
    const T = R && R.earthTiles;
    return {
      ready: !!(b && b.camera && b.camera.piloting),
      compiles: (R && R.compileLog && R.compileLog.length) || 0,
      compiling,
      tiles: T ? (T.pending || 0) + (T.orthoPending || 0) : 0,
      log: (b && b.game && b.game.log && b.game.log.events && b.game.log.events.length) || 0,
      mount: b && b.settings ? b.settings.shipMount : "",
      mode: b && b.mode && b.mode.get ? b.mode.get() : "",
      offline: !!(R && R.offlineActive),
      craft: b && b.fleet ? b.fleet.active : "",
      gen: b && b.gpu && b.gpu.generation ? b.gpu.generation() : 0,
      gpu: (R && R.lastGpuMs) || 0,
      size: innerWidth + "x" + innerHeight,
      hidden: document.hidden,
      heap: (performance.memory && performance.memory.usedJSHeapSize) || 0,
    };
  };
  const pending = [];
  const judge = (g) => {
    const R = window.__bh && window.__bh.renderer;
    const a = g.prev, b = g.cur, causes = [];
    if (!b.ready) causes.push("boot");
    if (b.compiles > a.compiles && R && R.compileLog) causes.push("compile: " + R.compileLog.slice(a.compiles, b.compiles).map((c) => c.pipeline).join(", "));
    else if (b.compiling !== a.compiling) causes.push("compile " + (b.compiling > a.compiling ? "started" : "ended"));
    let main = 0;
    for (const t of tasks) main += Math.max(0, Math.min(t.s + t.d, g.end) - Math.max(t.s, g.start));
    if (main > 25) causes.push("main thread " + Math.round(main) + " ms");
    const freed = (a.heap - b.heap) / 1048576;
    if (freed > 4) causes.push("heap −" + freed.toFixed(0) + " MB (a collection)");
    if (b.tiles !== a.tiles) causes.push("tiles " + a.tiles + "→" + b.tiles);
    if (b.log > a.log) {
      const ev = window.__bh.game.log.events.slice(a.log, b.log).map((e) => String(e.text).slice(0, 60));
      causes.push("log: " + ev.join(" | "));
    }
    if (b.mount !== a.mount) causes.push("view " + a.mount + "→" + b.mount);
    if (b.mode !== a.mode) causes.push("mode " + a.mode + "→" + b.mode);
    if (b.offline !== a.offline) causes.push(b.offline ? "offline render started" : "offline render ended");
    if (b.craft !== a.craft) causes.push("craft " + a.craft + "→" + b.craft);
    if (b.gen !== a.gen) causes.push("GPU device " + a.gen + "→" + b.gen);
    if (b.size !== a.size) causes.push("resize " + a.size + "→" + b.size);
    if (b.gpu > 0.8 * g.ms) causes.push("GPU " + b.gpu.toFixed(0) + " ms");
    if (!causes.length) causes.push("unknown");
    const out = { t: +(g.end / 1000).toFixed(2), ms: +g.ms.toFixed(1), causes, mount: b.mount, mode: b.mode, craft: b.craft };
    H.gaps.push(out);
    if (H.gaps.length > 2000) H.gaps.shift();
    console.debug("[hitch]" + JSON.stringify(out));
  };
  let prev = snap(), last = 0;
  const tick = (now) => {
    const cur = snap();
    if (last > 0) {
      const gap = now - last;
      H.frames++;
      H.max = Math.max(H.max, gap);
      if (gap > 50 && !cur.hidden && !prev.hidden) {
        H.over50++;
        if (gap > 100) H.over100++;
        pending.push({ start: last, end: now, ms: gap, prev, cur });
      }
    }
    while (pending.length && now - pending[0].end > 300) judge(pending.shift());
    if (H.frames % 600 === 0) console.debug("[hitch-sum]" + JSON.stringify({ frames: H.frames, over50: H.over50, over100: H.over100, max: +H.max.toFixed(1) }));
    prev = cur;
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  H.inject = (ms) => new Promise((ok) => requestAnimationFrame(() => { const t = performance.now(); while (performance.now() - t < ms) {} ok(1); }));
  return 1;
})()`;
