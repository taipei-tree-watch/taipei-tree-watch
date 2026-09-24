/**
 * Cloudflare Web Analytics beacon for the built frontend.
 *
 * The site runs on workers.dev, which is not a zone in the project account, so
 * Cloudflare cannot inject the beacon on its own and the page has to carry the
 * script tag. The token is public and lives in wrangler.toml `[vars]` beside
 * the Turnstile site key.
 */
import type { HtmlTagDescriptor, Plugin } from 'vite';

export const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';

/** Script tag that loads the beacon and reports to the site with `token`. */
export function webAnalyticsTag(token: string): HtmlTagDescriptor {
  if (token === '') {
    throw new Error('Web Analytics token is empty');
  }
  return {
    tag: 'script',
    attrs: {
      type: 'module',
      src: BEACON_SRC,
      'data-cf-beacon': JSON.stringify({ token }),
    },
    injectTo: 'head',
  };
}

/**
 * Adds the beacon to index.html in production builds only, so local dev
 * servers and test runs never count as visits.
 */
export function webAnalytics(token: string): Plugin {
  return {
    name: 'web-analytics',
    apply: 'build',
    transformIndexHtml: () => [webAnalyticsTag(token)],
  };
}
