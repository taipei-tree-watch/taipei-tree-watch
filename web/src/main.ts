import './style.css';

const status = document.querySelector<HTMLParagraphElement>('#status');

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

void showApiStatus();
