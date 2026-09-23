#!/usr/bin/env python3
"""Build the Teams personal/group/channel app package for Factory Planning Agent."""
import argparse
import importlib.util
import json
from pathlib import Path
from urllib.parse import urlparse
import uuid
import zipfile

root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('icons',root/'scripts/package-plugin.py')
assert spec and spec.loader
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--bot-id',required=True)
p.add_argument('--base-url',required=True)
args=p.parse_args()
uuid.UUID(args.bot_id)
if urlparse(args.base_url).scheme!='https':p.error('HTTPS base URL required')
manifest={
 '$schema':'https://developer.microsoft.com/json-schemas/teams/v1.23/MicrosoftTeams.schema.json',
 'manifestVersion':'1.23','version':'1.0.0',
 'id':str(uuid.uuid5(uuid.NAMESPACE_DNS,'caldova-factory-planning')),
 'developer':{'name':'Caldova','websiteUrl':args.base_url,'privacyUrl':args.base_url+'/privacy','termsOfUseUrl':args.base_url+'/terms'},
 'name':{'short':'Factory Planning Agent','full':'Caldova Factory Planning Agent'},
 'description':{'short':'Validate campaign demand against factory capacity and maintenance.',
 'full':'Help Tim and Karin assess Hydration Sunscreen production demand, preserve maintenance and existing customer orders, compare capacity alternatives, and record Karin’s approval of an exact production revision.'},
 'icons':{'color':'color.png','outline':'outline.png'},'accentColor':'#126B59',
 'bots':[{'botId':args.bot_id,'scopes':['personal','team','groupChat'],'isNotificationOnly':False,
          'supportsFiles':False,'commandLists':[{'scopes':['personal','team','groupChat'],'commands':[
          {'title':'Assess campaign','description':'Can PKG-03 absorb the approved Hydration Sunscreen campaign?'},
          {'title':'Compare alternatives','description':'Keep maintenance and existing orders. What alternatives do we have?'}]}]}],
 'permissions':['identity'],'validDomains':[urlparse(args.base_url).netloc]
}
out=root/'dist/factory-planning-agent.zip';out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
 z.writestr('manifest.json',json.dumps(manifest,indent=2))
 z.writestr('color.png',module.icon(192));z.writestr('outline.png',module.icon(32,True))
print(out)
