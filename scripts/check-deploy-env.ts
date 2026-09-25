/**
 * First step of `npm run deploy`: stop with directions when the Cloudflare
 * credentials are missing, before the checks and the build run.
 *
 * Usage:
 *   tsx scripts/check-deploy-env.ts
 */
import { deployEnvMessage, deployEnvProblems, hasDeployEnvProblems } from './deploy-env.ts';

const problems = deployEnvProblems(process.env);
if (hasDeployEnvProblems(problems)) {
  console.error(deployEnvMessage(problems));
  process.exit(1);
}
