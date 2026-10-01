// The phone layout: body.mobile on a touch screen whose short side is a phone's (≤ 560 CSS px), with
// body.portrait or not — kept up to date as the phone turns. The CSS (style.css, "phones") lays the HUD
// out for it; the flight HUD's tapes and the touch controls read it too.

export const PHONE_SIDE = 560;

export function isMobile() {
  return document.body.classList.contains("mobile");
}

export function watchMobile() {
  const coarse = matchMedia("(pointer: coarse)");
  const apply = () => {
    const b = document.body.classList;
    b.toggle("mobile", coarse.matches && Math.min(innerWidth, innerHeight) <= PHONE_SIDE);
    b.toggle("portrait", innerHeight > innerWidth);
  };
  apply();
  addEventListener("resize", apply);
  coarse.addEventListener?.("change", apply);
}
