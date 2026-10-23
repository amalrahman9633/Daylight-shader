import type { CustomController } from '../custom/custom';
import { presetOrder, presets, surprise } from '../presets';
import type { Store } from '../state';
import { transitionTo } from '../transition';

export function mountPresets(
  container: HTMLElement,
  store: Store,
  custom: CustomController,
  startUpload: () => void,
) {
  const section = document.createElement('div');
  section.className = 'presets';

  const grid = document.createElement('div');
  grid.className = 'preset-grid';
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Presets');

  const buttons = presetOrder.map((id) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset';
    button.textContent = presets[id].name;
    button.addEventListener('click', () =>
      transitionTo(store, { preset: id, ...presets[id].settings }),
    );
    grid.append(button);
    return { id, button };
  });

  // "Your own": opens the file picker until there's an upload, then selects it.
  const own = document.createElement('button');
  own.type = 'button';
  own.className = 'preset preset-own';
  const ownThumb = document.createElement('img');
  ownThumb.alt = '';
  ownThumb.className = 'own-thumb';
  const ownLabel = document.createElement('span');
  own.append(ownThumb, ownLabel);
  own.addEventListener('click', () => {
    if (custom.state.get().status === 'ready') {
      transitionTo(store, { ...store.get(), preset: 'custom' });
    } else {
      startUpload();
    }
  });
  grid.append(own);

  const error = document.createElement('p');
  error.className = 'hint upload-error';
  error.setAttribute('role', 'alert');

  const surpriseButton = document.createElement('button');
  surpriseButton.type = 'button';
  surpriseButton.className = 'surprise';
  surpriseButton.textContent = 'Surprise me';
  surpriseButton.addEventListener('click', () => transitionTo(store, surprise()));

  section.append(grid, error, surpriseButton);
  container.append(section);

  const sync = () => {
    const active = store.get().preset;
    buttons.forEach(({ id, button }) => button.setAttribute('aria-pressed', String(id === active)));
    const st = custom.state.get();
    const ready = st.status === 'ready';
    own.setAttribute('aria-pressed', String(active === 'custom'));
    own.classList.toggle('has-upload', ready);
    ownThumb.hidden = !ready;
    if (st.preview) ownThumb.src = st.preview;
    ownLabel.textContent = st.status === 'loading' ? 'Reading image…' : ready ? 'Your own' : '+ Upload your own';
    own.title = ready ? 'Your own shadow' : 'Upload an image to use as the shadow (or drop one on the page)';
    error.textContent = st.error;
  };
  sync();
  store.subscribe(sync);
  custom.state.subscribe(sync);
}
