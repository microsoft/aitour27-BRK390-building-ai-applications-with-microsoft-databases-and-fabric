import importlib.util
from pathlib import Path
import uuid

import pytest
from fastapi.testclient import TestClient

from app import service
from app.auth import validate_claims


def test_delegated_identity_requires_scope():
    with pytest.raises(ValueError):
        validate_claims({'oid': 'user', 'tid': 'tenant', 'scp': 'User.Read'})
    assert validate_claims({'oid': 'user', 'tid': 'tenant', 'scp': 'Campaign.Access'}) == 'tenant:user'


def test_approval_requires_explicit_confirmation():
    with pytest.raises(ValueError, match='Explicit'):
        service.approve_campaign_plan('user', str(uuid.uuid4()), 1, str(uuid.uuid4()), False)


def test_mcp_discovery_and_authenticated_tool_calls(monkeypatch):
    monkeypatch.setenv('AUTH_MODE', 'local')
    from app.server import app
    from app import service
    observed = []
    monkeypatch.setattr(service, 'evaluate_campaign', lambda *args: observed.append(args) or {'state': 'queued'})
    headers = {'Accept': 'application/json, text/event-stream'}
    with TestClient(app) as client:
        response = client.post('/mcp/', headers=headers, json={
            'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {
                'protocolVersion': '2025-03-26', 'capabilities': {},
                'clientInfo': {'name': 'copilot-cowork', 'version': '1.0'}}})
        assert response.status_code == 200
        tools = client.post('/mcp/', headers=headers, json={'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'}).json()['result']['tools']
        approval = next(t for t in tools if t['name'] == 'approve_campaign_plan')
        assert approval['annotations']['readOnlyHint'] is False
        response = client.post('/mcp/', headers=headers, json={'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call',
            'params': {'name': 'evaluate_campaign', 'arguments': {'question': 'Where to invest?', 'budget_usd': 30000, 'request_key': 'campaign-001'}}})
        assert response.status_code == 200
        assert observed[0][0] == 'local:presenter'
        assert client.get('/api/jobs/unknown', headers={'X-Forwarded-For': '203.0.113.4'}).status_code == 401
        assert client.get('/').status_code == 200


def test_remote_mode_rejects_missing_and_bad_tokens(monkeypatch):
    monkeypatch.setenv('AUTH_MODE', 'entra')
    monkeypatch.setenv('ENTRA_TENANT_ID', 'test-tenant')
    monkeypatch.setenv('ENTRA_API_CLIENT_ID', 'test-api')
    from fastapi import FastAPI
    app = FastAPI()
    from app.auth import IdentityMiddleware
    with TestClient(IdentityMiddleware(app)) as client:
        assert client.get('/api/jobs/test').status_code == 401
        assert client.get('/api/jobs/test', headers={'Authorization': 'Bearer invalid'}).status_code == 401


def test_plugin_manifest_requires_real_connection_values():
    spec = importlib.util.spec_from_file_location('package_plugin', Path('scripts/package-plugin.py'))
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with pytest.raises(ValueError):
        module.build_manifest('http://localhost:8000', '', 'https://example.com', 'https://example.com/privacy', 'https://example.com/terms')
    manifest = module.build_manifest('https://campaign.example.com', 'vault-id',
                                     'https://example.com', 'https://example.com/privacy', 'https://example.com/terms')
    assert manifest['manifestVersion'] == '1.28'
    connector = manifest['agentConnectors'][0]['toolSource']['remoteMcpServer']
    assert connector['mcpServerUrl'] == 'https://campaign.example.com/mcp/'
    assert connector['authorization']['type'] == 'OAuthPluginVault'


def test_plugin_zip_contains_skill_tools_and_icons(tmp_path):
    import subprocess
    import json
    import zipfile
    import sys
    from PIL import Image
    output = tmp_path / 'plugin.zip'
    subprocess.run([sys.executable, 'scripts/package-plugin.py', '--base-url', 'https://campaign.example.com',
                    '--oauth-reference', 'test-vault-id', '--website', 'https://example.com',
                    '--privacy-url', 'https://example.com/privacy', '--terms-url', 'https://example.com/terms',
                    '--output', str(output)], check=True)
    with zipfile.ZipFile(output) as package:
        manifest = json.loads(package.read('manifest.json'))
        tools = json.loads(package.read('tools/caldova.json'))['tools']
        assert len(tools) == 5
        assert package.read('skills/caldova-campaign-planning/SKILL.md').startswith(b'---')
        assert Image.open(package.open('color.png')).size == (192, 192)
        assert Image.open(package.open('outline.png')).size == (32, 32)
        for connector in manifest['agentConnectors']:
            path = connector['toolSource']['remoteMcpServer']['mcpToolDescription']['file']
            assert path in package.namelist()
            assert json.loads(package.read(path))['tools']
        for skill in manifest['agentSkills']:
            assert skill['folder'] + '/SKILL.md' in package.namelist()
        assert manifest['version'] == '1.0.1'


@pytest.mark.skipif(not __import__('os').environ.get('CALDOVA_LIVE_TEST'), reason='Requires live HorizonDB and model access')
def test_live_agent_evaluation_approval_and_handoff():
    principal = 'local:presenter'
    key = 'hydration-investment-' + uuid.uuid4().hex[:8]
    job = service.evaluate_campaign(principal, 'Where should we invest USD 30000 in Hydration Sunscreen?', 30000, key)
    duplicate = service.evaluate_campaign(principal, 'Where should we invest USD 30000 in Hydration Sunscreen?', 30000, key)
    assert duplicate['job_id'] == job['job_id']
    with pytest.raises(ValueError):
        service.get_campaign_proposal('different-user', job['job_id'])
    assert service.work_once()
    proposal = service.get_campaign_proposal(principal, job['job_id'])
    assert proposal['state'] == 'ready', proposal.get('error')
    chosen = next(o['result'] for o in proposal['options'] if o['scenario'] == proposal['selected_scenario'])
    assert chosen['incremental_units'] == 57000
    args = (principal, job['job_id'], proposal['evaluation_id'], proposal['review_token'], True)
    approval = service.approve_campaign_plan(*args)
    assert service.approve_campaign_plan(*args)['approved_plan_id'] == approval['approved_plan_id']
    handoff = service.get_production_request(principal, job['job_id'])
    assert handoff['required_units'] == 57000
    assert handoff['status'] == 'queued'
    assert 'Karin' in handoff['payload']['conversation_starter']
    assert 'USD 30,000' in handoff['payload']['conversation_starter']
    workflow = service.get_ai_workflow(principal, job['job_id'])
    assert all(p['run']['status'] == 'completed' for p in workflow['pipelines'])
    print('Live job:', job['job_id'], 'case:', job['case_id'])
