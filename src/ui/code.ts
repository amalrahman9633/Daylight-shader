import type { CustomController } from '../custom/custom';
import { buildSnippet, formatSize } from '../snippet';
import type { Store, ViewStore } from '../state';
import { icons } from './icons';

function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/html' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** "Use on your website": copies a self-contained snippet of the current look. */
export function mountCode(container: HTMLElement, store: Store, view: ViewStore, custom: CustomController) {
  const title = document.createElement('h2');
  title.className = 'section-title';
  title.id = 'code-title';
  title.textContent = 'Use on your website';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'share-button';
  const idle = `${icons.code}<span>Copy code</span>`;
  button.innerHTML = idle;

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent =
    'One snippet with everything inside: no files to host. Paste it into your site’s HTML; anything you put inside its div sits on top of the light.';

  const status = document.createElement('p');
  status.className = 'hint export-status';
  status.setAttribute('role', 'status');

  let timer = 0;
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.innerHTML = `<span>Preparing…</span>`;
    status.textContent = '';
    let snippet: string;
    try {
      snippet = await buildSnippet(store.get(), view.get().ratio, custom);
    } catch (err) {
      console.error(err);
      status.textContent = 'Something went wrong while making the code. Try again.';
      button.disabled = false;
      button.innerHTML = idle;
      return;
    }
    const size = formatSize(snippet);
    try {
      await navigator.clipboard.writeText(snippet);
      button.innerHTML = `${icons.check}<span>Copied</span>`;
      button.classList.add('copied');
      status.textContent = `Snippet size: ${size}.`;
    } catch {
      // Clipboard blocked (some browsers, or the page isn't focused): hand
      // over the snippet as a file instead.
      downloadText(snippet, 'daylight-snippet.html');
      status.textContent = `Copying was blocked, so the code was downloaded as daylight-snippet.html (${size}).`;
    }
    button.disabled = false;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      button.innerHTML = idle;
      button.classList.remove('copied');
    }, 1800);
  });

  container.append(title, button, status, hint);
}
