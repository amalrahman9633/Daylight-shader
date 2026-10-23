// Glides every slider from its current value to a target (a preset, or a
// "Surprise me" roll). The scene itself crossfades in the renderer over the
// same duration, so the two feel like one move.

import type { Settings, Store } from './state';

export const TRANSITION_SECONDS = 1.2;

let frame = 0;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb: number[]): string {
  return '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}

const numericKeys = ['lightAngle', 'warmth', 'softness', 'opacity', 'speed', 'wind', 'grain'] as const;

/** Stop any glide in progress, e.g. because the user grabbed a slider. */
export function cancelTransition() {
  cancelAnimationFrame(frame);
}

export function transitionTo(store: Store, target: Settings) {
  cancelTransition();
  const from = store.get();
  const fromBg = hexToRgb(from.background);
  const toBg = hexToRgb(target.background);
  const start = performance.now();

  // Switch the scene right away; the renderer crossfades it.
  store.set({ preset: target.preset });

  const step = (now: number) => {
    const t = Math.min((now - start) / 1000 / TRANSITION_SECONDS, 1);
    const k = easeInOut(t);
    const patch: Partial<Settings> = {
      background: rgbToHex(fromBg.map((v, i) => v + (toBg[i] - v) * k)),
    };
    for (const key of numericKeys) {
      const value = from[key] + (target[key] - from[key]) * k;
      // Land exactly on whole numbers at the end, but stay smooth on the way.
      patch[key] = t === 1 ? target[key] : value;
    }
    store.set(patch);
    if (t < 1) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
}
