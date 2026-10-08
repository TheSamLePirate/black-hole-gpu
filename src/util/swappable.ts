// A stable handle on an object that can be replaced under it (PLAN-MONDE M2): the renderer rebuilt on a
// new GPU device after the old one was lost, while the page, the simulation and the overlays keep the
// handle they were given. Every read, write and call goes to the current object; its methods are bound to
// it (each bound once per object: a method called from the handle runs on the object itself, its own
// property reads not through the proxy — the renderer's hot paths stay as fast).

export interface Swappable<T extends object> {
  /** the handle to give out */
  readonly proxy: T;
  /** the object behind it now */
  current(): T;
  /** the object behind it replaced */
  swap(next: T): void;
}

export function swappable<T extends object>(first: T): Swappable<T> {
  let cur = first;
  let bound = new Map<PropertyKey, { src: unknown; fn: unknown }>();
  const proxy: T = new Proxy(first, {
    get(_, k, receiver) {
      // (read through an object made on the handle — Object.create(handle), a test's stub —: plain
      // inheritance, its own methods and getters run on it, nothing bound to the current one)
      if (receiver !== proxy) return Reflect.get(cur, k, receiver);
      const v = Reflect.get(cur, k, cur);
      if (typeof v !== "function" || k === "constructor") return v;
      // (a function property replaced since — a callback set again —: bound anew)
      const b = bound.get(k);
      if (b && b.src === v) return b.fn;
      const fn = (v as (...a: unknown[]) => unknown).bind(cur);
      bound.set(k, { src: v, fn });
      return fn;
    },
    set: (_, k, v, receiver) => Reflect.set(cur, k, v, receiver === proxy ? cur : receiver),
    has: (_, k) => Reflect.has(cur, k),
    deleteProperty: (_, k) => Reflect.deleteProperty(cur, k),
    ownKeys: () => Reflect.ownKeys(cur),
    getOwnPropertyDescriptor: (_, k) => {
      const d = Reflect.getOwnPropertyDescriptor(cur, k);
      // (a proxy may not report as configurable what its target lacks: the first object's keys stand in)
      if (d) d.configurable = true;
      return d;
    },
    getPrototypeOf: () => Reflect.getPrototypeOf(cur),
  });
  return {
    proxy,
    current: () => cur,
    swap(next: T) {
      cur = next;
      bound = new Map();
    },
  };
}
