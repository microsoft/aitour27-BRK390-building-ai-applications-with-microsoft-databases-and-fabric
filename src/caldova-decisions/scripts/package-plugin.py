#!/usr/bin/env python3
"""Build a Cowork v1.28 package with live MCP tool descriptions and a skill."""

import argparse
import asyncio
from io import BytesIO
import json
from pathlib import Path
import sys
from urllib.parse import urlparse
import uuid
import zipfile

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.server import mcp


def icon(size, outline=False):
    image = Image.new('RGBA', (size, size), (0, 0, 0, 0) if outline else '#126b59')
    draw = ImageDraw.Draw(image)
    margin = size // 4
    draw.arc((margin, margin, size-margin, size-margin), 45, 315, fill='white', width=max(2, size//14))
    buffer = BytesIO()
    image.save(buffer, format='PNG')
    return buffer.getvalue()


def build_manifest(base_url, oauth_reference, website, privacy, terms):
    for value in (base_url, website, privacy, terms):
        if urlparse(value).scheme != 'https' or not urlparse(value).netloc:
            raise ValueError('Endpoint and developer URLs must use HTTPS')
    if not oauth_reference.strip():
        raise ValueError('Microsoft 365 OAuth vault registration ID is required')
    return {
        '$schema': 'https://developer.microsoft.com/json-schemas/teams/v1.28/MicrosoftTeams.schema.json',
        'manifestVersion': '1.28', 'version': '1.0.1',
        'id': str(uuid.uuid5(uuid.NAMESPACE_DNS, 'caldova-campaign-planning')),
        'developer': {'name': 'Caldova', 'websiteUrl': website, 'privacyUrl': privacy, 'termsOfUseUrl': terms},
        'name': {'short': 'Caldova Campaigns', 'full': 'Caldova campaign planning'},
        'description': {'short': 'Evidence-based sunscreen campaign decisions and production handoffs',
                        'full': 'Evaluate regional campaign investment using HorizonDB AI Pipelines, review evidence, approve a versioned forecast, and prepare a production capacity review for Karin.'},
        'icons': {'color': 'color.png', 'outline': 'outline.png'}, 'accentColor': '#126B59',
        'agentSkills': [{'folder': 'skills/caldova-campaign-planning'}],
        'agentConnectors': [{'id': 'caldova-campaigns', 'displayName': 'Caldova marketing decisions',
            'description': 'Evaluate campaigns, inspect AI pipelines, approve forecasts and prepare production requests.',
            'toolSource': {'remoteMcpServer': {'mcpServerUrl': base_url.rstrip('/')+'/mcp/',
                'mcpToolDescription': {'file': 'tools/caldova.json'},
                'authorization': {'type': 'OAuthPluginVault', 'referenceId': oauth_reference}}}}],
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--base-url', required=True)
    p.add_argument('--oauth-reference', required=True, help='M365 vault registration ID, not the Entra application ID')
    p.add_argument('--website', required=True)
    p.add_argument('--privacy-url', required=True)
    p.add_argument('--terms-url', required=True)
    p.add_argument('--output', type=Path, default=ROOT/'dist'/'caldova-cowork.zip')
    args = p.parse_args()
    manifest = build_manifest(args.base_url, args.oauth_reference, args.website, args.privacy_url, args.terms_url)
    tools = [t.model_dump(mode='json', exclude_none=True) for t in asyncio.run(mcp.list_tools())]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.output, 'w', zipfile.ZIP_DEFLATED) as package:
        package.writestr('manifest.json', json.dumps(manifest, indent=2))
        package.writestr('tools/caldova.json', json.dumps({'tools': tools}, indent=2))
        package.writestr('color.png', icon(192))
        package.writestr('outline.png', icon(32, True))
        package.write(ROOT/'plugin/skills/caldova-campaign-planning/SKILL.md',
                      'skills/caldova-campaign-planning/SKILL.md')
    # Cowork's uploader can resolve these literally, rather than normalize './'.
    with zipfile.ZipFile(args.output) as package:
        for connector in manifest['agentConnectors']:
            path = connector['toolSource']['remoteMcpServer']['mcpToolDescription']['file']
            package.getinfo(path)
        for skill in manifest['agentSkills']:
            package.getinfo(skill['folder'] + '/SKILL.md')
    print(f'Created {args.output}; validate and install with Microsoft 365 Agents Toolkit.')


if __name__ == '__main__':
    main()
