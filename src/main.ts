import { createCustom } from './custom/custom';
import { createRenderer } from './renderer';
import { createStore, defaultSettings, type View } from './state';
import { mountBar } from './ui/bar';
import { mountCode } from './ui/code';
import { mountControls } from './ui/controls';
import { mountCustom } from './ui/custom';
import { mountExport } from './ui/export';
import { mountPresets } from './ui/presets';
import { mountSheet } from './ui/sheet';
import { mountThemeToggle } from './ui/theme';
import { mountUploadGuide } from './ui/upload-guide';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const store = createStore(defaultSettings);
const view = createStore<View>({
  // Respect reduced motion: start paused, but let people press play.
  playing: !reducedMotion,
  ratio: '16:9',
});

const message = $('stage-message');
let messageTimer = 0;
/** Show a short message over the preview. Errors that fix themselves fade out. */
function showMessage(text: string, { sticky = false } = {}) {
  message.textContent = text;
  message.hidden = false;
  clearTimeout(messageTimer);
  if (!sticky) messageTimer = window.setTimeout(() => (message.hidden = true), 6000);
}

mountControls($('controls'), store);
mountBar($('bar'), view);
mountThemeToggle($<HTMLButtonElement>('theme-toggle'));
mountSheet($('sidebar'), $<HTMLButtonElement>('sheet-handle'));

const canvas = $<HTMLCanvasElement>('canvas');
const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });

if (!gl) {
  canvas.hidden = true;
  showMessage(
    'Daylight needs WebGL 2 to draw light and shadow, and this browser doesn’t support it. Try a recent Chrome, Safari, Firefox or Edge.',
    { sticky: true },
  );
} else {
  try {
    const renderer = createRenderer({
      canvas,
      gl,
      store,
      view,
      onError: (text) => showMessage(text),
      // The frame behind the canvas matches, so nothing flashes while loading.
      onBackground: (hex) => document.documentElement.style.setProperty('--canvas-bg', hex),
    });
    const custom = createCustom(store, renderer);
    const { openPicker } = mountCustom($('custom'), $('frame'), store, custom);
    // The "Upload your own" tile shows a short guide before the file picker.
    const guide = mountUploadGuide(openPicker);
    mountPresets($('presets'), store, custom, guide.open);
    mountExport($('export'), store, view, renderer);
    mountCode($('code'), store, view, custom);
    custom.restore();
  } catch (err) {
    console.error(err);
    showMessage('Something went wrong while starting the preview. Try refreshing the page.', { sticky: true });
  }
}
