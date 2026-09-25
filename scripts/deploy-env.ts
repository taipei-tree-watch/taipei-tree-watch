/**
 * Credentials `npm run deploy` needs before it spends time on checks and a
 * build. wrangler reads both from the environment; without them it fails at
 * the very end with a message that does not say where the values come from.
 */

export const DEPLOY_ENV_VARS = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'] as const;

export type DeployEnvVar = (typeof DEPLOY_ENV_VARS)[number];

export interface DeployEnvProblems {
  missing: DeployEnvVar[];
  /** Set but empty, which is what a failed `$(...)` lookup leaves behind. */
  empty: DeployEnvVar[];
}

export function deployEnvProblems(env: Record<string, string | undefined>): DeployEnvProblems {
  const missing: DeployEnvVar[] = [];
  const empty: DeployEnvVar[] = [];
  for (const name of DEPLOY_ENV_VARS) {
    const value = env[name];
    if (value === undefined) {
      missing.push(name);
    } else if (value.trim() === '') {
      empty.push(name);
    }
  }
  return { missing, empty };
}

export function hasDeployEnvProblems(problems: DeployEnvProblems): boolean {
  return problems.missing.length > 0 || problems.empty.length > 0;
}

export function deployEnvMessage(problems: DeployEnvProblems): string {
  const lines = ['deploy: Cloudflare credentials are not available.', ''];
  if (problems.missing.length > 0) {
    lines.push(`  Not set: ${problems.missing.join(', ')}`);
  }
  if (problems.empty.length > 0) {
    lines.push(
      `  Set but empty: ${problems.empty.join(', ')}`,
      '    The command that fills it probably failed; check that the password manager is logged in.',
    );
  }
  lines.push(
    '',
    '  Pass both values in the environment of this one command, for example:',
    '',
    '    CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... npm run deploy',
    '',
    '  Where the values come from: docs/RUNBOOK.md, section 0.',
    '  Full deploy steps: docs/DEPLOY.md.',
  );
  return lines.join('\n');
}
