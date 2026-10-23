// Wind model for the branch. Runs once per frame on the CPU and returns a
// single rotation for the whole shadow, so the shape moves as one piece
// instead of wobbling.

function hash(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

/** Smooth 1D value noise in the range -1..1. */
function noise(t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return (hash(i) + (hash(i + 1) - hash(i)) * u) * 2 - 1;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

export interface WindSample {
  /** Rotation in radians. */
  sway: number;
  /** 0..1 strength of the current gust. */
  gust: number;
}

export function sampleWind(t: number, strength: number): WindSample {
  // A gentle, constant breeze: two slow layers so it never feels periodic.
  const breeze = noise(t * 0.21) * 0.7 + noise(t * 0.53 + 5.3) * 0.3;

  // Gusts: a very slow noise that only occasionally crosses the threshold.
  // When it does, the branch leans further and shivers a little.
  const gust = smoothstep(0.15, 0.75, noise(t * 0.07 + 41.7));
  const shiver = noise(t * 1.6 + 83.1);

  const sway = breeze * 0.014 + gust * (0.032 + shiver * 0.01);
  return { sway: sway * strength, gust: gust * strength };
}

/**
 * Wind for tiled layers (leaves, clouds): the whole layer is nudged around
 * rather than rotated. Each layer gets its own seed so they move
 * independently, which reads as depth.
 */
export function layerWind(t: number, strength: number, gust: number, seed: number): [number, number] {
  const x = noise(t * 0.19 + seed) * 0.6 + noise(t * 0.43 + seed * 3.1) * 0.4;
  const y = noise(t * 0.23 + seed * 7.3);
  return [(x * 0.01 + gust * 0.016) * strength, y * 0.005 * strength];
}
