#!/usr/bin/env python3
"""Fill the visible Teams OAuth registration form without printing the client secret.

Requires Tim's signed-in Edge window, the registration form, and JavaScript from
Apple Events enabled. The generated secret travels in process memory via stdin.
"""

import argparse
import json
import subprocess


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--client-id', required=True)
    p.add_argument('--api-id', required=True)
    p.add_argument('--tenant-id', required=True)
    p.add_argument('--base-url', required=True)
    args = p.parse_args()
    # Append a dedicated short-lived credential; never reset other credentials.
    credential = json.loads(subprocess.check_output([
        'az', 'ad', 'app', 'credential', 'reset', '--id', args.client_id,
        '--append', '--display-name', 'Caldova Cowork connector', '--years', '1', '-o', 'json'
    ], text=True, stderr=subprocess.DEVNULL))
    authority = f'https://login.microsoftonline.com/{args.tenant_id}/oauth2/v2.0'
    fields = {
        'Enter a description': 'Caldova Campaigns',
        'https://api.example.com': args.base_url,
        'Enter the client ID': args.client_id,
        'Enter the client secret': credential['password'],
        'Example: https://login.example.com/authorize': authority+'/authorize',
        'Example: https://authorization-server.com/oauth/token': authority+'/token',
        'Example: https://authorization-server.com/oauth/refresh': authority+'/token',
        'Example: userprofile.read': f"api://{args.api_id}/Campaign.Access offline_access",
    }
    js = """(()=>{const fields=FIELDS;
      for(const [placeholder,value] of Object.entries(fields)){
        const e=[...document.querySelectorAll('input')].find(x=>x.placeholder===placeholder);
        if(!e)throw new Error('Missing field '+placeholder);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);
        e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));
      }
      const labels=[...document.querySelectorAll('label')];
      labels.find(x=>x.textContent.includes('Any Teams app'))?.click();
      labels.find(x=>x.textContent.includes('Any Microsoft 365 organization'))?.click();
      const pkce=document.querySelector('input[role=switch]');if(pkce&&!pkce.checked)pkce.click();
      return 'OAuth fields populated';
    })()""".replace('FIELDS', json.dumps(fields))
    script = 'tell application "Microsoft Edge" to execute active tab of front window javascript ' + json.dumps(js)
    result = subprocess.run(['osascript', '-'], input=script, text=True, capture_output=True)
    if result.returncode:
        raise SystemExit('Could not fill the form. Inspect the visible Edge page; no secret was logged.')
    print('OAuth form populated. Inspect the form and save it to the connector vault.')


if __name__ == '__main__':
    main()
