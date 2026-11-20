// Shared alpha-cut surface of a leaf card: bake, near geometry and shadows must reject the same holes.
export const TREE_LEAF_WGSL = /* wgsl */ `
// (a leaf card's mask: a spray of leaflets — five ellipses — on a broad leaf's card; a needle tuft's or a frond's: thin blades)
fn leafMask(uv: vec2f, kind: f32) -> bool {
  let c = uv * 2.0 - 1.0;
  if (kind == 2.0 || kind == 4.0) {
    // (needles, fronds: blades across the card's length)
    let blades = abs(fract(c.y * 3.5 + 0.5 * c.x * c.x) - 0.5);
    return blades < 0.32 * (1.0 - c.x * c.x) && abs(c.x) < 0.98;
  }
  var hit = false;
  for (var i = 0; i < 5; i++) {
    let a = f32(i) * 1.2566 + 0.3;
    let ctr = vec2f(cos(a), sin(a)) * 0.42;
    let dd = c - ctr;
    let ax = vec2f(cos(a), sin(a));
    let along = dot(dd, ax);
    let across = dot(dd, vec2f(-ax.y, ax.x));
    if ((along * along) / 0.2 + (across * across) / 0.07 < 1.0) { hit = true; }
  }
  return hit || dot(c, c) < 0.12;
}
`;
