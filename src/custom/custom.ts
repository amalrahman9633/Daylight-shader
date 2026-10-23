// The "Your own" shadow: holds the upload, its options, and keeps the
// renderer's custom scene in sync with them.

import { layer, presets, type SceneConfig } from '../presets';
import type { MaskPixels, Renderer } from '../renderer';
import { createStore, type Store } from '../state';
import { transitionTo } from '../transition';
import {
  autoThreshold,
  coverage,
  decodeFile,
  detectLayout,
  histogram,
  MaskError,
  maskPreview,
  rawMask,
  type Edge,
  type ShapeLayout,
  type SourceImage,
} from './mask';
import { forget, loadSaved, save } from './storage';

export type Motion = 'sway' | 'drift' | 'still';
export type AnchorChoice = 'auto' | Edge;

export interface CustomState {
  status: 'empty' | 'loading' | 'ready';
  name: string;
  motion: Motion;
  anchor: AnchorChoice;
  /** What "Auto" found, shown next to the Auto option. */
  detected: Edge | null;
  /** 0..100 */
  threshold: number;
  invert: boolean;
  /** Small data-URL preview of the mask. */
  preview: string;
  /** Gentle advice when the result looks empty or solid. */
  warning: string;
  /** Problem with the last file picked. */
  error: string;
}

const empty: CustomState = {
  status: 'empty',
  name: '',
  motion: 'sway',
  anchor: 'auto',
  detected: null,
  threshold: 50,
  invert: false,
  preview: '',
  warning: '',
  error: '',
};

/** Soft edge around the threshold, so photos don't get jagged outlines. */
const EDGE_SOFTNESS = 0.06;

const levelsFor = (threshold: number): [number, number] => {
  const t = threshold / 100;
  return [t - EDGE_SOFTNESS, t + EDGE_SOFTNESS];
};

/** How far outside the mask the sway pivot sits, like a trunk out of frame. */
const PIVOT_OUTSET = 0.08;

/** Build the scene (masks + motion) for the current options. */
function buildScene(
  st: CustomState,
  aspect: number,
  anchor: { edge: Edge; along: number } | null,
): SceneConfig {
  const levels = levelsFor(st.threshold);
  const base = { aspect, leanAmount: 1 };

  if (st.motion === 'drift') {
    return {
      ...base,
      anchored: false,
      wrap: 'mirror',
      align: [0.5, 0.5],
      origin: [0.5, 0.5],
      leanAxis: 'x',
      layers: [layer('custom', { scale: 1.2, drift: [0.006, 0.002], wind: 0.6, flutter: 0.4, levels })],
    };
  }

  if (st.motion === 'still') {
    return {
      ...base,
      anchored: true,
      sway: 0,
      wrap: 'extend',
      align: [0.5, 0.5],
      origin: [0.5, 0.5],
      leanAxis: 'x',
      layers: [layer('custom', { flutter: 0.6, levels })],
    };
  }

  // Sway: pivot just outside the edge the shape is attached to.
  const edge = st.anchor === 'auto' ? anchor?.edge : st.anchor;
  const along = st.anchor === 'auto' && anchor ? anchor.along : 0.5;
  const placements: Record<Edge, Pick<SceneConfig, 'origin' | 'align' | 'leanAxis'>> = {
    top: { origin: [along, -PIVOT_OUTSET], align: [along, 0], leanAxis: 'x' },
    bottom: { origin: [along, 1 + PIVOT_OUTSET], align: [along, 1], leanAxis: 'x' },
    left: { origin: [-PIVOT_OUTSET, along], align: [0, along], leanAxis: 'y' },
    right: { origin: [1 + PIVOT_OUTSET, along], align: [1, along], leanAxis: 'y' },
  };
  // Not attached to any edge: hang it from a point above, like a mobile.
  const place = edge ? placements[edge] : { origin: [0.5, -0.35] as [number, number], align: [0.5, 0.5] as [number, number], leanAxis: 'x' as const };
  return {
    ...base,
    ...place,
    anchored: true,
    sway: 1,
    wrap: 'extend',
    layers: [layer('custom', { flutter: 1, levels })],
  };
}

export type CustomController = ReturnType<typeof createCustom>;

export function createCustom(settings: Store, renderer: Renderer) {
  const state = createStore<CustomState>(empty);

  // Working data for the current upload (kept out of the store: it's big).
  let file: Blob | null = null;
  let source: SourceImage | null = null;
  let mask: MaskPixels | null = null;
  let hist: Uint32Array | null = null;
  let anchor: ShapeLayout['anchor'] = null;
  let pattern = false;

  function warningFor(threshold: number): string {
    if (!hist) return '';
    const c = coverage(hist, threshold / 100);
    if (c < 0.005) return 'Almost nothing casts a shadow. Try a lower threshold, or Invert.';
    if (c > 0.9) return 'Nearly everything is in shadow. Try a higher threshold, or Invert.';
    return '';
  }

  /** Recompute the mask from the source (new file, or invert changed). */
  function analyse(invert: boolean, threshold?: number) {
    const src = source!;
    const data = rawMask(src, invert);
    hist = histogram(data);
    const t = threshold ?? Math.round(autoThreshold(hist) * 100);
    ({ anchor, pattern } = detectLayout(data, src.width, src.height, t / 100));
    mask = { data, width: src.width, height: src.height };
    return t;
  }

  function pushScene() {
    const st = state.get();
    if (!mask) return;
    renderer.setCustom(mask, buildScene(st, mask.width / mask.height, anchor));
  }

  function refreshPreview() {
    const st = state.get();
    if (!mask) return;
    state.set({
      preview: maskPreview(mask.data, mask.width, mask.height, st.threshold / 100),
      warning: warningFor(st.threshold),
    });
  }

  let saveTimer = 0;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      const st = state.get();
      if (!file) return;
      save({
        file,
        name: st.name,
        options: { motion: st.motion, anchor: st.anchor, threshold: st.threshold, invert: st.invert },
      });
    }, 400);
  }

  /** Take a new file. Picks smart defaults, then shows it. */
  async function load(next: File, { select = true } = {}) {
    const previous = state.get();
    state.set({ status: 'loading', error: '' });
    try {
      source = await decodeFile(next);
    } catch (err) {
      const message = err instanceof MaskError ? err.message : 'Something went wrong reading that image.';
      state.set({ status: previous.status === 'loading' ? 'empty' : previous.status, error: message });
      return;
    }
    file = next;
    const threshold = analyse(false);
    // Smart default motion: a full-frame pattern → drift; attached to an
    // edge → sway; a shape floating in the middle → still.
    const motion: Motion = pattern ? 'drift' : anchor ? 'sway' : 'still';
    state.set({
      status: 'ready',
      name: next.name || 'Your image',
      motion,
      anchor: 'auto',
      detected: anchor?.edge ?? null,
      threshold,
      invert: false,
      error: '',
    });
    refreshPreview();
    pushScene();
    persist();
    if (select) transitionTo(settings, { ...settings.get(), preset: 'custom' });
  }

  function update(patch: Partial<Pick<CustomState, 'motion' | 'anchor' | 'threshold' | 'invert'>>) {
    if (!source) return;
    const st = state.get();
    const invertChanged = patch.invert !== undefined && patch.invert !== st.invert;
    const shapeChanged = patch.motion !== undefined || patch.anchor !== undefined;

    if (patch.threshold !== undefined && !invertChanged && !shapeChanged) {
      // Threshold alone: instant, no crossfade.
      state.set({ threshold: patch.threshold });
      renderer.setCustomLevels(levelsFor(patch.threshold));
      refreshPreview();
      persist();
      return;
    }

    if (invertChanged) {
      // Inverting changes which pixels are shape, so re-detect everything.
      const threshold = analyse(patch.invert!);
      state.set({ invert: patch.invert, threshold, detected: anchor?.edge ?? null });
    } else if (patch.threshold !== undefined) {
      state.set({ threshold: patch.threshold });
    }
    if (patch.motion) state.set({ motion: patch.motion });
    if (patch.anchor) state.set({ anchor: patch.anchor });
    refreshPreview();
    pushScene();
    persist();
  }

  function remove() {
    if (settings.get().preset === 'custom') {
      transitionTo(settings, { preset: 'branch', ...presets.branch.settings });
    }
    renderer.clearCustom();
    file = source = mask = hist = null;
    anchor = null;
    pattern = false;
    state.set(empty);
    forget();
  }

  /** Bring back the upload from a previous visit, without selecting it. */
  async function restore() {
    const saved = await loadSaved();
    if (!saved) return;
    const asFile = new File([saved.file], saved.name, { type: saved.file.type });
    await load(asFile, { select: false });
    if (state.get().status !== 'ready') return;
    const o = saved.options;
    update({
      motion: (['sway', 'drift', 'still'] as const).find((m) => m === o.motion) ?? 'sway',
      anchor: (['auto', 'top', 'right', 'bottom', 'left'] as const).find((a) => a === o.anchor) ?? 'auto',
      invert: !!o.invert,
    });
    if (typeof o.threshold === 'number') update({ threshold: Math.min(Math.max(o.threshold, 0), 100) });
  }

  /** The current upload as the snippet needs it: its scene and mask pixels. */
  function snapshot(): { scene: SceneConfig; mask: MaskPixels } | null {
    if (!mask || state.get().status !== 'ready') return null;
    return { scene: buildScene(state.get(), mask.width / mask.height, anchor), mask };
  }

  return { state, load, update, remove, restore, snapshot };
}
