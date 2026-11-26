// The airport's radio (docs/PLAN-AEROPORT-AAA.md V10 — Sam, 26 Nov 2026: « les sons des radios, générés à partir des données »): the tower's
// and the crews' exchanges made from the real movements the airport view sees — each said once, in ICAO phraseology, in English as on
// the real frequencies; the callsigns in radiotelephony (« Delta two five three four », « Speedbird », a designator unknown spelled out),
// the runways and numbers digit by digit, « niner ».
//
// - An arrival: on final (a minute and a quarter out at most) its call — « Los Angeles Tower, Delta two five three four, three mile
//   final runway two four right » —, the clearance — « …, runway two four right, cleared to land » —, the read-back; rolled out, sent to
//   the ground and the good day.
// - A departure: lined up and waiting, ready — « …, holding short runway two five right, ready for departure » —, « line up and wait »,
//   the read-back; on its roll, « cleared for takeoff » and the read-back; climbing past 1 000 ft, sent to the departure controller.
// Pure: the movements in (its own names, figures and seconds to the event), the lines out — the caller says them (audio/voice.ts: the
// tower's voice, the crews' another, through the radio's band and squelch).

export interface AtcMove {
  id: string;
  /** its callsign as reported (« DAL2534 »), its registration */
  cs: string;
  reg: string;
  dep: boolean;
  gnd: boolean;
  /** the seconds to its touchdown or lift-off (< 0: since), its speed [m/s], its height over its wheels' rest [m] */
  eta: number;
  speed: number;
  over: number;
  /** its runway's name (« 24R ») */
  runway: string;
}

export interface AtcLine {
  /** the tower or the crew */
  who: "tower" | "pilot";
  text: string;
  /** the movement it is about */
  id: string;
}

/** The radiotelephony callsigns of the designators met most (ICAO Doc 8585); others are spelled. */
const TELEPHONY: Record<string, string> = {
  AAL: "American",
  ACA: "Air Canada",
  AFR: "Air France",
  AIC: "Air India",
  ANA: "All Nippon",
  ASA: "Alaska",
  AUA: "Austrian",
  AVA: "Avianca",
  BAW: "Speedbird",
  BEL: "Beeline",
  CCA: "Air China",
  CES: "China Eastern",
  CKS: "Connie",
  CPA: "Cathay",
  CSN: "China Southern",
  DAL: "Delta",
  DLH: "Lufthansa",
  EIN: "Shamrock",
  EJA: "Execjet",
  ETD: "Etihad",
  EVA: "Eva",
  EZY: "Easy",
  FDX: "Fedex",
  FFT: "Frontier Flight",
  FIN: "Finnair",
  GTI: "Giant",
  HAL: "Hawaiian",
  IBE: "Iberia",
  JAL: "Japan Air",
  JBU: "Jetblue",
  JZA: "Jazz",
  KAL: "Korean Air",
  KLM: "KLM",
  NKS: "Spirit Wings",
  QFA: "Qantas",
  QTR: "Qatari",
  RYR: "Ryanair",
  SAS: "Scandinavian",
  SIA: "Singapore",
  SKW: "Skywest",
  SWA: "Southwest",
  SWR: "Swiss",
  TAP: "Air Portugal",
  THY: "Turkish",
  TSC: "Air Transat",
  UAE: "Emirates",
  UAL: "United",
  UPS: "U P S",
  VIR: "Virgin",
  VOI: "Volaris",
  VXP: "Avelo",
  WJA: "Westjet",
  ASH: "Air Shuttle",
  ENY: "Envoy",
  RPA: "Brickyard",
  EDV: "Endeavor",
  JIA: "Blue Streak",
  PDT: "Piedmont",
  AAY: "Allegiant",
  SCX: "Sun Country",
  TVF: "France Soleil",
  TVS: "Skytravel",
  HOP: "Air Hop",
  EWG: "Eurowings",
  VLG: "Vueling",
};

const DIGIT = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "niner"];
const ALPHA: Record<string, string> = {
  A: "Alfa",
  B: "Bravo",
  C: "Charlie",
  D: "Delta",
  E: "Echo",
  F: "Foxtrot",
  G: "Golf",
  H: "Hotel",
  I: "India",
  J: "Juliett",
  K: "Kilo",
  L: "Lima",
  M: "Mike",
  N: "November",
  O: "Oscar",
  P: "Papa",
  Q: "Quebec",
  R: "Romeo",
  S: "Sierra",
  T: "Tango",
  U: "Uniform",
  V: "Victor",
  W: "Whiskey",
  X: "X-ray",
  Y: "Yankee",
  Z: "Zulu",
};

/** Each character spoken: digits one by one, letters by the phonetic alphabet. */
export function spell(s: string): string {
  return [...s.toUpperCase()]
    .map((ch) => (/\d/.test(ch) ? DIGIT[Number(ch)]! : (ALPHA[ch] ?? "")))
    .filter(Boolean)
    .join(" ");
}

/** A callsign in radiotelephony: its airline's name and its flight's digits (« DAL2534 » → « Delta two five three four »), else spelled. */
export function telephony(cs: string, reg = ""): string {
  const c = cs.trim().toUpperCase();
  const m = /^([A-Z]{3})(\d[0-9A-Z]*)$/.exec(c);
  if (m && TELEPHONY[m[1]!]) return `${TELEPHONY[m[1]!]} ${spell(m[2]!)}`;
  return spell(c && !/^0+$/.test(c) ? c : reg || c);
}

/** A runway's name spoken: « 24R » → « two four right ». */
export function runwaySpoken(r: string): string {
  const m = /^(\d{1,2})([LCR]?)$/.exec(r.trim().toUpperCase());
  if (!m) return spell(r);
  const side = { L: " left", C: " center", R: " right", "": "" }[m[2] as "L" | "C" | "R" | ""];
  return `${spell(m[1]!.padStart(2, "0"))}${side}`;
}

/** The tower's name from its airfield's (« Los Angeles International Airport » → « Los Angeles »). */
export function towerName(field: string): string {
  return (
    field
      .replace(/\b(International|Intl\.?|Regional|Municipal|Airport|Airfield|Aéroport|Aeropuerto|Flughafen|Aeroporto)\b/gi, "")
      .replace(/[-–—/(),]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || field
  );
}

/** The radio of one airport: what each movement has been told, the lines due now. */
export class AirportAtc {
  private told = new Map<string, Set<string>>();

  constructor(readonly tower: string) {}

  /** The lines due from the movements now (each event once a movement). */
  step(moves: readonly AtcMove[]): AtcLine[] {
    const out: AtcLine[] = [];
    const T = `${this.tower} Tower`;
    for (const m of moves) {
      const done = this.told.get(m.id) ?? new Set<string>();
      this.told.set(m.id, done);
      const once = (ev: string, lines: [AtcLine["who"], string][]) => {
        if (done.has(ev)) return;
        done.add(ev);
        for (const [who, text] of lines) out.push({ who, text, id: m.id });
      };
      const cs = telephony(m.cs, m.reg);
      const rw = runwaySpoken(m.runway);
      if (!m.dep) {
        if (!m.gnd && m.eta <= 75 && m.eta > 12) {
          const miles = Math.max(1, Math.round((m.speed * m.eta) / 1852));
          once("final", [
            ["pilot", `${T}, ${cs}, ${spell(String(miles))} mile final runway ${rw}.`],
            ["tower", `${cs}, ${T}, runway ${rw}, cleared to land.`],
            ["pilot", `Cleared to land runway ${rw}, ${cs}.`],
          ]);
        }
        if (m.gnd && m.eta < -15 && m.speed < 35)
          once("vacate", [
            ["tower", `${cs}, turn off at the next available taxiway, contact Ground, good day.`],
            ["pilot", `Ground, ${cs}, good day.`],
          ]);
      } else {
        if (m.gnd && m.speed < 3 && m.eta > 20)
          once("lineup", [
            ["pilot", `${T}, ${cs}, holding short runway ${rw}, ready for departure.`],
            ["tower", `${cs}, runway ${rw}, line up and wait.`],
            ["pilot", `Line up and wait runway ${rw}, ${cs}.`],
          ]);
        if (m.gnd && (m.speed >= 3 || m.eta <= 20))
          once("takeoff", [
            ["tower", `${cs}, runway ${rw}, cleared for takeoff.`],
            ["pilot", `Cleared for takeoff runway ${rw}, ${cs}.`],
          ]);
        if (!m.gnd && m.over > 300)
          once("handoff", [
            ["tower", `${cs}, contact Departure, good day.`],
            ["pilot", `Departure, ${cs}, good day.`],
          ]);
      }
    }
    // (those gone from the movements: forgotten after a while — the map kept small)
    if (this.told.size > 400) {
      const keep = new Set(moves.map((m) => m.id));
      for (const k of this.told.keys()) if (!keep.has(k)) this.told.delete(k);
    }
    return out;
  }
}
