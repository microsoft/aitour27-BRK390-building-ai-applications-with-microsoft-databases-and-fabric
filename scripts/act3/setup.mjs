import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadDeploymentConfig, required, requireCloudWrite, verifyAzureContext } from './config.mjs';

const guid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function validateSetup(env = process.env) {
  const config = loadDeploymentConfig(env);
  for (const name of ['ENTRA_CLIENT_ID', 'ENTRA_API_AUDIENCE', 'ENTRA_API_SCOPE', 'ACT3_EMBEDDING_ENDPOINT',
    'ACT3_EMBEDDING_DEPLOYMENT', 'ACT3_EMBEDDING_PROFILE', 'ACT3_GUIDANCE_MAX_DISTANCE',
    'ACT3_COSMOS_ENDPOINT', 'ACT3_COSMOS_DATABASE', 'ACT3_COSMOS_CONTAINER', 'ACT3_STAFFING_CASE_ID', 'ACT3_REDIRECT_URI']) required(name, env);
  if (!guid.test(env.ENTRA_CLIENT_ID)) throw new Error('ENTRA_CLIENT_ID must be the SPA registration GUID.');
  for (const [name, suffix] of [['ACT3_EMBEDDING_ENDPOINT', '.openai.azure.com'], ['ACT3_COSMOS_ENDPOINT', '.documents.azure.com']]) {
    const endpoint = new URL(env[name]);
    if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith(suffix) || endpoint.username || endpoint.password
      || endpoint.port || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) throw new Error(`Invalid ${name}.`);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(env.ACT3_EMBEDDING_DEPLOYMENT) || env.ACT3_EMBEDDING_PROFILE.length > 200) throw new Error('Invalid embedding deployment/profile.');
  const distance = Number(env.ACT3_GUIDANCE_MAX_DISTANCE);
  if (!Number.isFinite(distance) || distance <= 0 || distance > 2) throw new Error('Calibrate ACT3_GUIDANCE_MAX_DISTANCE in (0, 2].');
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(env.ACT3_STAFFING_CASE_ID)) throw new Error('Use a separately identified ACT3_STAFFING_CASE_ID.');
  if (env.ACT3_REDIRECT_URI !== `${config.origin}/api/app`) throw new Error('ACT3_REDIRECT_URI must be the exact Function /api/app URL.');
  if (!env.ENTRA_API_SCOPE.endsWith('/Act3.Access') || /\s/.test(env.ENTRA_API_SCOPE)) throw new Error('ENTRA_API_SCOPE must be one fully qualified Act3.Access scope.');
  return config;
}

export const seedSteps = ['apply-schema.mjs', 'prepare-staffing-memory.mjs', 'seed-staffing.mjs'];

export function executeSetup(mode, env = process.env, execute = execFileSync) {
  if (!['--check', '--seed'].includes(mode)) throw new Error('Use --check (no cloud calls) or --seed (approved existing resources).');
  const config = validateSetup(env);
  if (mode === '--check') return { checked: true, cloudWrites: false, steps: seedSteps };
  requireCloudWrite(env);
  if (env.CALDOVA_SYNTHETIC_SOURCE_CONFIRMED !== 'true') throw new Error('Set CALDOVA_SYNTHETIC_SOURCE_CONFIRMED=true after reviewing the authored memory.');
  verifyAzureContext(config, execute);
  for (const step of seedSteps) execute(process.execPath, [
    fileURLToPath(new URL(step, import.meta.url)),
    ...(step === 'prepare-staffing-memory.mjs' ? ['--write'] : []),
  ], {
    env, stdio: 'inherit', cwd: fileURLToPath(new URL('../../', import.meta.url)),
  });
  return { seeded: true, cloudWrites: true };
}

if (import.meta.main) {
  try { console.log(JSON.stringify(executeSetup(process.argv[2] || '--check'))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}