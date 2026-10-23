// The "Your own" shadow: holds the upload, its options, and keeps the
// renderer's custom scene in sync with them.

import { layer, presets, type SceneConfig } from '../presets';
import type { MaskPixels, Renderer } from '../renderer';
import { createStore, type Store } from '../state';
import { transitionTo } from '../transition';
import {
  autoThreshold,
  bakeThreshold,
  coverage,
  decodeFile,
  detectLayout,
  histogram,
  likeliestStem,
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

/** How far beyond the shape the sway pivot sits, like a trunk out of frame. */
const PIVOT_OUTSET = 0.08;
/** Breathing room around the shape when framing it. */
const FRAME_MARGIN = 0.04;
/** How much of the stem end to trim off, so it runs off the frame edge. */
const STEM_TRIM = 0.03;

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

/**
 * The part of the image to frame: the shape's outline plus a little margin.
 * On the side it grows from, cut slightly short so the stem (or the edge it
 * hangs from) runs off the screen instead of ending in mid-air.
 */
function frameFor(layout: ShapeLayout, stem: Edge | null): [number, number, number, number] {
  const [x0, y0, x1, y1] = layout.bbox;
  const mx = (x1 - x0) * FRAME_MARGIN;
  const my = (y1 - y0) * FRAME_MARGIN;
  let left = x0 - mx;
  let top = y0 - my;
  let right = x1 + mx;
  let bottom = y1 + my;
  if (stem === 'top') top = y0 + (y1 - y0) * STEM_TRIM;
  if (stem === 'bottom') bottom = y1 - (y1 - y0) * STEM_TRIM;
  if (stem === 'left') left = x0 + (x1 - x0) * STEM_TRIM;
  if (stem === 'right') right = x1 - (x1 - x0) * STEM_TRIM;
  left = clamp01(left);
  top = clamp01(top);
  right = clamp01(right);
  bottom = clamp01(bottom);
  // Never let a tiny shape produce a uselessly small frame.
  if (right - left < 0.05) [left, right] = [clamp01((x0 + x1) / 2 - 0.025), clamp01((x0 + x1) / 2 + 0.025)];
  if (bottom - top < 0.05) [top, bottom] = [clamp01((y0 + y1) / 2 - 0.025), clamp01((y0 + y1) / 2 + 0.025)];
  return [left, top, right, bottom];
}

/** Build the scene (masks + motion) for the current options. */
function buildScene(st: CustomState, aspect: number, layout: ShapeLayout): SceneConfig {
  const base = { aspect, leanAmount: 1 };

  if (st.motion === 'drift') {
    // Patterns tile the whole image, so no framing crop.
    return {
      ...base,
      anchored: false,
      wrap: 'mirror',
      align: [0.5, 0.5],
      origin: [0.5, 0.5],
      leanAxis: 'x',
      layers: [layer('custom', { scale: 1.2, drift: [0.006, 0.002], wind: 0.6, flutter: 0.4 })],
    };
  }

  if (st.motion === 'still') {
    const [x0, y0, x1, y1] = layout.bbox;
    return {
      ...base,
      anchored: true,
      sway: 0,
      wrap: 'extend',
      crop: frameFor(layout, null),
      align: [0.5, 0.5],
      origin: [(x0 + x1) / 2, (y0 + y1) / 2],
      leanAxis: 'x',
      layers: [layer('custom', { flutter: 0.6 })],
    };
  }

  // Sway: pivot just beyond the side the shape grows from (the edge it's
  // attached to, or the end of its stem), centered on the stem itself.
  const edge = st.anchor === 'auto' ? (layout.anchor ?? likeliestStem(layout)) : st.anchor;
  const side = layout.sides[edge];
  const at = side.along;
  const places: Record<Edge, Pick<SceneConfig, 'origin' | 'align' | 'leanAxis'>> = {
    top: { origin: [at, side.outer - PIVOT_OUTSET], align: [0.5, 0], leanAxis: 'x' },
    bottom: { origin: [at, side.outer + PIVOT_OUTSET], align: [0.5, 1], leanAxis: 'x' },
    left: { origin: [side.outer - PIVOT_OUTSET, at], align: [0, 0.5], leanAxis: 'y' },
    right: { origin: [side.outer + PIVOT_OUTSET, at], align: [1, 0.5], leanAxis: 'y' },
  };
  return {
    ...base,
    ...places[edge],
    anchored: true,
    sway: 1,
    wrap: 'extend',
    crop: frameFor(layout, edge),
    layers: [layer('custom', { flutter: 1 })],
  };
}

export type CustomController = ReturnType<typeof createCustom>;

export function createCustom(settings: Store, renderer: Renderer) {
  const state = createStore<CustomState>(empty);

  // Working data for the current upload (kept out of the store: it's big).
  let file: Blob | null = null;
  let source: SourceImage | null = null;
  let raw: Uint8Array | null = null;
  /** The thresholded mask the renderer blurs (see bakeThreshold). */
  let mask: MaskPixels | null = null;
  let hist: Uint32Array | null = null;
  let layout: ShapeLayout | null = null;

  function warningFor(threshold: number): string {
    if (!hist) return '';
    const c = coverage(hist, threshold / 100);
    if (c < 0.005) return 'Almost nothing casts a shadow. Try a lower threshold, or Invert.';
    if (c > 0.9) return 'Nearly everything is in shadow. Try a higher threshold, or Invert.';
    return '';
  }

  /** Recompute everything from the source (new file, or invert changed). */
  function analyse(invert: boolean, threshold?: number) {
    const src = source!;
    raw = rawMask(src, invert);
    hist = histogram(raw);
    const t = threshold ?? Math.round(autoThreshold(hist) * 100);
    layout = detectLayout(raw, src.width, src.height, t / 100);
    mask = { data: bakeThreshold(raw, t / 100), width: src.width, height: src.height };
    return t;
  }

  function pushScene() {
    if (!mask || !layout) return;
    renderer.setCustom(mask, buildScene(state.get(), mask.width / mask.height, layout));
  }

  function refreshPreview() {
    const st = state.get();
    if (!mask) return;
    state.set({
      preview: maskPreview(mask.data, mask.width, mask.height),
      warning: warningFor(st.threshold),
    });
  }

  // Threshold drags re-bake the mask at most once per frame.
  let rebakeFrame = 0;
  function rebake() {
    if (rebakeFrame) return;
    rebakeFrame = requestAnimationFrame(() => {
      rebakeFrame = 0;
      if (!raw || !mask) return;
      bakeThreshold(raw, state.get().threshold / 100, mask.data);
      renderer.updateCustomMask(mask);
      refreshPreview();
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
    // Smart default motion: a full-frame pattern → drift; grows from an edge
    // or a stem (like trunks) → sway; a shape floating in the middle → still.
    const motion: Motion = layout!.pattern ? 'drift' : layout!.anchor ? 'sway' : 'still';
    state.set({
      status: 'ready',
      name: next.name || 'Your image',
      motion,
      anchor: 'auto',
      detected: layout!.anchor,
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
      // Threshold alone: re-bake the mask in place, no crossfade.
      state.set({ threshold: patch.threshold });
      rebake();
      persist();
      return;
    }

    if (invertChanged) {
      // Inverting changes which pixels are shape, so re-detect everything.
      const threshold = analyse(patch.invert!);
      state.set({ invert: patch.invert, threshold, detected: layout!.anchor });
    } else if (patch.threshold !== undefined) {
      state.set({ threshold: patch.threshold });
      if (raw && mask) bakeThreshold(raw, patch.threshold / 100, mask.data);
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
    file = source = mask = hist = raw = null;
    layout = null;
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
    if (!mask || !layout || state.get().status !== 'ready') return null;
    return { scene: buildScene(state.get(), mask.width / mask.height, layout), mask };
  }

  return { state, load, update, remove, restore, snapshot };
}
