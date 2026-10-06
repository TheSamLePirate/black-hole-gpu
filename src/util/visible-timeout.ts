/** What visibleTimeout reads of the page (the document; a stand-in in tests). */
export interface Visibility {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/**
 * A timeout counted in the page's visible time: a hidden tab — the browser throttling it, the GPU
 * process deprioritised — does not run the clock, so a compile that would land in seconds once the
 * tab is back is not declared hung after three minutes in the background (audit M7). Without a
 * document (tests, workers) every moment counts. Returns the cancel.
 */
export function visibleTimeout(ms: number, fire: () => void, page: Visibility | undefined = globalThis.document): () => void {
  let left = ms;
  let since = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    since = performance.now();
    timer = setTimeout(done, left);
  };
  const pause = () => {
    clearTimeout(timer);
    timer = undefined;
    left -= performance.now() - since;
  };
  const changed = () => {
    if (page!.hidden) {
      if (timer !== undefined) pause();
    } else if (timer === undefined) run();
  };
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    page?.removeEventListener("visibilitychange", changed);
  };
  const done = () => {
    cancel();
    fire();
  };
  page?.addEventListener("visibilitychange", changed);
  if (!page?.hidden) run();
  return cancel;
}
