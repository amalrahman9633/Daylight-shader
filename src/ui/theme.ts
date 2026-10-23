import { icons } from './icons';

const KEY = 'daylight-theme';
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function current(): 'light' | 'dark' {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return systemDark.matches ? 'dark' : 'light';
}

/** Light/dark toggle for the interface. Follows the system until you choose. */
export function mountThemeToggle(button: HTMLButtonElement) {
  const sync = () => {
    const theme = current();
    // Show the icon for the theme you'd switch to.
    button.innerHTML = theme === 'dark' ? icons.sun : icons.moon;
    const label = theme === 'dark' ? 'Switch to light interface' : 'Switch to dark interface';
    button.setAttribute('aria-label', label);
    button.title = label;
  };

  button.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private mode or storage blocked: the toggle still works for this visit.
    }
    sync();
  });

  systemDark.addEventListener('change', sync);
  sync();
}
