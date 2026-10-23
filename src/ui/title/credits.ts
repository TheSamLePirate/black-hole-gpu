// The credits (PLAN-TITRE-AAA E7): who made the game, and every work it is built on — the craft's models, the
// sky's and the worlds' data, the services asked while playing, the photographs the landscapes are checked
// against, the software and the fonts. The one source: the credits screen reads it, scripts/build-credits.ts
// writes CREDITS.md from it, and tests/title-credits.test.ts checks each entry taken from an asset's README
// against that README (its author, its licence).

import { lang, tr, type Text } from "../../i18n";
import FR from "../../i18n/fr-settings";
import { LANDSCAPES } from "../../system/landscapes";
import { PRESET_INFO } from "../schema";

export interface Credit {
  /** the work */
  what: Text;
  /** its authors, its source */
  who: string | Text;
  /** its licence, or its terms */
  licence?: string;
  url?: string;
  /** the asset README it is taken from (checked by the tests: `who`'s first words and the licence are in it) */
  readme?: string;
}

export interface CreditSection {
  id: string;
  title: Text;
  items: Credit[];
}

const CC_BY = "CC BY 4.0";

/** a scene's title in both languages (the gallery's own, its French from the settings' dictionary) */
function sceneText(name: string): Text {
  const en = PRESET_INFO[name]?.title ?? name.replace(/^Earth: /, "");
  return { fr: (FR as Record<string, string>)[en] ?? en, en };
}

export const CREDITS: CreditSection[] = [
  {
    id: "game",
    title: { fr: "Un jeu de", en: "A game by" },
    items: [
      {
        what: { fr: "Conception, physique, rendu, code", en: "Design, physics, rendering, code" },
        who: "SamLePirate",
        url: "https://samlepirate.org",
      },
    ],
  },
  {
    id: "craft",
    title: { fr: "Les vaisseaux et les modèles", en: "The craft and the models" },
    items: [
      {
        what: { fr: "Ranger — « Interstellar Ranger One »", en: "Ranger — “Interstellar Ranger One”" },
        who: "Max Vizell (Sketchfab)",
        licence: CC_BY,
        url: "https://sketchfab.com/3d-models/interstellar-ranger-one-77c63df2062d4fd9863cc64711450c6f",
        readme: "assets/ranger/README.md",
      },
      {
        what: {
          fr: "Cockpit du Ranger — « Interstellar Ranger One Cockpit »",
          en: "The Ranger's cockpit — “Interstellar Ranger One Cockpit”",
        },
        who: "Sketchfab",
        licence: CC_BY,
        readme: "assets/ranger/README.md",
      },
      {
        what: { fr: "Lander — « Endurance Lander from Interstellar »", en: "Lander — “Endurance Lander from Interstellar”" },
        who: "Crusty Bread (Sketchfab)",
        licence: CC_BY,
        url: "https://sketchfab.com/3d-models/endurance-lander-from-interstellar-0bcbd25523794779826e3e19770dc1f2",
        readme: "assets/lander/README.md",
      },
      {
        what: { fr: "Endurance — « Interstellar | Endurance »", en: "Endurance — “Interstellar | Endurance”" },
        who: "devPilot (Sketchfab)",
        licence: CC_BY,
        url: "https://sketchfab.com/3d-models/interstellar-endurance-901fec2809704b74bec891e9a40a8726",
        readme: "assets/endurance/README.md",
      },
      {
        what: { fr: "F-35B — « F-35A Lightning II »", en: "F-35B — “F-35A Lightning II”" },
        who: "shangus930 (Sketchfab)",
        licence: CC_BY,
        url: "https://sketchfab.com/3d-models/f-35a-lightning-ii-a06d6113cfb44a0aa7b8f17106aca9c4",
        readme: "assets/f35/README.md",
      },
      {
        what: { fr: "L'astronaute", en: "The astronaut" },
        who: "false-earth, Ming-Jyun Hung",
        licence: "CGTrader licence",
        url: "https://github.com/momentchan/false-earth",
        readme: "assets/character/README.md",
      },
      {
        what: { fr: "La Station spatiale internationale", en: "The International Space Station" },
        who: "NASA (NASA 3D Resources)",
        url: "https://science.nasa.gov/3d-resources/",
        readme: "assets/iss/README.md",
      },
      {
        what: {
          fr: "Les porte-avions (Gerald R. Ford, Kiev, Implacable), les avions de ligne et les navires du trafic",
          en: "The carriers (Gerald R. Ford, Kiev, Implacable), the airliners and the ships of the traffic",
        },
        who: { fr: "Modèles 3D fournis, sous la licence de leurs auteurs", en: "3D models supplied, under their authors' licences" },
      },
    ],
  },
  {
    id: "sky",
    title: { fr: "Le ciel", en: "The sky" },
    items: [
      {
        what: { fr: "La Voie lactée — Deep Star Maps 2020", en: "The Milky Way — Deep Star Maps 2020" },
        who: "NASA/Goddard Space Flight Center Scientific Visualization Studio · Gaia DR2: ESA/Gaia/DPAC",
        url: "https://svs.gsfc.nasa.gov/4851",
        readme: "assets/sky/README.md",
      },
      {
        what: { fr: "Les étoiles — HYG v4.4 (Hipparcos, Yale, Gliese)", en: "The stars — HYG v4.4 (Hipparcos, Yale, Gliese)" },
        who: "David Nash / astronexus",
        licence: "CC BY-SA 4.0",
        url: "https://codeberg.org/astronexus/hyg",
        readme: "assets/sky/README.md",
      },
      {
        what: { fr: "Les noms des étoiles", en: "The stars' names" },
        who: "IAU Working Group on Star Names",
        readme: "assets/sky/README.md",
      },
    ],
  },
  {
    id: "worlds",
    title: { fr: "Les mondes", en: "The worlds" },
    items: [
      {
        what: { fr: "Les éphémérides — DE440, JUP365 (SPICE)", en: "The ephemerides — DE440, JUP365 (SPICE)" },
        who: "NASA/JPL — NAIF",
        url: "https://naif.jpl.nasa.gov/",
      },
      {
        what: {
          fr: "La Terre de jour et de nuit — Blue Marble, Black Marble",
          en: "The Earth by day and night — Blue Marble, Black Marble",
        },
        who: "NASA",
        readme: "assets/earth/README.md",
      },
      {
        what: { fr: "Le relief de la Terre — ETOPO 2022", en: "The Earth's relief — ETOPO 2022" },
        who: "NOAA National Centers for Environmental Information",
        readme: "assets/earth/README.md",
      },
      {
        what: { fr: "L'imagerie en approche — GIBS", en: "The imagery near the ground — GIBS" },
        who: "NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS)",
        url: "https://gibs.earthdata.nasa.gov",
        readme: "assets/earth/README.md",
      },
      {
        what: {
          fr: "La France au plus près — photographies aériennes, relief, arbres et bâtiments",
          en: "France up close — aerial photographs, relief, trees and buildings",
        },
        who: "IGN — Géoplateforme : BD ORTHO, RGE ALTI, LiDAR HD (MNT, MNH), BD TOPO",
        licence: "Licence Ouverte 2.0",
        url: "https://geoservices.ign.fr",
        readme: "docs/ANALYSE-IGN-LIDAR.md",
      },
      {
        what: {
          fr: "La Suisse au plus près — photographies aériennes et relief",
          en: "Switzerland up close — aerial photographs and relief",
        },
        who: "swisstopo (Office fédéral de topographie) — geo.admin.ch : SWISSIMAGE, swissALTI3D",
        licence: "Géodonnées libres (OGD)",
        url: "https://www.swisstopo.admin.ch",
        readme: "docs/ANALYSE-IGN-LIDAR.md",
      },
      {
        what: { fr: "Le sol au plus près — WorldCover 2021, Sentinel-2", en: "The ground up close — WorldCover 2021, Sentinel-2" },
        who: "ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021)",
        licence: CC_BY,
        url: "https://esa-worldcover.org/",
        readme: "assets/earth-surface/README.md",
      },
      {
        what: { fr: "La Terre vue d'orbite — Sentinel-2 cloudless 2021", en: "The Earth from orbit — Sentinel-2 cloudless 2021" },
        who: "EOX IT Services GmbH (modified Copernicus Sentinel data 2021)",
        licence: "CC BY-NC-SA 4.0",
        url: "https://s2maps.eu",
      },
      {
        what: { fr: "Les tuiles de relief — Terrarium", en: "The relief tiles — Terrarium" },
        who: "Mapzen, AWS Open Data",
      },
      {
        what: { fr: "Le relief de la Lune et de Mars — LOLA, MOLA", en: "The Moon's and Mars' relief — LOLA, MOLA" },
        who: "NASA/GSFC — Lunar Reconnaissance Orbiter, Mars Global Surveyor",
      },
      {
        what: { fr: "Les planètes et leurs lunes", en: "The planets and their moons" },
        who: "NASA/USGS/JPL mission imagery",
        readme: "assets/planets-hd/README.md",
      },
      {
        what: { fr: "Jupiter — Cassini et Juno", en: "Jupiter — Cassini and Juno" },
        who: "NASA / JPL-Caltech / SSI / SwRI / MSSS / ASI / INAF / JIRAM / Björn Jónsson",
        licence: "CC BY 3.0",
        url: "https://www.planetary.org/space-images/merged-cassini-and-juno",
        readme: "assets/planets-hd/README.md",
      },
      {
        what: { fr: "Les orbites de l'ISS", en: "The ISS's orbit" },
        who: "CelesTrak",
        url: "https://celestrak.org",
        readme: "assets/iss/README.md",
      },
    ],
  },
  {
    id: "live",
    title: { fr: "Les cartes, la météo, le trafic", en: "The maps, the weather, the traffic" },
    items: [
      {
        what: { fr: "Les bâtiments, les routes, les forêts", en: "The buildings, the roads, the forests" },
        who: "© OpenStreetMap contributors (ODbL) · OpenMapTiles · OpenFreeMap",
        url: "https://www.openstreetmap.org/copyright",
      },
      {
        what: { fr: "Les terrains et les pistes du monde", en: "The world's airfields and runways" },
        who: "OurAirports (public domain) — built into tiles by scripts/build-runways.ts",
        url: "https://ourairports.com/data/",
      },
      {
        what: { fr: "Les adresses", en: "The addresses" },
        who: "Photon (komoot) · Nominatim — OpenStreetMap",
        url: "https://photon.komoot.io",
      },
      { what: { fr: "La météo", en: "The weather" }, who: "Open-Meteo", licence: CC_BY, url: "https://open-meteo.com" },
      { what: { fr: "Les METAR", en: "The METARs" }, who: "VATSIM", url: "https://metar.vatsim.net" },
      {
        what: { fr: "Le trafic aérien en direct", en: "The live air traffic" },
        who: "The OpenSky Network",
        url: "https://opensky-network.org",
      },
    ],
  },
  {
    id: "photos",
    title: { fr: "Les photographies des paysages", en: "The landscapes' photographs" },
    items: LANDSCAPES.map((l) => ({
      what: sceneText(l.scene),
      who: l.photo.author,
      licence: l.photo.licence,
      url: l.photo.page,
    })),
  },
  {
    id: "software",
    title: { fr: "Logiciels et polices", en: "Software and fonts" },
    items: [
      {
        what: { fr: "L'orbe de chargement — thinking-orbs", en: "The loading orb — thinking-orbs" },
        who: "Jakub Antalík",
        licence: "MIT",
        url: "https://github.com/Jakubantalik/thinking-orbs",
      },
      { what: { fr: "Inter", en: "Inter" }, who: "Rasmus Andersson", licence: "SIL OFL 1.1" },
      { what: { fr: "JetBrains Mono", en: "JetBrains Mono" }, who: "JetBrains", licence: "SIL OFL 1.1" },
      { what: { fr: "Rajdhani", en: "Rajdhani" }, who: "Indian Type Foundry", licence: "SIL OFL 1.1" },
      { what: { fr: "Le moteur", en: "The engine" }, who: "WebGPU · Bun" },
    ],
  },
  {
    id: "thanks",
    title: { fr: "Hommage", en: "Homage" },
    items: [
      {
        what: {
          fr: "À Interstellar (2014) et à la physique de Kip Thorne — un hommage non officiel",
          en: "To Interstellar (2014) and Kip Thorne's physics — an unofficial homage",
        },
        who: "Christopher Nolan · Kip Thorne · Double Negative",
      },
    ],
  },
];

/** a credit's authors in a language */
export const whoOf = (c: Credit, l = lang) => (typeof c.who === "string" ? c.who : c.who[l]);

/** A credit's line: what, by whom, under which licence. */
export const creditLine = (c: Credit) => [tr(c.what), whoOf(c), c.licence].filter(Boolean).join(" — ");

/** CREDITS.md: the sections, each entry its work, its authors, its licence and its link. */
export function creditsMarkdown(l: "fr" | "en" = "en"): string {
  const out = [
    "# Credits",
    "",
    "Generated from `src/ui/title/credits.ts` by `bun scripts/build-credits.ts` — do not edit by hand. The game shows",
    "them in More… › Credits.",
    "",
  ];
  for (const s of CREDITS) {
    out.push(`## ${s.title[l]}`, "");
    for (const c of s.items) {
      const what = c.url ? `[${c.what[l]}](${c.url})` : c.what[l];
      out.push(`- ${what} — ${whoOf(c, l)}${c.licence ? ` · ${c.licence}` : ""}`);
    }
    out.push("");
  }
  return out.join("\n");
}
