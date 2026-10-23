// A short guide shown before the file picker: what kind of image gives the
// best shadow. Uses the real preset masks as examples.

const examples = [
  { mask: 'branch-trees', caption: 'Trees' },
  { mask: 'leaves-maple', caption: 'Leaves' },
  { mask: 'blinds-window', caption: 'Blinds' },
];

const tips = [
  'Keep the background plain and the edges clean, with no textures or gradients.',
  'Shapes touching an edge sway from it, like a branch. Patterns that fill the frame drift.',
  'PNG, JPG, WebP or SVG, up to 25 MB. Around 2000 px wide works well.',
];

export function mountUploadGuide(openPicker: () => void) {
  const dialog = document.createElement('dialog');
  dialog.className = 'guide';
  dialog.setAttribute('aria-labelledby', 'guide-title');
  dialog.setAttribute('aria-describedby', 'guide-lead');

  const base = import.meta.env.BASE_URL;
  dialog.innerHTML = `
    <form method="dialog" class="guide-body">
      <h2 id="guide-title" class="guide-title">Upload your own shadow</h2>
      <p id="guide-lead" class="guide-lead">
        For the best result, use a high-contrast image: the shape in <strong>white</strong>
        on a solid <strong>black</strong> background. White becomes the shadow; black stays as light.
      </p>
      <div class="guide-examples">
        ${examples
          .map(
            (e) => `
          <figure>
            <img src="${base}masks/${e.mask}.png" alt="Example: ${e.caption.toLowerCase()} in white on black" loading="lazy" />
            <figcaption>${e.caption}</figcaption>
          </figure>`,
          )
          .join('')}
      </div>
      <ul class="guide-tips">
        ${tips.map((t) => `<li>${t}</li>`).join('')}
      </ul>
      <p class="hint">Photos and dark-on-light drawings work too. Fine-tune them afterwards with Threshold and Invert.</p>
      <div class="guide-actions">
        <button type="submit" value="cancel" class="text-button guide-cancel">Cancel</button>
        <button type="button" class="primary-button guide-choose">Choose image</button>
      </div>
    </form>`;

  dialog.querySelector('.guide-choose')!.addEventListener('click', () => {
    dialog.close();
    // Still inside the click, so the browser allows the file picker to open.
    openPicker();
  });

  // Clicking the dimmed area outside the card closes it, like Esc.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  document.body.append(dialog);

  return {
    open() {
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>('.guide-choose')!.focus();
    },
  };
}
