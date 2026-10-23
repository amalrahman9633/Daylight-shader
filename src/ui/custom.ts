import type { AnchorChoice, CustomController, Motion } from '../custom/custom';
import type { Store } from '../state';

const motions: { id: Motion; label: string; hint: string }[] = [
  { id: 'sway', label: 'Sway', hint: 'Swings from the edge it’s attached to, like a branch' },
  { id: 'drift', label: 'Drift', hint: 'Repeats and floats slowly, like leaves overhead' },
  { id: 'still', label: 'Still', hint: 'Stays put with a gentle flutter' },
];

const anchors: { id: AnchorChoice; label: string; name: string }[] = [
  { id: 'auto', label: 'Auto', name: 'Automatic' },
  { id: 'top', label: '↑', name: 'Top edge' },
  { id: 'right', label: '→', name: 'Right edge' },
  { id: 'bottom', label: '↓', name: 'Bottom edge' },
  { id: 'left', label: '←', name: 'Left edge' },
];

/** A small radio-group of buttons with arrow-key support. */
function segmented<T extends string>(
  label: string,
  items: { id: T; label: string; title?: string }[],
  onPick: (id: T) => void,
) {
  const group = document.createElement('div');
  group.className = 'segmented segmented-full';
  group.style.gridTemplateColumns = `repeat(${items.length}, 1fr)`;
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', label);
  const buttons = items.map((item) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.textContent = item.label;
    if (item.title) {
      b.title = item.title;
      b.setAttribute('aria-label', item.title);
    }
    b.addEventListener('click', () => onPick(item.id));
    group.append(b);
    return { id: item.id, b };
  });
  let current: T = items[0].id;
  group.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = buttons.findIndex((x) => x.id === current);
    const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
    onPick(next.id);
    next.b.focus();
  });
  return {
    group,
    buttons,
    sync(value: T) {
      current = value;
      buttons.forEach(({ id, b }) => {
        b.setAttribute('aria-checked', String(id === value));
        b.tabIndex = id === value ? 0 : -1;
      });
    },
  };
}

function field(labelText: string, control: HTMLElement) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const label = document.createElement('span');
  label.className = 'field-label';
  label.textContent = labelText;
  wrap.append(label, control);
  return wrap;
}

/**
 * The custom-shadow panel (shown while "Your own" is selected), the hidden
 * file picker, and drag-and-drop onto the page.
 */
export function mountCustom(panel: HTMLElement, frame: HTMLElement, settings: Store, custom: CustomController) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp,image/svg+xml,image/avif';
  input.hidden = true;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) custom.load(file);
    input.value = '';
  });
  document.body.append(input);
  const openPicker = () => input.click();

  // ---------- Panel ----------

  const title = document.createElement('h2');
  title.className = 'section-title';
  title.id = 'custom-title';
  title.textContent = 'Your shadow';

  const header = document.createElement('div');
  header.className = 'custom-file';
  const thumb = document.createElement('img');
  thumb.className = 'custom-thumb';
  thumb.alt = '';
  const name = document.createElement('span');
  name.className = 'custom-name';
  const replace = document.createElement('button');
  replace.type = 'button';
  replace.className = 'text-button';
  replace.textContent = 'Replace';
  replace.addEventListener('click', openPicker);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'text-button';
  remove.textContent = 'Remove';
  remove.addEventListener('click', () => custom.remove());
  header.append(thumb, name, replace, remove);

  const motion = segmented(
    'Motion',
    motions.map((m) => ({ id: m.id, label: m.label })),
    (id) => custom.update({ motion: id }),
  );
  const motionHint = document.createElement('p');
  motionHint.className = 'hint field-hint';

  const anchor = segmented(
    'Attached to',
    anchors.map((a) => ({ id: a.id, label: a.label, title: a.name })),
    (id) => custom.update({ anchor: id }),
  );
  const anchorField = field('Attached to', anchor.group);

  // Threshold slider, styled like the other controls.
  const thresholdRow = document.createElement('div');
  thresholdRow.className = 'control';
  const tLabel = document.createElement('label');
  tLabel.htmlFor = 'custom-threshold';
  tLabel.textContent = 'Threshold';
  const tValue = document.createElement('output');
  tValue.className = 'control-value';
  const threshold = document.createElement('input');
  threshold.type = 'range';
  threshold.id = 'custom-threshold';
  threshold.min = '0';
  threshold.max = '100';
  threshold.step = '1';
  threshold.addEventListener('input', () => custom.update({ threshold: threshold.valueAsNumber }));
  thresholdRow.append(tLabel, tValue, threshold);

  // Invert: a switch.
  const invertRow = document.createElement('label');
  invertRow.className = 'switch-row';
  const invertText = document.createElement('span');
  invertText.textContent = 'Invert';
  const invert = document.createElement('input');
  invert.type = 'checkbox';
  invert.className = 'switch';
  invert.setAttribute('role', 'switch');
  invert.addEventListener('change', () => custom.update({ invert: invert.checked }));
  invertRow.append(invertText, invert);

  const warning = document.createElement('p');
  warning.className = 'hint custom-warning';
  warning.setAttribute('role', 'status');

  panel.append(
    title,
    header,
    field('Motion', motion.group),
    motionHint,
    anchorField,
    thresholdRow,
    invertRow,
    warning,
  );

  const sync = () => {
    const st = custom.state.get();
    panel.hidden = settings.get().preset !== 'custom' || st.status === 'empty';
    if (st.preview) thumb.src = st.preview;
    name.textContent = st.status === 'loading' ? 'Loading…' : st.name;
    name.title = st.name;
    motion.sync(st.motion);
    motionHint.textContent = motions.find((m) => m.id === st.motion)!.hint;
    anchorField.hidden = st.motion !== 'sway';
    anchor.sync(st.anchor);
    const autoLabel = anchor.buttons[0].b;
    autoLabel.title = st.detected ? `Automatic (found: ${st.detected} edge)` : 'Automatic (not attached to an edge)';
    threshold.value = String(st.threshold);
    threshold.style.setProperty('--fill', `${st.threshold}%`);
    tValue.textContent = String(st.threshold);
    invert.checked = st.invert;
    warning.textContent = st.warning;
  };
  sync();
  custom.state.subscribe(sync);
  settings.subscribe(sync);

  // ---------- Drag and drop ----------

  const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  let depth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    depth++;
    frame.classList.add('dropping');
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) frame.classList.remove('dropping');
  });
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    frame.classList.remove('dropping');
    const file = e.dataTransfer!.files[0];
    if (file) custom.load(file);
  });

  return { openPicker };
}
