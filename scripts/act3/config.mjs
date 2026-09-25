import { execFileSync } from 'node:child_process';

export function required(name, env = process.env) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required; configure your own demonstration environment.`);
  return value;
}

export function loadDeploymentConfig(env = process.env) {
  const config = {
    subscription: required('AZURE_SUBSCRIPTION_ID', env),
    tenant: required('ENTRA_TENANT_ID', env),
    group: required('AZURE_RESOURCE_GROUP', env),
    functionName: required('AZURE_FUNCTION_APP', env),
    sqlServer: required('ACT3_SQL_SERVER', env),
    sqlDatabase: required('ACT3_SQL_DATABASE', env),
    embeddingEndpoint: env.ACT3_EMBEDDING_ENDPOINT,
    embeddingDeployment: env.ACT3_EMBEDDING_DEPLOYMENT,
    embeddingProfile: env.ACT3_EMBEDDING_PROFILE,
  };
  for (const key of ['subscription', 'tenant']) {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(config[key])) throw new Error(`Invalid ${key}.`);
  }
  if (!/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/i.test(config.functionName)) throw new Error('Invalid Function app name.');
  if (!/^[a-z0-9-]+\.database\.windows\.net$/i.test(config.sqlServer)) throw new Error('Invalid Azure SQL hostname.');
  if (!/^[a-z0-9_.()-]+$/i.test(config.group) || !/^[a-z0-9_-]+$/i.test(config.sqlDatabase)) throw new Error('Invalid resource name.');
  return { ...config, origin: `https://${config.functionName}.azurewebsites.net` };
}

export function verifyAzureContext(config, execute = execFileSync) {
  const account = JSON.parse(execute('az', ['account', 'show', '--subscription', config.subscription, '-o', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  if (account.id !== config.subscription || account.tenantId !== config.tenant || account.state !== 'Enabled') {
    throw new Error('Azure tenant/subscription mismatch or disabled subscription; no cloud action performed.');
  }
}

export function requireCloudWrite(env = process.env) {
  if (env.CALDOVA_ALLOW_CLOUD_WRITES !== 'true') {
    throw new Error('This command mutates cloud resources. Review it first, then explicitly set CALDOVA_ALLOW_CLOUD_WRITES=true.');
  }
}