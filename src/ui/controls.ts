import { ranges, type NumericKey, type Settings, type Store } from '../state';
import { cancelTransition } from '../transition';

interface SliderDef {
  kind: 'slider';
  key: NumericKey;
  label: string;
  unit?: string;
}

interface ColorDef {
  kind: 'color';
  key: 'background';
  label: string;
}

type ControlDef = SliderDef | ColorDef;

const groups: { title: string; controls: ControlDef[] }[] = [
  {
    title: 'Light',
    controls: [
      { kind: 'slider', key: 'lightAngle', label: 'Angle', unit: '°' },
      { kind: 'slider', key: 'warmth', label: 'Warmth' },
    ],
  },
  {
    title: 'Shadow',
    controls: [
      { kind: 'slider', key: 'softness', label: 'Softness' },
      { kind: 'slider', key: 'opacity', label: 'Opacity' },
    ],
  },
  {
    title: 'Motion',
    controls: [
      { kind: 'slider', key: 'speed', label: 'Speed' },
      { kind: 'slider', key: 'wind', label: 'Wind' },
    ],
  },
  {
    title: 'Surface',
    controls: [
      { kind: 'color', key: 'background', label: 'Background' },
      { kind: 'slider', key: 'grain', label: 'Grain' },
    ],
  },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export function mountControls(container: HTMLElement, store: Store) {
  const updaters: ((s: Settings) => void)[] = [];

  for (const group of groups) {
    const details = el('details', 'group');
    details.open = true;
    const summary = el('summary', 'group-title');
    summary.textContent = group.title;
    details.append(summary);

    for (const def of group.controls) {
      const row = el('div', 'control');
      const id = `control-${def.key}`;
      const label = el('label');
      label.htmlFor = id;
      label.textContent = def.label;
      const value = el('output', 'control-value');
      value.htmlFor.add(id);

      if (def.kind === 'slider') {
        const input = el('input');
        input.type = 'range';
        input.id = id;
        const [min, max] = ranges[def.key];
        input.min = String(min);
        input.max = String(max);
        input.step = '1';
        // Fill the track up to the thumb, via a CSS variable.
        const paint = (v: number) => {
          input.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
          value.textContent = `${Math.round(v)}${def.unit ?? ''}`;
        };
        input.addEventListener('input', () => {
          // Grabbing a slider mid-glide hands control straight back to you.
          cancelTransition();
          store.set({ [def.key]: input.valueAsNumber });
        });
        updaters.push((s) => {
          input.value = String(s[def.key]);
          paint(s[def.key]);
        });
        row.append(label, value, input);
      } else {
        row.classList.add('control-color');
        const input = el('input');
        input.type = 'color';
        input.id = id;
        input.addEventListener('input', () => {
          cancelTransition();
          store.set({ background: input.value.toUpperCase() });
        });
        updaters.push((s) => {
          input.value = s.background.toLowerCase();
          value.textContent = s.background.toUpperCase();
        });
        row.append(label, value, input);
      }
      details.append(row);
    }
    container.append(details);
  }

  const sync = (s: Settings) => updaters.forEach((fn) => fn(s));
  sync(store.get());
  store.subscribe(sync);
}
