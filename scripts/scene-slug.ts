/** A scene's file name in assets/scenes (as __bh.captureScenes names its captures). */
export const sceneSlug = (n: string) =>
  n
    .normalize("NFKD")
    .replace(/[^\w]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 60);
