import './style.css';

import { sections } from './content/index.ts';

const status = document.querySelector<HTMLParagraphElement>('#status');
const info = document.querySelector<HTMLElement>('#info');

async function showApiStatus(): Promise<void> {
  if (!status) return;
  try {
    const response = await fetch('/api/health');
    const body = (await response.json()) as { ok?: boolean };
    status.textContent = `API: ${body.ok ? 'ok' : 'unavailable'}`;
  } catch {
    status.textContent = 'API: unavailable';
  }
  status.hidden = false;
}

/**
 * Renders the explanatory copy as disclosure blocks. The fragments are build
 * time constants from web/src/content, never user input, so assigning them with
 * innerHTML is safe. E1.5 replaces this placeholder layout.
 */
function renderInfoSections(container: HTMLElement): void {
  container.replaceChildren(
    ...sections.map((section) => {
      const details = document.createElement('details');
      details.id = section.id;
      details.open = section.open;

      const summary = document.createElement('summary');
      summary.textContent = section.title;
      details.append(summary);

      const body = document.createElement('div');
      body.className = 'section-body';
      body.innerHTML = section.html;
      details.append(body);

      return details;
    }),
  );
}

if (info) renderInfoSections(info);

void showApiStatus();
