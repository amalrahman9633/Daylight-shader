/** Mobile bottom sheet: the handle expands and collapses the controls. */
export function mountSheet(sidebar: HTMLElement, handle: HTMLButtonElement) {
  const set = (open: boolean) => {
    sidebar.classList.toggle('expanded', open);
    handle.setAttribute('aria-expanded', String(open));
    handle.querySelector('.sheet-label')!.textContent = open ? 'Done' : 'Adjust';
  };
  handle.addEventListener('click', () => set(!sidebar.classList.contains('expanded')));
  set(false);
}
