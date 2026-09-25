#!/usr/bin/env python3
"""Create/reuse a Teams bot identity and deploy its Azure Bot registration with Bicep."""

import argparse
import json
import os
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]


def azure(*args):
    result=subprocess.run(['az',*args,'-o','json'],text=True,capture_output=True,check=True)
    return json.loads(result.stdout) if result.stdout.strip() else {}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--endpoint',required=True,help='Public HTTPS URL ending in /api/messages')
    p.add_argument('--resource-group',required=True)
    p.add_argument('--tim-id',required=True,help='Tim demo user Entra object ID')
    p.add_argument('--karin-id',required=True,help='Karin demo user Entra object ID')
    p.add_argument('--bot-name',default='caldova-factory-planning')
    p.add_argument('--case-id',default='HYDRATION-SUNSCREEN-CAMPAIGN-001')
    args=p.parse_args()
    if not args.endpoint.startswith('https://') or not args.endpoint.endswith('/api/messages'):
        p.error('Use an HTTPS /api/messages endpoint')
    account=azure('account','show')
    apps=azure('ad','app','list','--display-name','Caldova Factory Planning Agent')
    if len(apps)>1:raise SystemExit('Multiple matching app registrations; resolve before deployment')
    app=apps[0] if apps else azure('ad','app','create','--display-name','Caldova Factory Planning Agent','--sign-in-audience','AzureADMyOrg')
    principals=azure('ad','sp','list','--filter',f"appId eq '{app['appId']}'")
    if not principals:
        azure('ad','sp','create','--id',app['appId'])
    local=ROOT/'.azure/local/factory-bot.json'
    local.parent.mkdir(parents=True,exist_ok=True)
    config=json.loads(local.read_text()) if local.exists() else {}
    if config.get('CLIENT_ID')!=app['appId'] or not config.get('CLIENT_SECRET'):
        credential=azure('ad','app','credential','reset','--id',app['appId'],'--append',
                         '--display-name','Factory agent local development','--years','1')
        config.update(CLIENT_ID=app['appId'],CLIENT_SECRET=credential['password'])
    config.update(TENANT_ID=account['tenantId'],PORT='3978',FACTORY_HOST='::',
                  FACTORY_CASE_ID=args.case_id,
                  FACTORY_ALLOWED_USERS=','.join([args.tim_id,args.karin_id]))
    fd=os.open(local,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    os.fchmod(fd,0o600)
    with os.fdopen(fd,'w') as f:json.dump(config,f,indent=2)
    azure('deployment','group','validate','-g',args.resource_group,'--template-file',str(ROOT/'infra/factory-bot.bicep'),
          '--parameters',f'botName={args.bot_name}',f"clientId={app['appId']}",f'endpoint={args.endpoint}')
    result=azure('deployment','group','create','--name','caldova-factory-agent','-g',args.resource_group,
                 '--template-file',str(ROOT/'infra/factory-bot.bicep'),'--parameters',f'botName={args.bot_name}',
                 f"clientId={app['appId']}",f'endpoint={args.endpoint}')
    print(json.dumps({'client_id':app['appId'],'tenant_id':account['tenantId'],
                       'endpoint':args.endpoint,'state':result['properties']['provisioningState'],
                       'credentials_file':str(local),'credentials_permissions':'0600'},indent=2))


if __name__=='__main__':main()
