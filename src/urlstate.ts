// Shareable state: settings that differ from the defaults are stored in the URL hash.

type Plain = Record<string, unknown>;

export function saveToUrl<T extends object>(s: T, defaults: T, exclude: (keyof T)[] = []) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(s)) {
    if (exclude.includes(k as keyof T)) continue;
    const d = (defaults as Plain)[k];
    if (v === d) continue;
    if (typeof v === "number") {
      if (typeof d === "number" && Math.abs(v - d) < 1e-9) continue;
      params.set(k, String(Number(v.toPrecision(6))));
    } else {
      params.set(k, String(v));
    }
  }
  const hash = params.toString();
  history.replaceState(null, "", hash ? `#${hash}` : location.pathname + location.search);
}

export function loadFromUrl<T extends object>(defaults: T): Partial<T> {
  const out: Plain = {};
  const params = new URLSearchParams(location.hash.slice(1));
  for (const [k, raw] of params) {
    if (!(k in defaults)) continue;
    const d = (defaults as Plain)[k];
    if (typeof d === "number") {
      const n = Number(raw);
      if (Number.isFinite(n)) out[k] = n;
    } else if (typeof d === "boolean") {
      out[k] = raw === "true";
    } else if (d === "auto" && /^\d+$/.test(raw)) {
      out[k] = Number(raw); // realtimeSubsampling: "auto" | number
    } else {
      out[k] = raw;
    }
  }
  return out as Partial<T>;
}
