/** Visibility sectors in the aircraft's frame: bearing of the observer, degrees right of the nose.
 * Screen glows respect the navigation sectors; upper/lower beacons are masked by the hull's plane. */
export function trafficLightVisibility(bearing: number, elevation: number) {
  const b = ((bearing + 540) % 360) - 180;
  return {
    port: b <= 3 && b >= -115.5,
    starboard: b >= -3 && b <= 115.5,
    tail: Math.abs(b) >= 109.5,
    upper: elevation >= -0.05,
    lower: elevation <= 0.05,
    landing: Math.abs(b) < 40 && elevation > -0.35,
  };
}
