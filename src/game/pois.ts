// The Atlas's destinations (PLAN-MODES-AAA M6): the places worth going to on the Earth, the Moon and Mars — the
// launch sites, the summits and the wonders, the observatories, the poles; the Apollo sites and the craters, the
// seas and the poles of the Moon; the landers and the rovers, the volcanoes, the canyons and the caps of Mars.
// Each with its kind and a line on why. Latitudes and longitudes in degrees, planetocentric, east positive (the
// Earth's geodetic). The landing sites (game/sites.ts) and the landscapes' viewpoints join them in the Atlas.
// Pure data (tests/pois.test.ts).

import type { Text } from "../i18n";

export type PoiKind =
  | "launch"
  | "landmark"
  | "summit"
  | "nature"
  | "observatory"
  | "city"
  | "pole"
  | "landing"
  | "crater"
  | "sea"
  | "volcano"
  | "canyon";

export interface Poi {
  id: string;
  body: "earth" | "moon" | "mars";
  name: Text;
  kind: PoiKind;
  lat: number;
  lon: number;
  /** why go there */
  about: Text;
  /** the ground's height there, when it matters (a summit) [m] */
  elevM?: number;
}

const P = (
  id: string,
  body: Poi["body"],
  kind: PoiKind,
  lat: number,
  lon: number,
  name: Text | string,
  about: Text,
  elevM?: number,
): Poi => ({ id, body, kind, lat, lon, name: typeof name === "string" ? { fr: name, en: name } : name, about, elevM });

export const POIS: Poi[] = [
  // ---- the Earth: launch sites
  P(
    "ksc-39a",
    "earth",
    "launch",
    28.6084,
    -80.6043,
    { fr: "Kennedy, pas de tir 39A", en: "Kennedy, Launch Complex 39A" },
    {
      fr: "Le pas de tir d'Apollo 11, de la navette et de Falcon Heavy",
      en: "Where Apollo 11, the Shuttle and Falcon Heavy lifted off",
    },
  ),
  P(
    "baikonur",
    "earth",
    "launch",
    45.965,
    63.305,
    { fr: "Baïkonour", en: "Baikonur" },
    {
      fr: "Le cosmodrome de Spoutnik et de Gagarine, dans la steppe kazakhe",
      en: "Sputnik's and Gagarin's cosmodrome, in the Kazakh steppe",
    },
  ),
  P(
    "kourou",
    "earth",
    "launch",
    5.236,
    -52.775,
    { fr: "Kourou, Centre spatial guyanais", en: "Kourou, Guiana Space Centre" },
    {
      fr: "Le port spatial de l'Europe, au bord de l'équateur",
      en: "Europe's spaceport, near the equator",
    },
  ),
  P("vandenberg", "earth", "launch", 34.742, -120.572, "Vandenberg", {
    fr: "Les lancements vers les orbites polaires, sur la côte californienne",
    en: "Launches to polar orbits, on the Californian coast",
  }),
  P("starbase", "earth", "launch", 25.997, -97.157, "Starbase", {
    fr: "Les essais de Starship, à Boca Chica",
    en: "Starship's test site, at Boca Chica",
  }),
  P("tanegashima", "earth", "launch", 30.4, 130.97, "Tanegashima", {
    fr: "Le centre spatial japonais, sur son île subtropicale",
    en: "Japan's space centre, on its subtropical island",
  }),
  P("jiuquan", "earth", "launch", 40.958, 100.291, "Jiuquan", {
    fr: "Le premier cosmodrome chinois, dans le désert de Gobi",
    en: "China's first cosmodrome, in the Gobi desert",
  }),
  // ---- the Earth: summits
  P("everest", "earth", "summit", 27.9881, 86.925, "Everest", { fr: "Le toit du monde", en: "The roof of the world" }, 8849),
  P(
    "k2",
    "earth",
    "summit",
    35.8808,
    76.5155,
    "K2",
    { fr: "La montagne sauvage, au Karakoram", en: "The savage mountain, in the Karakoram" },
    8611,
  ),
  P("mont-blanc", "earth", "summit", 45.8326, 6.8652, "Mont Blanc", { fr: "Le sommet des Alpes", en: "The summit of the Alps" }, 4806),
  P(
    "matterhorn",
    "earth",
    "summit",
    45.9763,
    7.6586,
    { fr: "Cervin", en: "Matterhorn" },
    { fr: "La pyramide des Alpes", en: "The Alps' pyramid" },
    4478,
  ),
  P("kilimanjaro", "earth", "summit", -3.0674, 37.3556, "Kilimanjaro", { fr: "Les neiges de l'Afrique", en: "Africa's snows" }, 5895),
  P(
    "aconcagua",
    "earth",
    "summit",
    -32.6532,
    -70.0109,
    "Aconcagua",
    { fr: "Le plus haut des Andes", en: "The highest of the Andes" },
    6961,
  ),
  P(
    "denali",
    "earth",
    "summit",
    63.0692,
    -151.007,
    "Denali",
    { fr: "Le plus haut de l'Amérique du Nord", en: "North America's highest" },
    6190,
  ),
  P(
    "fuji",
    "earth",
    "summit",
    35.3606,
    138.7274,
    { fr: "Mont Fuji", en: "Mount Fuji" },
    { fr: "Le volcan sacré du Japon", en: "Japan's sacred volcano" },
    3776,
  ),
  P("fitz-roy", "earth", "summit", -49.2712, -73.0433, "Fitz Roy", { fr: "Les aiguilles de Patagonie", en: "Patagonia's spires" }, 3405),
  // ---- the Earth: wonders of nature
  P("grand-canyon", "earth", "nature", 36.0619, -112.1076, "Grand Canyon", {
    fr: "Deux milliards d'années dans la roche",
    en: "Two billion years in the rock",
  }),
  P(
    "yosemite",
    "earth",
    "nature",
    37.7156,
    -119.6774,
    { fr: "Yosemite, Tunnel View", en: "Yosemite, Tunnel View" },
    {
      fr: "El Capitan, Half Dome et la vallée",
      en: "El Capitan, Half Dome and the valley",
    },
  ),
  P("monument-valley", "earth", "nature", 36.998, -110.0985, "Monument Valley", {
    fr: "Les buttes du western",
    en: "The westerns' buttes",
  }),
  P("uluru", "earth", "nature", -25.3444, 131.0369, "Uluru", {
    fr: "Le monolithe rouge du centre australien",
    en: "The red monolith of Australia's centre",
  }),
  P(
    "victoria-falls",
    "earth",
    "nature",
    -17.9243,
    25.8572,
    { fr: "Chutes Victoria", en: "Victoria Falls" },
    { fr: "La fumée qui gronde", en: "The smoke that thunders" },
  ),
  P(
    "iguazu",
    "earth",
    "nature",
    -25.6953,
    -54.4367,
    { fr: "Chutes d'Iguazú", en: "Iguazú Falls" },
    { fr: "Des centaines de cascades", en: "Hundreds of waterfalls" },
  ),
  P(
    "niagara",
    "earth",
    "nature",
    43.0828,
    -79.0742,
    { fr: "Chutes du Niagara", en: "Niagara Falls" },
    { fr: "Le fer à cheval canadien", en: "The Canadian Horseshoe" },
  ),
  P(
    "uyuni",
    "earth",
    "nature",
    -20.1338,
    -67.4891,
    { fr: "Salar d'Uyuni", en: "Salar de Uyuni" },
    { fr: "Le plus grand miroir du monde", en: "The world's largest mirror" },
  ),
  P("sossusvlei", "earth", "nature", -24.7275, 15.3437, "Sossusvlei", { fr: "Les dunes rouges du Namib", en: "The Namib's red dunes" }),
  P("erg-chebbi", "earth", "nature", 31.145, -3.98, "Erg Chebbi", {
    fr: "Les dunes du Sahara marocain",
    en: "The Moroccan Sahara's dunes",
  }),
  P(
    "atacama",
    "earth",
    "nature",
    -22.9087,
    -68.1997,
    { fr: "Atacama, Vallée de la Lune", en: "Atacama, Valley of the Moon" },
    {
      fr: "Le désert le plus sec, un paysage lunaire",
      en: "The driest desert, a lunar landscape",
    },
  ),
  P(
    "lofoten",
    "earth",
    "nature",
    67.9323,
    13.089,
    { fr: "Lofoten, Reine", en: "Lofoten, Reine" },
    { fr: "Les fjords sous les aurores", en: "Fjords under the auroras" },
  ),
  P("jokulsarlon", "earth", "nature", 64.0784, -16.2306, "Jökulsárlón", { fr: "Le lagon des icebergs", en: "The iceberg lagoon" }),
  P("torres-del-paine", "earth", "nature", -50.9423, -72.9682, "Torres del Paine", {
    fr: "Les tours de granite",
    en: "The granite towers",
  }),
  P(
    "yellowstone",
    "earth",
    "nature",
    44.5251,
    -110.8382,
    { fr: "Yellowstone, Grand Prismatic", en: "Yellowstone, Grand Prismatic" },
    {
      fr: "La source aux couleurs de l'arc-en-ciel",
      en: "The rainbow-coloured spring",
    },
  ),
  P("erta-ale", "earth", "volcano", 13.6, 40.67, "Erta Ale", { fr: "Un lac de lave dans le Danakil", en: "A lava lake in the Danakil" }),
  P("meteor-crater", "earth", "crater", 35.0274, -111.0225, "Meteor Crater", {
    fr: "L'impact le mieux conservé",
    en: "The best-preserved impact",
  }),
  P(
    "dead-sea",
    "earth",
    "nature",
    31.559,
    35.4732,
    { fr: "Mer Morte", en: "Dead Sea" },
    { fr: "Le point le plus bas des terres", en: "The lowest point on land" },
    -430,
  ),
  P(
    "halong",
    "earth",
    "nature",
    20.9101,
    107.1839,
    { fr: "Baie d'Along", en: "Ha Long Bay" },
    { fr: "Les pitons calcaires sur la mer", en: "Limestone pillars over the sea" },
  ),
  P(
    "barrier-reef",
    "earth",
    "nature",
    -23.4423,
    151.9148,
    { fr: "Grande Barrière, île Heron", en: "Great Barrier Reef, Heron Island" },
    {
      fr: "Le plus grand récif corallien",
      en: "The largest coral reef",
    },
  ),
  // ---- the Earth: observatories (for the sky)
  P(
    "paranal",
    "earth",
    "observatory",
    -24.6272,
    -70.4042,
    { fr: "Paranal (VLT)", en: "Paranal (VLT)" },
    {
      fr: "Le ciel le plus pur, au-dessus du Pacifique",
      en: "The purest sky, above the Pacific",
    },
    2635,
  ),
  P(
    "mauna-kea",
    "earth",
    "observatory",
    19.8207,
    -155.4681,
    "Mauna Kea",
    { fr: "Les télescopes au-dessus des nuages", en: "Telescopes above the clouds" },
    4207,
  ),
  P(
    "pic-du-midi",
    "earth",
    "observatory",
    42.9364,
    0.1426,
    { fr: "Pic du Midi", en: "Pic du Midi" },
    {
      fr: "L'observatoire des Pyrénées, réserve de ciel étoilé",
      en: "The Pyrenees' observatory, a dark-sky reserve",
    },
    2877,
  ),
  P(
    "la-palma",
    "earth",
    "observatory",
    28.7606,
    -17.8816,
    { fr: "La Palma, Roque de los Muchachos", en: "La Palma, Roque de los Muchachos" },
    {
      fr: "Les télescopes des Canaries",
      en: "The Canaries' telescopes",
    },
    2396,
  ),
  // ---- the Earth: landmarks and cities
  P(
    "eiffel",
    "earth",
    "landmark",
    48.8584,
    2.2945,
    { fr: "Tour Eiffel", en: "Eiffel Tower" },
    { fr: "Paris, du Champ-de-Mars", en: "Paris, from the Champ de Mars" },
  ),
  P("mont-saint-michel", "earth", "landmark", 48.6361, -1.5115, "Mont-Saint-Michel", {
    fr: "L'abbaye entre les marées",
    en: "The abbey between the tides",
  }),
  P(
    "giza",
    "earth",
    "landmark",
    29.9792,
    31.1342,
    { fr: "Pyramides de Gizeh", en: "Pyramids of Giza" },
    { fr: "La dernière merveille du monde antique", en: "The last wonder of the ancient world" },
  ),
  P("petra", "earth", "landmark", 30.3285, 35.4444, "Petra", {
    fr: "La cité taillée dans le grès rose",
    en: "The city carved in rose sandstone",
  }),
  P("machu-picchu", "earth", "landmark", -13.1631, -72.545, "Machu Picchu", {
    fr: "La cité inca dans les nuages",
    en: "The Inca city in the clouds",
  }),
  P("taj-mahal", "earth", "landmark", 27.1751, 78.0421, "Taj Mahal", {
    fr: "Le mausolée de marbre blanc",
    en: "The white marble mausoleum",
  }),
  P(
    "great-wall",
    "earth",
    "landmark",
    40.4319,
    116.5704,
    { fr: "Grande Muraille, Mutianyu", en: "Great Wall, Mutianyu" },
    { fr: "La muraille sur les crêtes", en: "The wall on the ridges" },
  ),
  P("manhattan", "earth", "city", 40.7831, -73.9712, "Manhattan", {
    fr: "New York, entre les gratte-ciel",
    en: "New York, among the skyscrapers",
  }),
  P(
    "tokyo",
    "earth",
    "city",
    35.6762,
    139.6503,
    { fr: "Tokyo", en: "Tokyo" },
    { fr: "La plus grande ville du monde", en: "The world's largest city" },
  ),
  P(
    "rio",
    "earth",
    "landmark",
    -22.9519,
    -43.2105,
    { fr: "Rio, le Christ rédempteur", en: "Rio, Christ the Redeemer" },
    { fr: "La baie de Guanabara", en: "Guanabara Bay" },
  ),
  P(
    "sydney",
    "earth",
    "landmark",
    -33.8568,
    151.2153,
    { fr: "Opéra de Sydney", en: "Sydney Opera House" },
    { fr: "Les voiles sur le port", en: "The sails on the harbour" },
  ),
  P(
    "table-mountain",
    "earth",
    "landmark",
    -33.9628,
    18.4098,
    { fr: "Montagne de la Table", en: "Table Mountain" },
    { fr: "Le Cap, entre deux océans", en: "Cape Town, between two oceans" },
  ),
  // ---- the Earth: poles and far places
  P(
    "north-pole",
    "earth",
    "pole",
    90,
    0,
    { fr: "Pôle Nord", en: "North Pole" },
    { fr: "La banquise, le Soleil qui tourne sans se coucher", en: "The pack ice, the Sun circling without setting" },
  ),
  P(
    "south-pole",
    "earth",
    "pole",
    -90,
    0,
    { fr: "Pôle Sud", en: "South Pole" },
    { fr: "Le plateau antarctique, à 2 800 m", en: "The Antarctic plateau, at 2,800 m" },
    2835,
  ),
  P("mcmurdo", "earth", "pole", -77.8463, 166.6682, "McMurdo", { fr: "La base au pied de l'Erebus", en: "The base at the foot of Erebus" }),
  P(
    "svalbard",
    "earth",
    "pole",
    78.2232,
    15.6267,
    { fr: "Svalbard, Longyearbyen", en: "Svalbard, Longyearbyen" },
    { fr: "La nuit polaire et les aurores", en: "The polar night and the auroras" },
  ),
  // ---- the Moon: the landings
  P(
    "apollo-11",
    "moon",
    "landing",
    0.6741,
    23.473,
    { fr: "Apollo 11, Base de la Tranquillité", en: "Apollo 11, Tranquility Base" },
    {
      fr: "Le premier pas, 20 juillet 1969",
      en: "The first step, 20 July 1969",
    },
  ),
  P(
    "apollo-12",
    "moon",
    "landing",
    -3.0124,
    -23.4216,
    { fr: "Apollo 12, Océan des Tempêtes", en: "Apollo 12, Ocean of Storms" },
    {
      fr: "À côté de la sonde Surveyor 3",
      en: "Beside the Surveyor 3 probe",
    },
  ),
  P(
    "apollo-14",
    "moon",
    "landing",
    -3.6453,
    -17.4714,
    { fr: "Apollo 14, Fra Mauro", en: "Apollo 14, Fra Mauro" },
    { fr: "Les balles de golf de Shepard", en: "Shepard's golf balls" },
  ),
  P(
    "apollo-15",
    "moon",
    "landing",
    26.1322,
    3.6339,
    { fr: "Apollo 15, Hadley-Apennin", en: "Apollo 15, Hadley–Apennine" },
    {
      fr: "Le premier rover, au bord de la Rima Hadley",
      en: "The first rover, by Hadley Rille",
    },
  ),
  P(
    "apollo-16",
    "moon",
    "landing",
    -8.973,
    15.5002,
    { fr: "Apollo 16, Descartes", en: "Apollo 16, Descartes" },
    { fr: "Les hauts plateaux", en: "The highlands" },
  ),
  P(
    "apollo-17",
    "moon",
    "landing",
    20.1908,
    30.7717,
    { fr: "Apollo 17, Taurus-Littrow", en: "Apollo 17, Taurus–Littrow" },
    {
      fr: "Le dernier pas, décembre 1972",
      en: "The last step, December 1972",
    },
  ),
  P(
    "change-4",
    "moon",
    "landing",
    -45.4446,
    177.5991,
    { fr: "Chang'e 4, cratère von Kármán", en: "Chang'e 4, von Kármán crater" },
    {
      fr: "Le premier atterrissage sur la face cachée",
      en: "The first landing on the far side",
    },
  ),
  // ---- the Moon: craters, seas, mountains, poles
  P("tycho", "moon", "crater", -43.31, -11.36, "Tycho", {
    fr: "Le cratère jeune aux grands rayons",
    en: "The young crater with its great rays",
  }),
  P(
    "copernicus",
    "moon",
    "crater",
    9.62,
    -20.08,
    { fr: "Copernic", en: "Copernicus" },
    { fr: "Le monarque de la Lune", en: "The Moon's monarch" },
  ),
  P(
    "aristarchus",
    "moon",
    "crater",
    23.7,
    -47.4,
    { fr: "Aristarque", en: "Aristarchus" },
    { fr: "Le cratère le plus brillant", en: "The brightest crater" },
  ),
  P("clavius", "moon", "crater", -58.4, -14.4, "Clavius", {
    fr: "Le géant des hauts plateaux du sud",
    en: "The southern highlands' giant",
  }),
  P("plato", "moon", "crater", 51.6, -9.4, { fr: "Platon", en: "Plato" }, { fr: "Le lac de lave sombre", en: "The dark lava lake" }),
  P("shackleton", "moon", "pole", -89.67, 129.78, "Shackleton", {
    fr: "Au pôle Sud, l'ombre éternelle et la glace",
    en: "At the south pole, eternal shadow and ice",
  }),
  P("peary", "moon", "pole", 88.6, 33, "Peary", {
    fr: "Au pôle Nord, la lumière presque éternelle",
    en: "At the north pole, near-eternal light",
  }),
  P(
    "imbrium",
    "moon",
    "sea",
    32.8,
    -15.6,
    { fr: "Mer des Pluies", en: "Mare Imbrium" },
    { fr: "Le grand bassin d'impact", en: "The great impact basin" },
  ),
  P(
    "serenitatis",
    "moon",
    "sea",
    28,
    17.5,
    { fr: "Mer de la Sérénité", en: "Mare Serenitatis" },
    { fr: "L'œil gauche du visage", en: "The face's left eye" },
  ),
  P(
    "orientale",
    "moon",
    "sea",
    -19.4,
    -92.8,
    { fr: "Mer Orientale", en: "Mare Orientale" },
    { fr: "La cible en anneaux, au bord", en: "The ringed target, on the limb" },
  ),
  P(
    "apenninus",
    "moon",
    "summit",
    19.9,
    -2.9,
    { fr: "Mont Huygens, Apennins", en: "Mons Huygens, Apennines" },
    { fr: "Le plus haut sommet lunaire de la face visible", en: "The near side's highest peak" },
    5500,
  ),
  P(
    "rupes-recta",
    "moon",
    "canyon",
    -22.1,
    -7.8,
    { fr: "Rupes Recta, le mur droit", en: "Rupes Recta, the Straight Wall" },
    {
      fr: "Une faille de 110 km en ligne droite",
      en: "A 110 km fault in a straight line",
    },
  ),
  // ---- Mars: the landers and the rovers
  P(
    "curiosity",
    "mars",
    "landing",
    -4.5895,
    137.4417,
    { fr: "Curiosity, cratère Gale", en: "Curiosity, Gale crater" },
    {
      fr: "Au pied du mont Sharp",
      en: "At the foot of Mount Sharp",
    },
  ),
  P(
    "perseverance",
    "mars",
    "landing",
    18.4447,
    77.4508,
    { fr: "Perseverance, cratère Jezero", en: "Perseverance, Jezero crater" },
    {
      fr: "Un ancien delta, et Ingenuity",
      en: "An ancient delta, and Ingenuity",
    },
  ),
  P(
    "viking-1",
    "mars",
    "landing",
    22.27,
    -47.95,
    { fr: "Viking 1, Chryse", en: "Viking 1, Chryse" },
    { fr: "Le premier atterrissage réussi, 1976", en: "The first successful landing, 1976" },
  ),
  P(
    "viking-2",
    "mars",
    "landing",
    47.64,
    134.29,
    { fr: "Viking 2, Utopia", en: "Viking 2, Utopia" },
    { fr: "Le givre dans les plaines du nord", en: "Frost in the northern plains" },
  ),
  P(
    "pathfinder",
    "mars",
    "landing",
    19.13,
    -33.22,
    { fr: "Pathfinder, Ares Vallis", en: "Pathfinder, Ares Vallis" },
    { fr: "Le petit Sojourner", en: "Little Sojourner" },
  ),
  P(
    "spirit",
    "mars",
    "landing",
    -14.5684,
    175.4726,
    { fr: "Spirit, cratère Gusev", en: "Spirit, Gusev crater" },
    { fr: "La Home Plate", en: "Home Plate" },
  ),
  P(
    "opportunity",
    "mars",
    "landing",
    -1.9462,
    -5.5272,
    { fr: "Opportunity, Meridiani", en: "Opportunity, Meridiani" },
    {
      fr: "Quinze ans au cratère Endeavour",
      en: "Fifteen years at Endeavour crater",
    },
  ),
  P(
    "insight",
    "mars",
    "landing",
    4.502,
    135.623,
    { fr: "InSight, Elysium", en: "InSight, Elysium" },
    { fr: "Le sismographe martien", en: "The Martian seismometer" },
  ),
  P(
    "zhurong",
    "mars",
    "landing",
    25.066,
    109.925,
    { fr: "Zhurong, Utopia", en: "Zhurong, Utopia" },
    { fr: "Le rover chinois", en: "China's rover" },
  ),
  P(
    "phoenix",
    "mars",
    "landing",
    68.22,
    -125.75,
    { fr: "Phoenix, Vastitas Borealis", en: "Phoenix, Vastitas Borealis" },
    { fr: "La glace sous la surface", en: "The ice under the surface" },
  ),
  // ---- Mars: volcanoes, canyons, basins, caps
  P(
    "olympus-mons",
    "mars",
    "volcano",
    18.65,
    -133.8,
    "Olympus Mons",
    { fr: "Le plus grand volcan du système solaire", en: "The solar system's largest volcano" },
    21900,
  ),
  P(
    "arsia-mons",
    "mars",
    "volcano",
    -8.26,
    -120.09,
    "Arsia Mons",
    { fr: "Le volcan du sud de Tharsis", en: "Tharsis's southern volcano" },
    17700,
  ),
  P(
    "pavonis-mons",
    "mars",
    "volcano",
    1.48,
    -112.96,
    "Pavonis Mons",
    { fr: "Sur l'équateur, au cœur de Tharsis", en: "On the equator, at Tharsis's heart" },
    14000,
  ),
  P(
    "ascraeus-mons",
    "mars",
    "volcano",
    11.92,
    -104.08,
    "Ascraeus Mons",
    { fr: "Le volcan du nord de Tharsis", en: "Tharsis's northern volcano" },
    18200,
  ),
  P("elysium-mons", "mars", "volcano", 25.02, 147.21, "Elysium Mons", { fr: "Le volcan d'Elysium", en: "Elysium's volcano" }, 12600),
  P(
    "valles-marineris",
    "mars",
    "canyon",
    -10.5,
    -73,
    { fr: "Valles Marineris, Melas Chasma", en: "Valles Marineris, Melas Chasma" },
    {
      fr: "Un canyon de 4 000 km, profond de 7 km",
      en: "A 4,000 km canyon, 7 km deep",
    },
  ),
  P("noctis", "mars", "canyon", -7, -101, "Noctis Labyrinthus", { fr: "Le labyrinthe de la nuit", en: "The labyrinth of the night" }),
  P(
    "hellas",
    "mars",
    "crater",
    -42.4,
    70.5,
    { fr: "Hellas Planitia", en: "Hellas Planitia" },
    { fr: "Le bassin le plus profond", en: "The deepest basin" },
    -7150,
  ),
  P("cydonia", "mars", "landmark", 40.75, -9.46, "Cydonia", { fr: "Le « visage » de Mars", en: 'The "face" on Mars' }),
  P(
    "mars-north-cap",
    "mars",
    "pole",
    85,
    0,
    { fr: "Calotte polaire nord", en: "North polar cap" },
    { fr: "La glace d'eau en spirales", en: "Water ice in spirals" },
  ),
  P(
    "mars-south-cap",
    "mars",
    "pole",
    -87,
    0,
    { fr: "Calotte polaire sud", en: "South polar cap" },
    { fr: "La glace carbonique", en: "Carbon dioxide ice" },
  ),
];

/** The kinds' names, for the Atlas's filters. */
export const POI_KINDS: Record<PoiKind, Text> = {
  launch: { fr: "Bases de lancement", en: "Launch sites" },
  landmark: { fr: "Monuments", en: "Landmarks" },
  summit: { fr: "Sommets", en: "Summits" },
  nature: { fr: "Nature", en: "Nature" },
  observatory: { fr: "Observatoires", en: "Observatories" },
  city: { fr: "Villes", en: "Cities" },
  pole: { fr: "Pôles", en: "Poles" },
  landing: { fr: "Atterrissages", en: "Landings" },
  crater: { fr: "Cratères", en: "Craters" },
  sea: { fr: "Mers", en: "Seas" },
  volcano: { fr: "Volcans", en: "Volcanoes" },
  canyon: { fr: "Canyons", en: "Canyons" },
};

const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** The destinations matching words (in either language, accents ignored), the best first: a name's start, then a
 *  word's start, then anywhere in the name or the line. */
export function searchPois(q: string, list: Poi[] = POIS, body?: Poi["body"]): Poi[] {
  const w = fold(q.trim());
  const pool = body ? list.filter((p) => p.body === body) : list;
  if (!w) return pool;
  const score = (p: Poi) => {
    const names = [p.name.fr, p.name.en].map(fold);
    if (names.some((n) => n.startsWith(w))) return 3;
    if (names.some((n) => n.split(/[\s,'’()-]+/).some((x) => x.startsWith(w)))) return 2;
    if (names.some((n) => n.includes(w)) || [p.about.fr, p.about.en].map(fold).some((a) => a.includes(w))) return 1;
    return 0;
  };
  return pool
    .map((p) => ({ p, s: score(p) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.p);
}
