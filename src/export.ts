// PNG export: renders the current frame offscreen at a fixed size and
// downloads it.

import type { Renderer } from './renderer';
import { aspectRatios, type AspectRatio, type Settings } from './state';

export const exportScales = [1, 2, 4] as const;
export type ExportScale = (typeof exportScales)[number];

/** 1x is 1280px on the long edge, so 4x of 16:9 is 5120×2880 (5K). */
const BASE_LONG_EDGE = 1280;

export function exportSize(ratio: AspectRatio, scale: ExportScale): { width: number; height: number } {
  const r = aspectRatios[ratio];
  const long = BASE_LONG_EDGE * scale;
  return r >= 1
    ? { width: long, height: Math.round(long / r) }
    : { width: Math.round(long * r), height: long };
}

function toPngBlob(image: ImageData): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('No 2D canvas'));
  ctx.putImageData(image, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png'),
  );
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before freeing it.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function exportPng(renderer: Renderer, settings: Settings, ratio: AspectRatio, scale: ExportScale) {
  const { width, height } = exportSize(ratio, scale);
  const image = renderer.renderStill(width, height);
  const blob = await toPngBlob(image);
  download(blob, `daylight-${settings.preset}-${width}x${height}.png`);
}
