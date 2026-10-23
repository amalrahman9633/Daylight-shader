// Presets are plain data: starting slider values plus a "scene" that tells
// the renderer which masks to use and how they move. Adding a preset later
// is just adding an entry here.

import type { Settings } from './state';

export type MaskName = 'branch-trees' | 'blinds-window' | 'leaves-maple' | 'cloud';

export interface LayerConfig {
  /** A built-in mask, or 'custom' for the user's upload. */
  mask: MaskName | 'custom';
  /** How many times the mask repeats across the screen. 1 = fills it once. */
  scale: number;
  /** Steady drift in mask units per second (at speed 30). Tiled masks only. */
  drift: [number, number];
  /** How much this layer is pushed around by wind. */
  wind: number;
  /** Slow back-and-forth drift in mask units (like the sun creeping), for
   *  masks that can't scroll forever because they don't repeat. */
  bob?: [number, number];
  /** Blur multiplier. Layers further from the wall look softer. */
  blur: number;
  /** How dark this layer's shadow is relative to the others. */
  weight: number;
  /** Small per-pixel tremble, for leaf tips. */
  flutter: number;
  /** Like Photoshop Levels: mask values below the first number become full
   *  light, above the second full shadow. Adds contrast to soft masks. */
  levels: [number, number];
}

export interface SceneConfig {
  /** Anchored masks sway around a pivot and never tile. */
  anchored: boolean;
  /** How strongly an anchored mask sways (0 = still). Defaults to 1. */
  sway?: number;
  /** Mask width ÷ height. Built-in masks are square (1). */
  aspect?: number;
  /** The part of the mask used for framing, as [left, top, right, bottom]
   *  in 0..1. Lets a preset hide awkward bits (like trunks ending mid-air)
   *  at every aspect ratio. Defaults to the whole mask. */
  crop?: [number, number, number, number];
  /** How the mask continues past its edges. Defaults: anchored → extend,
   *  otherwise repeat. Custom drift uses mirror, so any image tiles seamlessly. */
  wrap?: 'extend' | 'repeat' | 'mirror';
  /** Where the mask sits in the frame when cropped to fit (0..1). */
  align: [number, number];
  /** The point the shadow stretches and sways around, in mask units. */
  origin: [number, number];
  /** Which way the light angle leans the shadow: 'x' slants vertical shapes,
   *  'y' tilts horizontal ones like blinds. */
  leanAxis: 'x' | 'y';
  leanAmount: number;
  layers: LayerConfig[];
}

export type BuiltInId = 'branch' | 'blinds' | 'leaves' | 'cloud';
/** 'custom' is the user's own upload. Its scene is built at runtime. */
export type PresetId = BuiltInId | 'custom';

export interface Preset {
  id: BuiltInId;
  name: string;
  scene: SceneConfig;
  settings: Omit<Settings, 'preset'>;
}

export const layer = (mask: MaskName | 'custom', rest: Partial<LayerConfig> = {}): LayerConfig => ({
  mask,
  scale: 1,
  drift: [0, 0],
  wind: 1,
  blur: 1,
  weight: 1,
  flutter: 0,
  levels: [0, 1],
  ...rest,
});

export const presets: Record<BuiltInId, Preset> = {
  branch: {
    id: 'branch',
    name: 'Branch in wind',
    scene: {
      anchored: true,
      // Two young trees. Framing stops just above where the trunks end, so
      // at every aspect ratio they run off the bottom of the screen.
      crop: [0, 0.15, 1, 0.84],
      align: [0.5, 1],
      // They sway from just below their base, between the two trunks, so
      // the canopies move most and the trunks barely move.
      origin: [0.56, 0.95],
      leanAxis: 'x',
      leanAmount: 1,
      layers: [layer('branch-trees', { flutter: 1 })],
    },
    settings: {
      lightAngle: 35,
      warmth: 40,
      softness: 45,
      opacity: 35,
      speed: 30,
      wind: 55,
      background: '#F7F5F0',
      grain: 12,
    },
  },

  blinds: {
    id: 'blinds',
    name: 'Window blinds',
    scene: {
      anchored: false,
      // One band of slat shadows with a window-frame break. It doesn't
      // repeat: past its edges the (empty) edge pixels just continue.
      wrap: 'extend',
      // Sit a little low so the band stays in frame on wide screens.
      align: [0.5, 0.6],
      origin: [0.5, 0.5],
      leanAxis: 'y',
      // The image is already slanted; the angle slider only adds a little.
      leanAmount: 0.3,
      // A slow rise and fall, like the sun creeping, since blinds have no wind.
      layers: [layer('blinds-window', { wind: 0.15, bob: [0.004, 0.012] })],
    },
    settings: {
      lightAngle: 55,
      warmth: 65,
      softness: 15,
      opacity: 45,
      speed: 8,
      wind: 0,
      background: '#F3EEE6',
      grain: 18,
    },
  },

  leaves: {
    id: 'leaves',
    name: 'Dappled leaves',
    scene: {
      anchored: false,
      // One full-frame photo of falling maple leaves (3:2). It isn't made to
      // repeat, so it sways and flutters in place instead of drifting; the
      // mirrored edges only peek in during strong gusts.
      aspect: 1536 / 1024,
      wrap: 'mirror',
      align: [0.5, 0.5],
      origin: [0.5, 0.5],
      leanAxis: 'x',
      leanAmount: 1,
      layers: [layer('leaves-maple', { wind: 1, flutter: 0.6 })],
    },
    settings: {
      lightAngle: 20,
      warmth: 55,
      softness: 60,
      opacity: 30,
      speed: 40,
      wind: 65,
      background: '#F4F6EF',
      grain: 15,
    },
  },

  cloud: {
    id: 'cloud',
    name: 'Soft cloud',
    scene: {
      anchored: false,
      align: [0.5, 0.5],
      origin: [0.5, 0.5],
      leanAxis: 'x',
      leanAmount: 1,
      // Two layers drifting at different scales, so the shape slowly
      // changes instead of just sliding past.
      layers: [
        layer('cloud', { scale: 0.6, drift: [0.025, 0.008], wind: 0.2, levels: [0.35, 0.75] }),
        layer('cloud', { scale: 0.37, drift: [-0.012, 0.015], wind: 0.1, weight: 0.5, levels: [0.4, 0.8] }),
      ],
    },
    settings: {
      lightAngle: 0,
      warmth: 20,
      softness: 90,
      opacity: 18,
      speed: 12,
      wind: 10,
      background: '#F1F4F8',
      grain: 8,
    },
  },
};

export const presetOrder: BuiltInId[] = ['branch', 'blinds', 'leaves', 'cloud'];

// ---------- Surprise me ----------

// Light backgrounds only: shadows need a lit surface to show up on.
const surpriseBackgrounds = [
  '#F7F5F0', '#F3EEE6', '#F4F6EF', '#F1F4F8',
  '#F6F1EB', '#EEF1EC', '#F5F0F1', '#ECEFF3', '#FAF7F2', '#F2EFE9',
];

type Range = [number, number];
type NumericSettings = Omit<Settings, 'preset' | 'background'>;

// Ranges that always look good. A few presets narrow them where a value
// would fight the look (e.g. blinds in a gale, crisp clouds).
const baseRanges: Record<keyof NumericSettings, Range> = {
  lightAngle: [-55, 55],
  warmth: [15, 85],
  softness: [20, 75],
  opacity: [20, 45],
  speed: [10, 45],
  wind: [20, 75],
  grain: [5, 22],
};

const presetRanges: Partial<Record<BuiltInId, Partial<Record<keyof NumericSettings, Range>>>> = {
  blinds: { softness: [5, 40], wind: [0, 10], speed: [4, 15] },
  cloud: { softness: [75, 100], opacity: [12, 28], wind: [0, 25], speed: [6, 20], lightAngle: [-20, 20] },
};

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];
const between = ([min, max]: Range) => Math.round(min + Math.random() * (max - min));

export function surprise(): Settings {
  const preset = pick(presetOrder);
  const ranges = { ...baseRanges, ...presetRanges[preset] };
  return {
    preset,
    lightAngle: between(ranges.lightAngle),
    warmth: between(ranges.warmth),
    softness: between(ranges.softness),
    opacity: between(ranges.opacity),
    speed: between(ranges.speed),
    wind: between(ranges.wind),
    background: pick(surpriseBackgrounds),
    grain: between(ranges.grain),
  };
}
