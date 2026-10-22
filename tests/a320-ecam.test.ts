import { describe, expect, test } from "bun:test";
import { Ecam, type EcamGame, ecamCall, ecamInputs } from "../src/a320/ecam";
import { newEngine } from "../src/a320/fadec";
import type { Props } from "../src/a320/rig";
import { A320Systems, type SysFrame } from "../src/a320/systems";

// The A320's ECAM (docs/PLAN-A320.md, A11 — src/a320/ecam: FlightGear's FWC files, property rules and ECAM logic) on
// the systems' bag (src/a320/systems): at the stand with the engines running, phase 2 and its memos, the T.O MEMO by
// the T.O CONFIG button and its lines turning green as the crew sets the aircraft; an engine fire on the ground — the
// red warning, the master warning, the CRC, the ENG page, its procedure's lines gone as their actions are done; a
// green hydraulic loss — the amber caution, the master caution, the chime, CLR to STATUS; the take-off's phases and
// their inhibition (T.O INHIBIT: the caution held until the climb).

/** The A320 at the stand, its engines running, the systems and the ECAM on one bag. */
function stand() {
  const es = [newEngine(true), newEngine(true)];
  const air = { ias: 0, onGround: true, aglFt: 0, altFt: 300 };
  const frame = (): SysFrame => ({
    elapsed: 0,
    lat: 48.7,
    lon: 2.4,
    altFt: air.altFt,
    aglFt: air.aglFt,
    vsFpm: 0,
    onGround: air.onGround,
    gear: 1,
    ias: air.ias,
    gs: air.ias,
    mach: air.ias / 660,
    tatC: 15,
    oatC: 15,
    staticInHg: 29.6,
    alphaDeg: 0,
    flapDeg: 0,
    slatDeg: 0,
    engines: es,
    tanks: [690, 5000, 0, 5000, 690],
    detent: "IDLE",
  });
  const P: Props = {};
  const S = new A320Systems(P, { rand: () => 0.5 });
  S.reset("ready", frame());
  const E = new Ecam();
  E.reset(P);
  E.bind(S.nasal);
  const G: EcamGame = { detents: [0, 0] };
  const run = (s: number, until?: () => boolean) => {
    for (let k = 0; k < s * 30; k++) {
      S.step(1 / 30, frame());
      ecamInputs(P, G);
      E.step(P, 1 / 30);
      if (until?.()) return k / 30;
    }
    return s;
  };
  run(3);
  E.takeAurals();
  return { P, E, G, air, run };
}

const texts = (ls: { text: string }[]) => ls.map((l) => l.text.trim());

describe("A320 ECAM", () => {
  test("at the stand: phase 2, the memos; T.O CONFIG: the T.O MEMO, its lines green as they are done", () => {
    const { P, E, G, run } = stand();
    expect(E.phase).toBe(2);
    expect(E.masterWarning).toBeFalse();
    expect(E.masterCaution).toBeFalse();
    expect(E.left().every((l) => l.colour === "g")).toBeTrue();
    // (the T.O CONFIG button: the T.O memo, cyan — nothing set yet)
    E.button("toConfig");
    run(1);
    console.log(`  T.O MEMO: ${texts(E.left()).join(" | ")}`);
    expect(texts(E.left())[0]).toBe("T.O AUTO BRK.....MAX");
    expect(E.left().every((l) => l.colour === "c")).toBeTrue();
    // (the crew: autobrake MAX, the signs on, the spoilers armed, flaps 1: green)
    G.autobrake = 3;
    Object.assign(P, {
      "controls/switches/seatbelt-sign": 1,
      "controls/switches/no-smoking-sign": 1,
      "controls/flight/speedbrake-arm": 1,
      "controls/flight/flaps-input": 1,
    });
    run(1);
    const L = E.left();
    console.log(`  set: ${L.map((l) => `${l.colour}:${l.text.trim()}`).join(" | ")}`);
    expect(texts(L).slice(0, 4)).toEqual(["T.O AUTO BRK MAX", "SIGNS ON", "SPLRS ARM", "FLAPS T.O"]);
    expect(L.slice(0, 4).every((l) => l.colour === "g")).toBeTrue();
    // (and the T.O CONFIG test passed: CONFIG NORMAL)
    E.button("toConfig");
    run(1);
    expect(texts(E.left())).toContain("T.O CONFIG NORMAL");
  });

  test("ENG 1 FIRE on the ground: the red warning, the CRC, the ENG page; its lines gone as their actions are done", () => {
    const { P, E, G, run } = stand();
    G.detents = [2, 2];
    P["systems/failures/fire/engine-left-fire"] = 1;
    const t = run(30, () => E.masterWarning);
    console.log(`  fire warning after ${t.toFixed(1)} s: ${texts(E.left()).join(" | ")}`);
    expect(E.masterWarning).toBeTrue();
    const L = E.left();
    expect(texts(L)[0]).toBe("ENG 1 FIRE");
    expect(L[0]!.colour).toBe("r");
    expect(E.takeAurals()).toContain("crc");
    expect(E.sdPage).toBe("enginePage");
    expect(texts(L)).toContain("-THR LEVERS........IDLE");
    expect(texts(L)).toContain("-ENG MASTER 1.......OFF");
    expect(L.filter((l) => l.colour === "c").length).toBeGreaterThan(3);
    // (the levers to idle: their line gone; ENG MASTER 1 OFF: its line gone; the fire still on)
    G.detents = [0, 0];
    run(1);
    expect(texts(E.left())).not.toContain("-THR LEVERS........IDLE");
    P["controls/engines/engine/cutoff-switch"] = 1;
    run(1);
    expect(texts(E.left())).not.toContain("-ENG MASTER 1.......OFF");
    expect(texts(E.left())).toContain("-ENG 1 FIRE P/B....PUSH");
    expect(texts(E.left())[0]).toBe("ENG 1 FIRE");
    // (the master warning pressed: off, the warning still shown)
    E.button("masterWarn");
    run(0.5);
    expect(E.masterWarning).toBeFalse();
    expect(texts(E.left())[0]).toBe("ENG 1 FIRE");
    // (STATUS: ENG 1 inoperative)
    expect(texts(E.status().right)).toContain("ENG 1");
  });

  test("HYD G SYS LO PR: the amber caution, the chime; CLR, then CLR again to STATUS", () => {
    const { P, E, run } = stand();
    // (the green engine pump failed, the PTU off: the green pressure down)
    P["systems/failures/hydraulic/green-edp"] = 1;
    P["controls/hydraulic/switches/ptu"] = 0;
    const t = run(60, () => E.masterCaution);
    console.log(`  caution after ${t.toFixed(1)} s (green ${P["systems/hydraulic/green-psi"]} psi): ${texts(E.left()).join(" | ")}`);
    expect(E.masterCaution).toBeTrue();
    expect(E.masterWarning).toBeFalse();
    expect(texts(E.left())[0]).toBe("HYD G SYS LO PR");
    expect(E.left()[0]!.colour).toBe("a");
    // (the single chime: 0.15 s after — ECAM-controller.nas's sound())
    run(0.5);
    expect(E.takeAurals()).toContain("chime");
    // (STATUS: the green's lines, its systems inoperative; the STS reminder)
    const st = E.status();
    expect(texts(st.right)).toContain("G HYD");
    expect(texts(st.left)).toContain("LDG DIST PROC....APPLY");
    expect(st.sts).toBeTrue();
    // (CLR: the caution cleared — the memos back —; CLR again: the STATUS page)
    E.button("clr");
    run(0.5);
    expect(texts(E.left())).not.toContain("HYD G SYS LO PR");
    expect(E.masterCaution).toBeFalse();
    E.button("clr");
    run(0.5);
    expect(E.sd.page).toBe("statusPage");
    // (RCL: the caution back)
    E.button("rcl");
    run(0.5);
    expect(texts(E.left())).toContain("HYD G SYS LO PR");
    // (the deck's ECAM panel: its CLR's Nasal call answered)
    expect(ecamCall(E, "ecam.ECAMControlPanel.clrBtn", [], P)).toBeTrue();
    expect(ecamCall(E, "ecam.ECAMControlPanel.sysPageBtn", ["hydraulicPage"], P)).toBeTrue();
    expect(E.sd.page).toBe("hydraulicPage");
  });

  test("the take-off: phases 3, 4, 5, 6; T.O INHIBIT holds an amber caution until the climb", () => {
    const { P, E, G, air, run } = stand();
    // (the green lost before the take-off: shown at the stand)
    P["systems/failures/hydraulic/green-edp"] = 1;
    P["controls/hydraulic/switches/ptu"] = 0;
    run(60, () => E.masterCaution);
    expect(texts(E.left())).toContain("HYD G SYS LO PR");
    // (FLEX set, the levers to FLX/MCT: phase 3; 80 kt: phase 4 — the caution inhibited, T.O INHIBIT in magenta)
    G.flex = 45;
    G.detents = [4, 4];
    run(3);
    expect(E.phase).toBe(3);
    air.ias = 100;
    run(3);
    const ph4 = E.phase;
    const R4 = E.right();
    console.log(`  phase ${ph4}: L ${texts(E.left()).join(" | ")}; R ${R4.map((l) => `${l.colour}:${l.text}`).join(" | ")}`);
    expect(ph4).toBe(4);
    expect(texts(E.left())).not.toContain("HYD G SYS LO PR");
    expect(R4.some((l) => l.text === "T.O. INHIBIT" && l.colour === "m")).toBeTrue();
    // (the lift-off: phase 5; above 1 500 ft, the levers to CL: phase 6 — the caution shown again)
    air.onGround = false;
    air.aglFt = 400;
    air.ias = 160;
    run(3);
    expect(E.phase).toBe(5);
    air.aglFt = 1800;
    air.altFt = 2100;
    G.detents = [2, 2];
    run(4);
    console.log(`  phase ${E.phase}: ${texts(E.left()).join(" | ")}`);
    expect(E.phase).toBe(6);
    expect(texts(E.left())).toContain("HYD G SYS LO PR");
  });
});
