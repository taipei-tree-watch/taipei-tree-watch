import { describe, expect, it } from 'vitest';

import { BEACON_SRC, webAnalytics, webAnalyticsTag } from '../web-analytics.ts';
import { readWranglerVar } from '../wrangler-vars.ts';

describe('webAnalyticsTag', () => {
  it('loads the beacon in the head with the token as JSON', () => {
    expect(webAnalyticsTag('abc123')).toEqual({
      tag: 'script',
      attrs: {
        type: 'module',
        src: BEACON_SRC,
        'data-cf-beacon': '{"token":"abc123"}',
      },
      injectTo: 'head',
    });
  });

  it('rejects an empty token instead of shipping a beacon that reports nowhere', () => {
    expect(() => webAnalyticsTag('')).toThrow(/empty/);
  });
});

describe('webAnalytics', () => {
  it('runs only for production builds', () => {
    expect(webAnalytics('abc123').apply).toBe('build');
  });
});

describe('wrangler.toml', () => {
  it('carries a Web Analytics token', () => {
    expect(readWranglerVar('WEB_ANALYTICS_TOKEN')).toMatch(/^[0-9a-f]{32}$/);
  });
});
