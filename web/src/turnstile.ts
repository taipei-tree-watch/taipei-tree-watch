/**
 * The Turnstile widget in front of the submit button.
 *
 * This is the one external script the page loads. The site key is public and
 * lives in the [vars] table of wrangler.toml, the same place the Worker reads
 * it from; the Vite build bakes that value in as VITE_TURNSTILE_SITE_KEY. Unit
 * tests import this module without going through Vite, so an absent value
 * falls back to Cloudflare's always-passing test key.
 */

export const TURNSTILE_SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Cloudflare's documented test key: every challenge succeeds. */
export const TEST_SITE_KEY = '1x00000000000000000000AA';

export function turnstileSiteKey(): string {
  const configured: unknown = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  return typeof configured === 'string' && configured !== '' ? configured : TEST_SITE_KEY;
}

interface TurnstileRenderOptions {
  sitekey: string;
  callback?: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: () => void;
}

interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | undefined;
  reset(widgetId: string): void;
  getResponse(widgetId: string): string | undefined;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadScript(): Promise<TurnstileApi> {
  if (scriptPromise !== null) {
    return scriptPromise;
  }

  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = window.turnstile;
    if (existing !== undefined) {
      resolve(existing);
      return;
    }

    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => {
      const api = window.turnstile;
      if (api === undefined) {
        reject(new Error('turnstile script loaded without an api'));
        return;
      }
      resolve(api);
    });
    script.addEventListener('error', () => {
      reject(new Error('turnstile script failed to load'));
    });
    document.head.append(script);
  });

  // A failed load must not be cached: the reporter may simply be offline.
  scriptPromise.catch(() => {
    scriptPromise = null;
  });

  return scriptPromise;
}

export interface TurnstileWidget {
  /** Empty until the challenge is solved. */
  getToken(): string;
  reset(): void;
}

/** Render the widget into `container`. Rejects when the script cannot load. */
export async function renderTurnstile(container: HTMLElement): Promise<TurnstileWidget> {
  const api = await loadScript();
  let token = '';

  const widgetId = api.render(container, {
    sitekey: turnstileSiteKey(),
    callback(value: string) {
      token = value;
    },
    'expired-callback'() {
      token = '';
    },
    'error-callback'() {
      token = '';
    },
  });

  if (widgetId === undefined) {
    throw new Error('turnstile widget did not render');
  }

  return {
    getToken() {
      return token === '' ? (api.getResponse(widgetId) ?? '') : token;
    },
    reset() {
      token = '';
      api.reset(widgetId);
    },
  };
}
