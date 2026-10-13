// The Earth's exceptional landscapes, each rebuilt from a real photograph (Wikimedia Commons): the camera
// where the photographer stood, turned the way they looked, at the hour they pressed the shutter, through
// the same lens. The photograph is the reference the scene is judged against (tests/e2e/landscapes:
// side by side on the Mac); the scene gallery lists them under "Landscapes".
//
// A view stands on the ground (the camera on its tripod, as Yosemite's Tunnel View). Its direction comes,
// best first, from the summits the photo's page names at their pixels (solved for heading and pitch
// against the real relief: Terrarium tiles, z13), from its EXIF compass, or from the bearing to its
// subject; `headingFrom` says which. Without named summits, `pitch` frames the subject as the photo does
// (its elevation angle, from the same relief, less a share of the field).

/** A photograph on Wikimedia Commons: its page, author and licence (shown with the reference). */
export interface PhotoReference {
  /** the file's page, https://commons.wikimedia.org/wiki/File:… */
  page: string;
  author: string;
  licence: string;
  /** when it was taken, as its EXIF has it (local time) — and the place's offset from UTC then [h] */
  taken: string;
  utcOffset: number;
  /** the lens' focal length, 35 mm equivalent [mm] */
  focal35: number;
  /** a portrait frame (the long side vertical) */
  portrait?: boolean;
  /** what the photo's page does not give and the scene chose (a time, a year, a lens) — and why */
  estimated?: string;
}

export interface Landscape {
  /** the scene's name (presets' key): "Earth: …" */
  scene: string;
  title: string;
  description: string;
  icon: string;
  /** where the camera stands: latitude, east longitude [°] (the photo's camera location) */
  at: [number, number];
  /** what the view is about: latitude, east longitude [°] (the photo's subject) */
  subject: [number, number];
  /** the view's direction [° from the north, eastwards]; none: the bearing to `subject` */
  heading?: number;
  /** where `heading` comes from; "photograph": the capture's skyline aligned on the photograph's
   *  (scripts/landscapes-compare.html), the pitch with it */
  headingFrom: "landmarks" | "exif" | "subject" | "photograph";
  /** the look above the level [°] */
  pitch: number;
  /** the viewpoint's clearing of procedural trees [m] (LANDSCAPE_CLEARING_M when none: a lookout over a forest
   *  the photo looks across needs more) */
  clearing?: number;
  /** the scene's clouds (0: none — the photo's sky clear) */
  clouds?: number;
  photo: PhotoReference;
}

/** The viewpoint kept clear of procedural trees round where the photographer stood [m] (renderer's exclusions). */
export const LANDSCAPE_CLEARING_M = 60;

/** The vertical field of view [°] of a 35 mm equivalent focal length: 24 mm high, 36 mm in portrait. */
export function fovOf35mm(focal: number, portrait = false): number {
  return (2 * Math.atan((portrait ? 18 : 12) / focal) * 180) / Math.PI;
}
/** A landscape's vertical field of view [°]: its photo's. */
export const landscapeFov = (l: Landscape) => fovOf35mm(l.photo.focal35, l.photo.portrait);

/** The photo's moment as a UTC timestamp [ms]: its local EXIF time less the place's offset. */
export function photoUtc(p: PhotoReference): number {
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(p.taken);
  if (!m) throw new Error(`landscapes: bad time “${p.taken}”`);
  const [, y, mo, d, h, mi, s] = m.map(Number) as number[];
  return Date.UTC(y!, mo! - 1, d!, h!, mi!, s || 0) - p.utcOffset * 3600e3;
}

/** The great circle's initial bearing from a to b [° from the north, eastwards, 0 … 360). */
export function bearing(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180;
  const [p1, p2, dl] = [a[0] * r, b[0] * r, (b[1] - a[1]) * r];
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (((Math.atan2(y, x) / r) % 360) + 360) % 360;
}

/** The direction the view looks [°]. */
export const viewHeading = (l: Landscape) => l.heading ?? bearing(l.at, l.subject);

const C = "https://commons.wikimedia.org/wiki/File:";

export const LANDSCAPES: Landscape[] = [
  {
    // (Tower of Set, Horus and Osiris Temples at their annotated pixels: heading 349.4 … 350.3°, pitch −4.9 … −5.6°)
    scene: "Earth: the Grand Canyon from Hopi Point",
    title: "The Grand Canyon",
    description:
      "Hopi Point on the South Rim at 17:55 in September: the evening light on the Tower of Set, Horus, Osiris and Shiva Temples, the canyon two kilometres deep below.",
    icon: "◭",
    at: [36.074475, -112.15494],
    subject: [36.1360295, -112.178749],
    heading: 349.7,
    headingFrom: "landmarks",
    pitch: -5.2,
    photo: {
      page: `${C}Grand_Canyon_Hopi_Point_Evening_Light_2013.jpg`,
      author: "Tuxyso",
      licence: "CC BY-SA 3.0",
      taken: "2013:09:08 17:55:18",
      utcOffset: -7,
      focal35: 61,
    },
  },
  {
    scene: "Earth: the Matterhorn from the Riffelsee",
    title: "The Matterhorn",
    description:
      "From the Riffelsee, 2 757 m, on a June morning: the Matterhorn's east face and Hörnli ridge across the lake, eight kilometres off.",
    icon: "▲",
    at: [45.983417, 7.762778],
    subject: [45.9764263, 7.6586024],
    heading: 265,
    headingFrom: "exif",
    pitch: 1,
    photo: {
      page: `${C}Matterhorn_Riffelsee_2005-06-11.jpg`,
      author: "Dirk Beyer",
      licence: "CC BY-SA 3.0",
      taken: "2005:06:11 09:50:43",
      utcOffset: 2,
      focal35: 51,
      portrait: true,
    },
  },
  {
    scene: "Earth: Mont Blanc from the Lac Blanc",
    title: "Mont Blanc",
    description:
      "The Lac Blanc above Chamonix, 2 352 m, at midday in September: the whole massif across the valley — the Aiguille Verte, the Mer de Glace, Mont Blanc 17 km away.",
    icon: "⛰",
    at: [45.981761, 6.891294],
    subject: [45.8327056, 6.8651706],
    // (checked against the photograph on 13 Oct 2026: the skyline matched at 0.96 turned 7° west, 12° lower — the lake fills the photo's lower half)
    heading: 194.3,
    headingFrom: "photograph",
    pitch: -9,
    photo: {
      page: `${C}Mont_Blanc_@_Lac_Blanc_@_Chamonix_(51486759213).jpg`,
      author: "Guilhem Vellut",
      licence: "CC BY 2.0",
      taken: "2021:09:08 13:26:52",
      utcOffset: 2,
      focal35: 23,
    },
  },
  {
    scene: "Earth: the Geirangerfjord from Flydalsjuvet",
    title: "The Geirangerfjord",
    description: "Flydalsjuvet in June: Geiranger at the fjord's head 300 m below, the fjord winding away north-west between its walls.",
    icon: "≈",
    at: [62.089903, 7.222863],
    subject: [62.1006277, 7.2058959],
    // (checked against the photograph: the skyline matched at 0.96 turned 1.5° left, 4° higher)
    heading: 322,
    headingFrom: "photograph",
    pitch: -4,
    photo: {
      page: `${C}View_of_Geiranger,_as_seen_from_Flydalsjuvet_Viewpoint_20150604_1.jpg`,
      author: "DXR",
      licence: "CC BY-SA 4.0",
      taken: "2015:06:04 18:00:00",
      utcOffset: 2,
      focal35: 18,
      estimated: "the hour (the page gives the day only)",
    },
  },
  {
    scene: "Earth: Reine from Reinebringen",
    title: "Reine, the Lofoten",
    description:
      "From Reinebringen's summit, 448 m, on a July afternoon: Reine's islets and red cabins far below, the fjord and the Lofoten's sharp peaks around.",
    icon: "⌂",
    at: [67.927787, 13.073984],
    subject: [67.9324675, 13.0887684],
    // (checked against the photograph: the massif across the water at eye level, not Reine below — the frame nearly level, turned 6°)
    heading: 56,
    headingFrom: "photograph",
    pitch: -4,
    photo: {
      page: `${C}Moskenes_Reinebringen_lub_2025-07-21_img02_Aussicht.jpg`,
      author: "Lukas Beck",
      licence: "CC BY 4.0",
      taken: "2025:07:21 16:15:49",
      utcOffset: 2,
      focal35: 56,
    },
  },
  {
    scene: "Earth: Kirkjufell over Kirkjufellsfoss",
    title: "Kirkjufell",
    description:
      "Kirkjufellsfoss in July at 16:30: the falls in front, Kirkjufell's cone behind, sun and heavy showers over the Snæfellsnes peninsula.",
    icon: "◮",
    at: [64.925962, -23.312261],
    subject: [64.9399465, -23.3074783],
    // (checked against the photograph: Kirkjufell's cone stands left of the middle, at 0.38 of the width — 14° right of the bearing to its summit)
    heading: 22,
    headingFrom: "photograph",
    pitch: 6,
    clouds: 0.6,
    photo: {
      page: `${C}Kirkjufell,_Iceland,_20240714_1631_0713.jpg`,
      author: "Jakub Hałun",
      licence: "CC BY 4.0",
      taken: "2024:07:14 16:31:31",
      utcOffset: 0,
      focal35: 24,
    },
  },
  {
    scene: "Earth: Lauterbrunnen and the Staubbach Falls",
    title: "Lauterbrunnen",
    description:
      "Lauterbrunnen at midday in September: the Staubbach falling 300 m off the valley's sheer western wall, the glacial trough running south.",
    icon: "║",
    at: [46.594179, 7.907383],
    subject: [46.589776, 7.905429],
    headingFrom: "subject",
    pitch: 12,
    photo: {
      page: `${C}Staubbachfall_in_Lauterbrunnen_BE.jpg`,
      author: "JoachimKohler-HB",
      licence: "CC BY-SA 4.0",
      taken: "2019:09:21 12:46:30",
      utcOffset: 2,
      focal35: 46,
      portrait: true,
    },
  },
  {
    scene: "Earth: the Cuernos del Paine",
    title: "Torres del Paine",
    description:
      "In the Valle del Francés on an April afternoon: the Cuernos del Paine's granite and their black slate caps, a kilometre above.",
    icon: "♜",
    at: [-51.008533, -73.052612],
    subject: [-50.9989054, -73.0064441],
    // (the forest the WorldCover map puts round the lookout, 500 m of it, hid the massif — the photo looks across open
    // ground)
    clearing: 500,
    headingFrom: "subject",
    pitch: 8,
    photo: {
      page: `${C}AOB_Torres_del_Paine_cuernos.jpg`,
      author: "Alfredo Olivares Bueno",
      licence: "CC BY 4.0",
      taken: "2025:04:12 15:59:31",
      utcOffset: -3,
      focal35: 26,
    },
  },
  {
    scene: "Earth: Fitz Roy above the Laguna de los Tres",
    title: "Fitz Roy",
    description:
      "Below the Laguna de los Tres at midday in December: the Fitz Roy massif's granite towers, the Laguna Sucia's glacier beneath them.",
    icon: "⩘",
    at: [-49.281578, -72.986686],
    subject: [-49.2712498, -73.0432115],
    headingFrom: "subject",
    pitch: 9,
    photo: {
      page: `${C}Fitz_Roy_massif_2015_1.JPG`,
      author: "Fredlyfish4",
      licence: "CC BY-SA 4.0",
      taken: "2015:12:14 13:12:00",
      utcOffset: -3,
      focal35: 24,
      estimated: "the lens (a stitched panorama): the scene's field holds the massif",
    },
  },
  {
    scene: "Earth: Mount Fuji across Lake Kawaguchi",
    title: "Mount Fuji",
    description: "Lake Kawaguchi's shore in March at midday: Fuji's snow cone 17 km to the south over the water and the Ubuyagasaki cape.",
    icon: "🗻",
    at: [35.513276, 138.76601],
    subject: [35.3628384, 138.7307677],
    heading: 185,
    headingFrom: "exif",
    pitch: 4,
    photo: {
      page: `${C}Mount_Fuji_behind_Ubuyagasaki,_Fujikawaguchiko,_2016.jpg`,
      author: "DimiTalen",
      licence: "CC0",
      taken: "2016:03:27 12:16:23",
      utcOffset: 9,
      focal35: 30,
    },
  },
  {
    scene: "Earth: Moraine Lake and the Valley of the Ten Peaks",
    title: "Moraine Lake",
    description:
      "From the Rockpile on a June evening: the turquoise lake below the Valley of the Ten Peaks, Deltaform and Wenkchemna in the low light.",
    icon: "▴",
    at: [51.327483, -116.180039],
    subject: [51.3013438, -116.2448273],
    heading: 224.55,
    headingFrom: "exif",
    pitch: 5,
    photo: {
      page: `${C}Moraine_Lake_2018.jpg`,
      author: "WhyDon'tWeZJCDJ",
      licence: "CC BY-SA 4.0",
      taken: "2018:06:13 19:19:02",
      utcOffset: -6,
      focal35: 28,
    },
  },
  {
    scene: "Earth: the dunes of Sossusvlei",
    title: "Sossusvlei",
    description: "From Deadvlei's white pan at 09:49 in August: the red dunes' crests and their shadows, through a long telephoto lens.",
    icon: "∿",
    at: [-24.7588481, 15.2939213],
    subject: [-24.7581561, 15.3074213],
    headingFrom: "subject",
    pitch: 1,
    photo: {
      page: `${C}Sossusvlei,_Namibia,_2018-08-06,_DD_040.jpg`,
      author: "Diego Delso",
      licence: "CC BY-SA 4.0",
      taken: "2018:08:06 09:49:17",
      utcOffset: 2,
      focal35: 150,
    },
  },
  {
    // (the West Mitten, East Mitten and Merrick Buttes, left to right: about 51°, 80° and 100° from here)
    scene: "Earth: Monument Valley's Mittens",
    title: "Monument Valley",
    description:
      "Above the valley on a July afternoon: the West and East Mitten Buttes and Merrick Butte, left to right, on the red desert.",
    icon: "▙",
    at: [36.983487, -110.107917],
    subject: [36.9802834, -110.0862744],
    heading: 76,
    headingFrom: "subject",
    pitch: 2,
    photo: {
      page: `${C}Monument_Valley,_Arizona.jpg`,
      author: "Supercarwaar",
      licence: "CC BY-SA 4.0",
      taken: "2015:07:27 16:30:44",
      utcOffset: -6,
      focal35: 30,
    },
  },
  {
    scene: "Earth: Mount Moran from Oxbow Bend",
    title: "Oxbow Bend",
    description: "The Snake River's Oxbow Bend on a July morning: Mount Moran and the Teton Range beyond the still water.",
    icon: "⛰",
    at: [43.865781, -110.547636],
    subject: [43.8352104, -110.7763248],
    // (checked against the photograph: the skyline matched at 0.63 turned 4° left, 8.8° lower — the river and its banks fill the lower half)
    heading: 255.4,
    headingFrom: "photograph",
    pitch: -6.5,
    photo: {
      page: `${C}Oxbow_Bend_outlook_in_the_Grand_Teton_National_Park.jpg`,
      author: "Michael Gäbler",
      licence: "CC BY 3.0",
      taken: "2026:07:15 07:30:00",
      utcOffset: -6,
      focal35: 50,
      estimated: "the moment and the lens (a 1980 slide, July only): a July morning, the ephemeris' years",
    },
  },
];
