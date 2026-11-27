/** Traffic's independent oleo loads on a local runway plane. A visual contact model, not the player's gear physics. */
export function trafficContact(
  grounded: boolean,
  pitch: number,
  bank: number,
  wheelbase: number,
  halfTrack: number,
  sinceTouch: number,
  sink: number,
): { comp: [number, number, number]; lift: number } {
  if (!grounded) return { comp: [0, 0, 0], lift: 0 };
  // Nose relative to mains: pitch raises nose; roll lowers one main before the other.
  const height = [Math.sin(pitch) * wheelbase, Math.sin(bank) * halfTrack, -Math.sin(bank) * halfTrack];
  const lift = Math.max(0, -Math.min(...height));
  const impact = 0.1 * Math.min(2, Math.max(0, sink)) * Math.exp(-Math.max(0, sinceTouch) / 0.45);
  const comp = height.map((h) => Math.max(0, 1 - (h + lift) / 0.12) * Math.min(0.3, 0.12 + impact)) as [number, number, number];
  return { comp, lift };
}
