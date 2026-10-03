// A CanvasRenderingContext2D that records what is drawn: the texts (with their place, colour and
// font), the strokes' points, save/restore — to test the HUD's drawing without a browser.

export interface DrawnText {
  text: string;
  x: number;
  y: number;
  fill: string;
  font: string;
}

export function recorder() {
  const texts: DrawnText[] = [];
  const points: [number, number][] = [];
  let depth = 0;
  let unbalanced = false;
  const state: Record<string, unknown> = { fillStyle: "#000", strokeStyle: "#000", font: "10px sans-serif", lineWidth: 1 };
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_, k: string) {
      if (k in state) return state[k];
      switch (k) {
        case "fillText":
          return (t: string, x: number, y: number) =>
            texts.push({ text: String(t), x, y, fill: String(state.fillStyle), font: String(state.font) });
        case "moveTo":
        case "lineTo":
          return (x: number, y: number) => points.push([x, y]);
        case "arc":
          return (x: number, y: number) => points.push([x, y]);
        case "save":
          return () => depth++;
        case "restore":
          return () => (depth--, depth < 0 && (unbalanced = true));
        case "measureText":
          return (t: string) => ({ width: String(t).length * 7 });
        case "createLinearGradient":
        case "createRadialGradient":
          return () => ({ addColorStop() {} });
        case "getLineDash":
          return () => [];
        default:
          return () => {};
      }
    },
    set(_, k: string, v) {
      state[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return {
    ctx,
    texts,
    points,
    /** every save restored, never more */
    balanced: () => depth === 0 && !unbalanced,
    has: (re: RegExp) => texts.some((t) => re.test(t.text)),
    find: (re: RegExp) => texts.find((t) => re.test(t.text)),
  };
}
