// The page never zooms: an app over the whole screen, every gesture the canvas's or the HUD's. The
// viewport meta and the CSS (touch-action, overscroll-behavior) cover most browsers; these cover the
// rest — Safari's own pinch (it ignores user-scalable=no), a pinch begun on a panel, a trackpad's pinch
// on the desktop (a wheel event with ctrlKey), the keyboard's zoom.

export function preventPageZoom() {
  const no = (e: Event) => e.preventDefault();
  // (Safari: its gesture events, the pinch before any touch-action applies)
  for (const t of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(t, no, { passive: false });
  // (two fingers anywhere: never the page's pinch — the canvas reads its pointers itself)
  document.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );
  // (a trackpad's pinch: the canvas zooms its own view; over the panels, nothing)
  addEventListener(
    "wheel",
    (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    },
    { passive: false },
  );
  // (Ctrl/⌘ with + − 0: the browser's zoom)
  addEventListener("keydown", (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && ["Equal", "Minus", "Digit0", "NumpadAdd", "NumpadSubtract", "Numpad0"].includes(e.code))
      e.preventDefault();
  });
  // (the page itself scrolled by a focused input on a phone: back where it belongs)
  addEventListener("scroll", () => {
    if (scrollX || scrollY) scrollTo(0, 0);
  });
}
