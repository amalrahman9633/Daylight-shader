import { exportPng, exportScales, exportSize, type ExportScale } from '../export';
import type { Renderer } from '../renderer';
import type { Store, ViewStore } from '../state';
import { icons } from './icons';

export function mountExport(container: HTMLElement, store: Store, view: ViewStore, renderer: Renderer) {
  let scale: ExportScale = 2;

  const title = document.createElement('h2');
  title.className = 'section-title';
  title.id = 'export-title';
  title.textContent = 'Export';

  const scales = document.createElement('div');
  scales.className = 'segmented segmented-full';
  scales.setAttribute('role', 'radiogroup');
  scales.setAttribute('aria-label', 'Export size');

  const options = exportScales.map((s) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.textContent = `${s}x`;
    button.addEventListener('click', () => {
      scale = s;
      sync();
    });
    scales.append(button);
    return { s, button };
  });

  const size = document.createElement('p');
  size.className = 'hint export-size';

  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'primary-button';
  const idle = `${icons.download}<span>Download PNG</span>`;
  download.innerHTML = idle;

  const status = document.createElement('p');
  status.className = 'hint export-status';
  status.setAttribute('role', 'status');

  download.addEventListener('click', async () => {
    download.disabled = true;
    download.innerHTML = `<span>Exporting…</span>`;
    status.textContent = '';
    // Let the button repaint before the GPU gets busy.
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
    try {
      await exportPng(renderer, store.get(), view.get().ratio, scale);
    } catch (err) {
      console.error(err);
      status.textContent =
        scale > 1
          ? 'This browser couldn’t make an image that large. Try a smaller size.'
          : 'Something went wrong while exporting. Try again.';
    } finally {
      download.disabled = false;
      download.innerHTML = idle;
    }
  });

  const video = document.createElement('div');
  video.className = 'coming-soon';
  video.innerHTML = `<span>Video export</span><span class="badge">Coming soon</span>`;

  container.append(title, scales, size, download, status, video);

  function sync() {
    const ratio = view.get().ratio;
    options.forEach(({ s, button }) => {
      const { width, height } = exportSize(ratio, s);
      // Sizes this device's GPU can't render are switched off up front.
      const fits = Math.max(width, height) <= renderer.maxExportSize;
      button.disabled = !fits;
      button.title = fits ? `${width} × ${height}` : 'Too large for this device';
      if (!fits && scale === s) scale = 1;
    });
    options.forEach(({ s, button }) => {
      button.setAttribute('aria-checked', String(s === scale));
      button.tabIndex = s === scale ? 0 : -1;
    });
    const { width, height } = exportSize(ratio, scale);
    size.textContent = `${width} × ${height} px`;
  }

  // Arrow keys move between sizes, like a native radio group.
  scales.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const enabled = options.filter((o) => !o.button.disabled);
    const i = enabled.findIndex((o) => o.s === scale);
    const next = enabled[(i + (e.key === 'ArrowRight' ? 1 : enabled.length - 1)) % enabled.length];
    scale = next.s;
    sync();
    next.button.focus();
  });

  sync();
  view.subscribe(sync);
}
