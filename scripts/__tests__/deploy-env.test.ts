import { describe, expect, it } from 'vitest';

import { deployEnvMessage, deployEnvProblems, hasDeployEnvProblems } from '../deploy-env.ts';

describe('deploy credentials check', () => {
  it('passes when both values are present', () => {
    const problems = deployEnvProblems({ CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' });
    expect(hasDeployEnvProblems(problems)).toBe(false);
  });

  it('reports each value that is not set', () => {
    expect(deployEnvProblems({})).toEqual({
      missing: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
      empty: [],
    });
  });

  it('tells an empty value apart from a missing one', () => {
    const problems = deployEnvProblems({ CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: ' ' });
    expect(problems).toEqual({ missing: [], empty: ['CLOUDFLARE_API_TOKEN'] });
    expect(hasDeployEnvProblems(problems)).toBe(true);
  });

  it('names the variables and points to the docs', () => {
    const message = deployEnvMessage({
      missing: ['CLOUDFLARE_API_TOKEN'],
      empty: ['CLOUDFLARE_ACCOUNT_ID'],
    });
    expect(message).toContain('Not set: CLOUDFLARE_API_TOKEN');
    expect(message).toContain('Set but empty: CLOUDFLARE_ACCOUNT_ID');
    expect(message).toContain('docs/RUNBOOK.md');
    expect(message).toContain('docs/DEPLOY.md');
  });
});
