(async () => {
  const m = __bh.a320Mcdu(0);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  __bh.game.flyAt(37.58, -122.2, 3000, 120, 128);
  for (let k = 0; k < 60 && __bh.camera.nav.route.wps.at(-1)?.name !== "KLAX"; k++) {
    m.page("init");
    m.sp = "KSFO/KLAX";
    m.lsk("R", 1);
    await wait(500);
  }
  const out = { wps: __bh.camera.nav.route.wps.map((w) => w.name).join(" ") };
  const r = await fetch("approaches/v1/procs/KSFO.json");
  out.fetch = `${r.status} ${(await r.text()).slice(0, 60)}`;
  m.latRev = 0;
  m.open("latrev");
  out.latrev = m.current.screen(m).lines[0].l.map((x) => x.t).join("");
  out.l1 = String(m.lsk("L", 1));
  out.page = m.pageId;
  await wait(3000);
  out.dep = m.current.screen(m).lines.map((L) => [...(L.l ?? []), ...(L.r ?? [])].map((x) => x.t).join("")).join(" | ");
  return JSON.stringify(out);
})()
