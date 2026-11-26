// The A320 over San Francisco Bay, its plan KSFO 10L CIITY3.DEDHD → KLAX SADDE8.FIM made through its MCDU (PLAN-A320-VOL-AAA N2):
// for scripts/a320-du-dump.ts (JS="$(cat scripts/dumps/ksfo-klax.js)"): the ND and the MCDU's F-PLN drawn with it.
(async () => {
  __bh.game.flyAt(37.58, -122.2, 3000, 120, 128);
  const c = __bh.camera;
  c.gearDown = false;
  c.gearExt = 0;
  c.airFlight.cfg.flaps = 0;
  c.pilot.throttle = 0.65;
  __bh.settings.shipMount = "cockpit";
  __bh.refresh();
  const m = __bh.a320Mcdu(0);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // (INIT's FROM/TO: the two airfields' tiles fetched at the first ask — asked again until the plan is made, 30 s at most)
  for (let k = 0; k < 60 && __bh.camera.nav.route.wps.at(-1)?.name !== "KLAX"; k++) {
    m.page("init");
    m.sp = "KSFO/KLAX";
    m.lsk("R", 1);
    await wait(500);
  }
  if (__bh.camera.nav.route.wps.at(-1)?.name !== "KLAX") return "no plan: KSFO/KLAX not found in 30 s";
  // (the SIDs and STARs fetched at the first ask)
  m.latRev = 0;
  m.open("latrev");
  m.lsk("L", 1);
  for (let k = 0; k < 40 && !(m.current.screen(m).lines[1].r ?? []).some((r) => /SIDS>/.test(r.t)); k++) {
    m.depRwy = "10L";
    await wait(250);
  }
  m.depRwy = "10L";
  m.depSid = "CIITY3";
  m.depTrans = "DEDHD";
  m.lsk("R", 6);
  const R = __bh.camera.nav.route;
  m.latRev = R.wps.length - 1;
  m.open("latrev");
  m.lsk("R", 1);
  m.arrStar = "SADDE8";
  m.arrTrans = "FIM";
  await wait(500);
  m.lsk("R", 6);
  m.page("f-pln");
  m.fplnTop = 0;
  // (the INIT's retries' « NOT IN DATA BASE » cleared)
  m.button("CLR");
  m.button("CLR");
  return R.wps.map((w) => `${w.name}${w.cstr ? `(${w.cstr.map((x) => (x == null ? "-" : Math.round(x / 0.3048))).join("/")})` : ""}`).join(" ");
})()
