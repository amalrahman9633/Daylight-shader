// Turns any uploaded image into a shadow mask (one byte per pixel,
// 0 = light, 255 = shadow). Everything happens in the browser; the file is
// never uploaded anywhere.

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Masks are capped at this many pixels on the long edge (same as built-ins). */
const MAX_EDGE = 2048;

export type Edge = 'top' | 'right' | 'bottom' | 'left';

export interface SourceImage {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  /** True when the image has real transparency (a cut-out silhouette). */
  hasAlpha: boolean;
}

export class MaskError extends Error {}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new MaskError('This file couldn’t be opened. Try a PNG, JPG or WebP.'));
    img.src = url;
    // Free the memory once the image has decoded (or failed).
    img.decode().catch(() => {}).finally(() => setTimeout(() => URL.revokeObjectURL(url), 0));
  });
}

/** Check, decode and downsize a file. Throws MaskError with a friendly message. */
export async function decodeFile(file: File): Promise<SourceImage> {
  if (!file.type.startsWith('image/')) {
    throw new MaskError('That isn’t an image. Try a PNG, JPG, WebP or SVG.');
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new MaskError('That image is over 25 MB. Try a smaller file.');
  }

  const img = await loadImageFromFile(file);
  // SVGs without a set size report 0×0; draw them large.
  let w = img.naturalWidth || MAX_EDGE;
  let h = img.naturalHeight || MAX_EDGE;
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new MaskError('This browser couldn’t read the image.');
  ctx.drawImage(img, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;

  // Real transparency: more than 1% of pixels are see-through.
  let transparent = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 250) transparent++;
  const hasAlpha = transparent > (w * h) / 100;

  return { rgba, width: w, height: h, hasAlpha };
}

/**
 * The raw mask, before the threshold is applied.
 * - Cut-out images: the opaque shape casts the shadow.
 * - Everything else: brightness. The edges of the picture are usually
 *   background, so if they're light, the dark parts become shadow (and the
 *   other way round). Invert flips the result.
 */
export function rawMask(src: SourceImage, invert: boolean): Uint8Array {
  const { rgba, width: w, height: h, hasAlpha } = src;
  const out = new Uint8Array(w * h);

  if (hasAlpha) {
    for (let i = 0, j = 3; i < out.length; i++, j += 4) out[i] = rgba[j];
  } else {
    for (let i = 0, j = 0; i < out.length; i++, j += 4) {
      out[i] = Math.round(0.2126 * rgba[j] + 0.7152 * rgba[j + 1] + 0.0722 * rgba[j + 2]);
    }
    // Average brightness around the border.
    let sum = 0;
    let n = 0;
    for (let x = 0; x < w; x++) {
      sum += out[x] + out[(h - 1) * w + x];
      n += 2;
    }
    for (let y = 0; y < h; y++) {
      sum += out[y * w] + out[y * w + w - 1];
      n += 2;
    }
    if (sum / n > 127) for (let i = 0; i < out.length; i++) out[i] = 255 - out[i];
  }

  if (invert) for (let i = 0; i < out.length; i++) out[i] = 255 - out[i];
  return out;
}

export function histogram(mask: Uint8Array): Uint32Array {
  const hist = new Uint32Array(256);
  for (let i = 0; i < mask.length; i++) hist[mask[i]]++;
  return hist;
}

/**
 * A good starting threshold (0..1), using Otsu's method: it picks the value
 * that best splits the image into two groups, "shape" and "background".
 */
export function autoThreshold(hist: Uint32Array): number {
  let total = 0;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) {
    total += hist[i];
    sumAll += i * hist[i];
  }
  let sumB = 0;
  let weightB = 0;
  let best = 0;
  let bestT = 127;
  for (let t = 0; t < 256; t++) {
    weightB += hist[t];
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;
    sumB += t * hist[t];
    const meanB = sumB / weightB;
    const meanF = (sumAll - sumB) / weightF;
    const between = weightB * weightF * (meanB - meanF) ** 2;
    if (between > best) {
      best = between;
      bestT = t;
    }
  }
  // Keep it away from the extremes so the slider always has room.
  return Math.min(Math.max((bestT + 0.5) / 255, 0.08), 0.92);
}

/** Share of the image that ends up as shadow at a threshold (0..1). */
export function coverage(hist: Uint32Array, threshold: number): number {
  let total = 0;
  let above = 0;
  const cut = Math.round(threshold * 255);
  for (let i = 0; i < 256; i++) {
    total += hist[i];
    if (i > cut) above += hist[i];
  }
  return total ? above / total : 0;
}

/** Soft band around the threshold, so baked edges stay smooth, not jagged. */
export const EDGE_SOFTNESS = 0.06;

/**
 * Apply the threshold to the raw mask, producing the clean shape the shader
 * will blur. Doing this before the blur (not after) is what lets Softness
 * work on uploads exactly like it does on the presets.
 */
export function bakeThreshold(raw: Uint8Array, threshold: number, out?: Uint8Array): Uint8Array {
  const lo = threshold - EDGE_SOFTNESS;
  const hi = threshold + EDGE_SOFTNESS;
  // Every pixel is one of 256 values, so precompute the answer for each.
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    const t = Math.min(Math.max((v / 255 - lo) / (hi - lo), 0), 1);
    lut[v] = Math.round(t * t * (3 - 2 * t) * 255);
  }
  const result = out ?? new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) result[i] = lut[raw[i]];
  return result;
}

export interface SideInfo {
  edge: Edge;
  /** Where along this side the shape's mass sits, in mask units (0..1). */
  along: number;
  /** Position of the shape's outline on this side, in mask units (0..1). */
  outer: number;
  /** Share of the image edge band that's shadow (attached to the edge). */
  touch: number;
  /** How thin the shape is near this side (0..1). Low = a stem or trunk.
   *  Infinity when the shape doesn't continue unbroken into this side. */
  thinness: number;
}

export interface ShapeLayout {
  /** The shape's bounding box in mask units: left, top, right, bottom. */
  bbox: [number, number, number, number];
  sides: Record<Edge, SideInfo>;
  /** The side the shape grows from (touching the edge, or a stem), if clear. */
  anchor: Edge | null;
  /** The shadow reaches every edge: a full-frame pattern, best as Drift. */
  pattern: boolean;
}

const EDGES: Edge[] = ['top', 'right', 'bottom', 'left'];
/** A side counts as a stem when the shape near it fills less than this. */
const STEM_THINNESS = 0.08;

/**
 * Works out how the shape sits in the image: its outline box, which side it
 * grows from (an edge it touches, or a thin stem like tree trunks), or
 * whether it's a full-frame pattern.
 */
export function detectLayout(mask: Uint8Array, w: number, h: number, threshold: number): ShapeLayout {
  const cut = threshold * 255;
  const on = (x: number, y: number) => mask[y * w + x] > cut;

  // Outline box.
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] > cut) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) {
    // No shape at all: treat the whole image as the box.
    x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1;
  }
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;

  const side = (edge: Edge): SideInfo => {
    const horizontal = edge === 'top' || edge === 'bottom';

    // 1. Attached to the image edge? Share of a thin band along the edge.
    const band = Math.max(1, Math.round((horizontal ? h : w) * 0.02));
    let hits = 0;
    let n = 0;
    for (let a = 0; a < (horizontal ? w : h); a++) {
      for (let d = 0; d < band; d++) {
        const x = edge === 'left' ? d : edge === 'right' ? w - 1 - d : a;
        const y = edge === 'top' ? d : edge === 'bottom' ? h - 1 - d : a;
        n++;
        if (on(x, y)) hits++;
      }
    }

    // 2. Stem test: walk a band just inside the outline box on this side.
    //    Every line must hold some shape (it continues unbroken), and the
    //    lines should be mostly empty (it's thin, like a trunk).
    const span = horizontal ? bw : bh;
    const depth = Math.max(2, Math.round((horizontal ? bh : bw) * 0.08));
    let lines = 0;
    let broken = false;
    let mass = 0;
    let massPos = 0;
    for (let d = 0; d < depth; d++) {
      let count = 0;
      for (let a = 0; a < span; a++) {
        const x = horizontal ? x0 + a : edge === 'left' ? x0 + d : x1 - d;
        const y = horizontal ? (edge === 'top' ? y0 + d : y1 - d) : y0 + a;
        if (on(x, y)) {
          count++;
          massPos += horizontal ? x : y;
        }
      }
      if (count === 0) broken = true;
      mass += count;
      lines++;
    }

    const outer =
      edge === 'top' ? y0 / h : edge === 'bottom' ? (y1 + 1) / h : edge === 'left' ? x0 / w : (x1 + 1) / w;
    return {
      edge,
      along: mass ? massPos / mass / ((horizontal ? w : h) - 1 || 1) : 0.5,
      outer,
      touch: hits / n,
      thinness: broken ? Infinity : mass / lines / span,
    };
  };

  const sides = Object.fromEntries(EDGES.map((e) => [e, side(e)])) as Record<Edge, SideInfo>;
  const bbox: [number, number, number, number] = [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h];

  // Shadow along every edge means a full-frame pattern with no single anchor.
  if (EDGES.every((e) => sides[e].touch > 0.04)) return { bbox, sides, anchor: null, pattern: true };

  // Attached to an edge (like a branch growing in from the side).
  const touching = EDGES.reduce((a, b) => (sides[b].touch > sides[a].touch ? b : a));
  if (sides[touching].touch >= 0.01) return { bbox, sides, anchor: touching, pattern: false };

  // Not touching anything: look for a stem (tree trunks, a hanging stalk).
  const thinnest = EDGES.reduce((a, b) => (sides[b].thinness < sides[a].thinness ? b : a));
  const anchor = sides[thinnest].thinness < STEM_THINNESS ? thinnest : null;
  return { bbox, sides, anchor, pattern: false };
}

/** The side most likely to be a stem, even when detection wasn't confident. */
export function likeliestStem(layout: ShapeLayout): Edge {
  return EDGES.reduce((a, b) => (layout.sides[b].thinness < layout.sides[a].thinness ? b : a));
}

/** A small preview of the mask: dark shape on a light background. */
export function maskPreview(mask: Uint8Array, w: number, h: number, size = 96): string {
  const scale = size / Math.max(w, h);
  const pw = Math.max(1, Math.round(w * scale));
  const ph = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = pw;
  canvas.height = ph;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(pw, ph);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const t = mask[Math.floor(y / scale) * w + Math.floor(x / scale)] / 255;
      const shade = Math.round(236 - t * 150);
      const k = (y * pw + x) * 4;
      image.data[k] = image.data[k + 1] = image.data[k + 2] = shade;
      image.data[k + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL();
}
