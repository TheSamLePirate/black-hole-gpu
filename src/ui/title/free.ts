// The free camera, on the title (PLAN-TITRE-AAA E6): the gallery full screen — the scenes by kind (the black holes,
// Gargantua, the wormhole, the solar system, the Earth, its landscapes), each a picture, a title, a line; the one
// focused shown large behind. The game's own flights (the "game" group: missions) are By ship's. Data only: the
// screen is ui/title/title.ts's, the launch the game's (TitleGame.freeScene: the scene, then the free camera).

import { t, type Text } from "../../i18n";
import { presets } from "../../settings";
import { SCENE_THUMBS } from "../scene-thumbs";
import { PRESET_INFO, type SceneGroup } from "../schema";

export type FreeTab = Exclude<SceneGroup, "game">;

export const FREE_TABS: { id: FreeTab; label: Text; hint: Text }[] = [
  {
    id: "hole",
    label: { fr: "Trous noirs", en: "Black holes" },
    hint: { fr: "La physique de Kerr : disques, jets, observateurs", en: "Kerr physics: disks, jets, observers" },
  },
  {
    id: "gargantua",
    label: { fr: "Gargantua", en: "Gargantua" },
    hint: { fr: "Le trou noir du film, son étoile et ses planètes", en: "The film's black hole, its star and its planets" },
  },
  {
    id: "wormhole",
    label: { fr: "Trou de ver", en: "Wormhole" },
    hint: { fr: "La sphère près de Saturne et ses mirages", en: "The sphere by Saturn and its lensing" },
  },
  {
    id: "solar",
    label: { fr: "Système solaire", en: "Solar system" },
    hint: { fr: "La Lune, les planètes, leurs lunes", en: "The Moon, the planets, their moons" },
  },
  {
    id: "earth",
    label: { fr: "Terre", en: "Earth" },
    hint: { fr: "Notre planète, de son sol et de ses orbites", en: "Our planet, from its ground and its orbits" },
  },
  {
    id: "landscapes",
    label: { fr: "Paysages", en: "Landscapes" },
    hint: {
      fr: "Les lieux d'exception de la Terre, refaits d'après photo",
      en: "The Earth's exceptional places, rebuilt from photographs",
    },
  },
];

export interface FreeScene {
  /** the scene's name (settings.ts presets) */
  name: string;
  title: string;
  text: string;
  art?: string;
}

/** A tab's scenes, in the gallery's order. */
export function freeScenes(tab: FreeTab): FreeScene[] {
  return Object.keys(presets)
    .filter((n) => (PRESET_INFO[n]?.group ?? "hole") === tab)
    .map((n) => ({ name: n, title: t(PRESET_INFO[n]?.title ?? n), text: t(PRESET_INFO[n]?.description ?? ""), art: SCENE_THUMBS[n] }));
}

/** a scene's id in a test id (its name, lower case, its words joined by "-") */
export const sceneSlug = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
