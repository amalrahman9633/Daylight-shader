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

/**
 * Which edge the shape is attached to, if any (like a branch growing in
 * from the side), and where along that edge (0..1).
 */
export interface ShapeLayout {
  /** The edge the shape is attached to, and where along it (0..1). */
  anchor: { edge: Edge; along: number } | null;
  /** The shadow reaches every edge: a full-frame pattern, best as Drift. */
  pattern: boolean;
}

export function detectLayout(mask: Uint8Array, w: number, h: number, threshold: number): ShapeLayout {
  const cut = threshold * 255;
  const bandX = Math.max(1, Math.round(w * 0.02));
  const bandY = Math.max(1, Math.round(h * 0.02));

  // For each edge: share of the band that's shadow, and where it sits.
  const scan = (edge: Edge) => {
    let hits = 0;
    let n = 0;
    let pos = 0;
    const along = edge === 'top' || edge === 'bottom' ? w : h;
    const depth = edge === 'top' || edge === 'bottom' ? bandY : bandX;
    for (let a = 0; a < along; a++) {
      for (let d = 0; d < depth; d++) {
        const x = edge === 'left' ? d : edge === 'right' ? w - 1 - d : a;
        const y = edge === 'top' ? d : edge === 'bottom' ? h - 1 - d : a;
        n++;
        if (mask[y * w + x] > cut) {
          hits++;
          pos += a / (along - 1 || 1);
        }
      }
    }
    return { edge, share: hits / n, along: hits ? pos / hits : 0.5 };
  };

  const edges = (['top', 'right', 'bottom', 'left'] as Edge[]).map(scan);
  // Shadow along every edge means a full-frame pattern with no single anchor.
  if (edges.every((e) => e.share > 0.04)) return { anchor: null, pattern: true };
  const best = edges.reduce((a, b) => (b.share > a.share ? b : a));
  // A shape that only grazes the edge isn't really attached to it.
  if (best.share < 0.01) return { anchor: null, pattern: false };
  return { anchor: { edge: best.edge, along: best.along }, pattern: false };
}

/** A small preview of the mask: dark shape on a light background. */
export function maskPreview(mask: Uint8Array, w: number, h: number, threshold: number, size = 96): string {
  const scale = size / Math.max(w, h);
  const pw = Math.max(1, Math.round(w * scale));
  const ph = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = pw;
  canvas.height = ph;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(pw, ph);
  const lo = threshold - 0.06;
  const hi = threshold + 0.06;
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const v = mask[Math.floor(y / scale) * w + Math.floor(x / scale)] / 255;
      const t = Math.min(Math.max((v - lo) / (hi - lo), 0), 1);
      const shade = Math.round(236 - t * t * (3 - 2 * t) * 150);
      const k = (y * pw + x) * 4;
      image.data[k] = image.data[k + 1] = image.data[k + 2] = shade;
      image.data[k + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL();
}
