// "Copy code": builds one self-contained HTML snippet (player + settings +
// shadow images) that works on any website with no files to host.

import type { CustomController } from './custom/custom';
import playerSource from './generated/player.js?raw';
import type { PlayerConfig } from './player';
import { presets, type MaskName } from './presets';
import type { MaskPixels } from './renderer';
import type { AspectRatio, NumericKey, Settings } from './state';

/** Shadows are blurred, so 1024px is plenty and keeps the snippet small. */
const SNIPPET_MAX_EDGE = 1024;
/** Above this, try JPEG too: soft or photographic masks compress far better. */
const PNG_BUDGET = 150_000;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

/** Shrink to the snippet size and encode in whichever format is smaller. */
function encode(source: CanvasImageSource, width: number, height: number): string {
  const scale = Math.min(1, SNIPPET_MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const png = canvas.toDataURL('image/png');
  if (png.length <= PNG_BUDGET) return png;
  const jpeg = canvas.toDataURL('image/jpeg', 0.9);
  return jpeg.length < png.length ? jpeg : png;
}

/** One-byte-per-pixel mask → a grayscale canvas the encoder can read. */
function maskToCanvas(mask: MaskPixels): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = mask.width;
  canvas.height = mask.height;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(mask.width, mask.height);
  for (let i = 0, j = 0; i < mask.data.length; i++, j += 4) {
    image.data[j] = image.data[j + 1] = image.data[j + 2] = mask.data[i];
    image.data[j + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

// Built-in masks never change, so encode each one only once per visit.
const encodedMasks = new Map<MaskName, Promise<string>>();

function encodeBuiltIn(name: MaskName): Promise<string> {
  let promise = encodedMasks.get(name);
  if (!promise) {
    promise = loadImage(`${import.meta.env.BASE_URL}masks/${name}.png`).then((img) =>
      encode(img, img.naturalWidth, img.naturalHeight),
    );
    encodedMasks.set(name, promise);
    promise.catch(() => encodedMasks.delete(name));
  }
  return promise;
}

const numericKeys: NumericKey[] = ['lightAngle', 'warmth', 'softness', 'opacity', 'speed', 'wind', 'grain'];

export async function buildSnippet(
  settings: Settings,
  ratio: AspectRatio,
  custom: CustomController,
): Promise<string> {
  const rounded = { ...settings };
  for (const key of numericKeys) rounded[key] = Math.round(settings[key]);

  const config: PlayerConfig = { settings: rounded, masks: {} };

  if (settings.preset === 'custom') {
    const snap = custom.snapshot();
    if (!snap) throw new Error('No custom upload');
    config.scene = snap.scene;
    config.masks.custom = encode(maskToCanvas(snap.mask), snap.mask.width, snap.mask.height);
  } else {
    const names = [...new Set(presets[settings.preset].scene.layers.map((l) => l.mask as MaskName))];
    const encoded = await Promise.all(names.map(encodeBuiltIn));
    names.forEach((name, i) => (config.masks[name] = encoded[i]));
  }

  // Never let anything inside the script close the <script> tag early.
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  const player = playerSource.replace(/<\/script/gi, '<\\/script');
  const aspect = ratio.replace(':', ' / ');

  return [
    `<!-- Daylight: animated light and shadow background. Everything it needs is inside this snippet. -->`,
    `<!-- Place your own content inside the div to layer it on top. Resize the div however you like. -->`,
    `<div style="position:relative;width:100%;aspect-ratio:${aspect};background:${settings.background}"></div>`,
    `<script>(function(){var s=document.currentScript;${player}\nDaylightPlayer.mount(s.previousElementSibling,${json})})();</script>`,
  ].join('\n');
}

/** Human-friendly size, e.g. "184 KB". */
export function formatSize(text: string): string {
  const kb = new Blob([text]).size / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}
