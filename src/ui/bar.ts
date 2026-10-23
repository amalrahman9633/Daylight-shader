import { aspectRatios, type AspectRatio, type ViewStore } from '../state';
import { icons } from './icons';

/** Bottom bar under the canvas: play/pause and aspect ratio. */
export function mountBar(container: HTMLElement, view: ViewStore) {
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'icon-button play';
  play.addEventListener('click', () => view.set({ playing: !view.get().playing }));

  const ratios = document.createElement('div');
  ratios.className = 'segmented';
  ratios.setAttribute('role', 'radiogroup');
  ratios.setAttribute('aria-label', 'Aspect ratio');

  const options = (Object.keys(aspectRatios) as AspectRatio[]).map((ratio) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.textContent = ratio;
    button.addEventListener('click', () => view.set({ ratio }));
    ratios.append(button);
    return { ratio, button };
  });

  // Arrow keys move between ratios, like a native radio group.
  ratios.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = options.findIndex((o) => o.ratio === view.get().ratio);
    const next = options[(i + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length];
    view.set({ ratio: next.ratio });
    next.button.focus();
  });

  container.append(play, ratios);

  // Space toggles play/pause, unless you're typing or on a button already.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, button, select, [contenteditable]')) return;
    e.preventDefault();
    view.set({ playing: !view.get().playing });
  });

  const sync = () => {
    const { playing, ratio } = view.get();
    play.innerHTML = playing ? icons.pause : icons.play;
    play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    play.title = `${playing ? 'Pause' : 'Play'} (Space)`;
    options.forEach(({ ratio: r, button }) => {
      const on = r === ratio;
      button.setAttribute('aria-checked', String(on));
      button.tabIndex = on ? 0 : -1;
    });
    document.documentElement.style.setProperty('--ratio', String(aspectRatios[ratio]));
  };
  sync();
  view.subscribe(sync);
}
