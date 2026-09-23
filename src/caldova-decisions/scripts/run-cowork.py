#!/usr/bin/env python3
"""Start the configured Entra-protected server for the Caldova Cowork tunnel."""
import json
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
path = root/'plugin/connection.json'
if not path.exists():
    raise SystemExit('Copy plugin/connection.example.json to plugin/connection.json and fill in your deployment values.')
config = json.loads(path.read_text())
if any('YOUR_' in str(value) for value in config.values()):
    raise SystemExit('Replace all YOUR_ placeholders in plugin/connection.json before startup.')
env = dict(os.environ, AUTH_MODE='entra', ENTRA_TENANT_ID=config['tenant_id'],
           ENTRA_API_CLIENT_ID=config['api_client_id'], PUBLIC_BASE_URL=config['base_url'])
raise SystemExit(subprocess.call([sys.executable, str(root/'scripts/run-agent.py'), '--host', '::'], env=env))
