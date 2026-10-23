// All user-facing settings, stored in slider units. This is the object that
// presets define and the shareable URL stores.

import { presets, type PresetId } from './presets';

export interface Settings {
  /** Which scene (masks + motion) is showing. */
  preset: PresetId;
  /** Degrees, 0 is straight above. Negative = light from the right. */
  lightAngle: number;
  /** 0..100, cool to golden. */
  warmth: number;
  /** 0..100 */
  softness: number;
  /** 0..100 */
  opacity: number;
  /** 0..100 */
  speed: number;
  /** 0..100 */
  wind: number;
  /** Hex color, e.g. #F7F5F0 */
  background: string;
  /** 0..100 */
  grain: number;
}

export type NumericKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];

/** Allowed range for every numeric setting. Sliders and URL parsing share it. */
export const ranges: Record<NumericKey, [number, number]> = {
  lightAngle: [-75, 75],
  warmth: [0, 100],
  softness: [0, 100],
  opacity: [0, 100],
  speed: [0, 100],
  wind: [0, 100],
  grain: [0, 100],
};

export const defaultSettings: Settings = { preset: 'branch', ...presets.branch.settings };

// ---------- View state (not part of a preset) ----------

export const aspectRatios = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  '9:16': 9 / 16,
} as const;

export type AspectRatio = keyof typeof aspectRatios;

export interface View {
  playing: boolean;
  ratio: AspectRatio;
}

// ---------- Store ----------

type Listener<T> = (value: T) => void;

/** A tiny observable object: get it, patch it, get told when it changes. */
export function createStore<T extends object>(initial: T) {
  let value = { ...initial };
  const listeners = new Set<Listener<T>>();

  return {
    get: () => value,
    set(patch: Partial<T>) {
      value = { ...value, ...patch };
      listeners.forEach((fn) => fn(value));
    },
    subscribe(fn: Listener<T>) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export type Store = ReturnType<typeof createStore<Settings>>;
export type ViewStore = ReturnType<typeof createStore<View>>;
