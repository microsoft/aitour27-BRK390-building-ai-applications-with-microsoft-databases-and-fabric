#!/usr/bin/env python3
"""Create the single-tenant Caldova API registration and delegated access scope."""

import argparse
import json
import subprocess
import uuid


def az(*args, payload=None):
    response = subprocess.run(['az', *args, '-o', 'json'], text=True, capture_output=True,
                              input=json.dumps(payload) if payload is not None else None, check=True)
    return json.loads(response.stdout) if response.stdout.strip() else {}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--name', default='Caldova Campaign API')
    p.add_argument('--create', action='store_true', help='Create/update the application registration')
    args = p.parse_args()
    if not args.create:
        p.error('Use --create to create the API registration in the active Azure CLI tenant')
    matches = az('ad', 'app', 'list', '--display-name', args.name)
    matches = [a for a in matches if a['displayName'] == args.name]
    if len(matches) > 1:
        p.error('Several applications have this name; choose a unique name')
    app = matches[0] if matches else az('ad', 'app', 'create', '--display-name', args.name,
                                       '--sign-in-audience', 'AzureADMyOrg')
    scopes = app.get('api', {}).get('oauth2PermissionScopes', [])
    if not any(s['value'] == 'Campaign.Access' for s in scopes):
        scopes.append({'id': str(uuid.uuid4()), 'value': 'Campaign.Access', 'type': 'User', 'isEnabled': True,
                       'adminConsentDisplayName': 'Access Caldova campaign planning',
                       'adminConsentDescription': 'Evaluate and approve campaign plans as the signed-in user.',
                       'userConsentDisplayName': 'Access Caldova campaign planning',
                       'userConsentDescription': 'Evaluate and approve campaign plans as you.'})
    az('rest', '--method', 'patch', '--url', f"https://graph.microsoft.com/v1.0/applications/{app['id']}",
       '--body', '@/dev/stdin', payload={
           'identifierUris': list(set(app.get('identifierUris', []) + [f"api://{app['appId']}"])),
           'api': {'requestedAccessTokenVersion': 2, 'oauth2PermissionScopes': scopes}})
    tenant = az('account', 'show')['tenantId']
    print(json.dumps({'ENTRA_TENANT_ID': tenant, 'ENTRA_API_CLIENT_ID': app['appId'],
                      'scope': f"api://{app['appId']}/Campaign.Access",
                      'authorization_endpoint': f'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize',
                      'token_endpoint': f'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token',
                      'next': 'Register the OAuth client in the M365 connector vault and configure its redirect URI in Entra.'}, indent=2))


if __name__ == '__main__':
    main()
