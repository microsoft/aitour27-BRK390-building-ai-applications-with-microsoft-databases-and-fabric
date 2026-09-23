"""Remote MCP tools and a read-only decision inspection web interface."""

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations
from pydantic import Field
from mcp.server.transport_security import TransportSecuritySettings
import os

from app import service
from app.auth import IdentityMiddleware, current_principal

from urllib.parse import urlparse
remote_host = urlparse(os.environ.get('PUBLIC_BASE_URL', 'http://localhost:8000')).netloc
mcp = FastMCP('Caldova Campaign Agent', stateless_http=True, json_response=True,
              streamable_http_path='/', transport_security=TransportSecuritySettings(
                  enable_dns_rebinding_protection=True,
                  allowed_hosts=['127.0.0.1:*', 'localhost:*', '[::1]:*', 'testserver', remote_host],
                  allowed_origins=['http://localhost:*', 'http://127.0.0.1:*',
                                   os.environ.get('PUBLIC_BASE_URL', 'http://localhost:8000')]))


@mcp.tool(annotations=ToolAnnotations(title='Evaluate campaign investment', readOnlyHint=False,
                                     destructiveHint=False, idempotentHint=True))
async def evaluate_campaign(
    question: str = Field(description="Tim's campaign question; no predefined allocation"),
    budget_usd: float = Field(description='Maximum additional investment in US dollars', ge=0, le=1000000),
    request_key: str = Field(description='Stable key for retries of this request; use a new key for changed inputs'),
) -> dict:
    """Queue a six-week Hydration Sunscreen evaluation. Returns immediately; poll get_campaign_proposal."""
    return await asyncio.to_thread(service.evaluate_campaign, current_principal(), question, budget_usd, request_key)


@mcp.tool(annotations=ToolAnnotations(title='Read campaign proposal', readOnlyHint=True, destructiveHint=False))
async def get_campaign_proposal(job_id: str = Field(description='Job ID returned by evaluate_campaign')) -> dict:
    """Read actual workflow status, evaluated options, evidence and generated brief. Present before approval."""
    return await asyncio.to_thread(service.get_campaign_proposal, current_principal(), job_id)


@mcp.tool(annotations=ToolAnnotations(title='Approve reviewed marketing plan', readOnlyHint=False,
                                     destructiveHint=False, idempotentHint=True))
async def approve_campaign_plan(
    job_id: str = Field(description='Job ID of the proposal the user reviewed'),
    evaluation_id: int = Field(description='Exact evaluation ID presented to and approved by the user'),
    review_token: str = Field(description='Review token from the same get_campaign_proposal result'),
    user_confirmed: bool = Field(description='True only after the user explicitly approves this presented plan'),
) -> dict:
    """Record explicit approval of the reviewed version and queue production review. Never call during evaluation."""
    return await asyncio.to_thread(service.approve_campaign_plan, current_principal(), job_id,
                                   evaluation_id, review_token, user_confirmed)


@mcp.tool(annotations=ToolAnnotations(title="Read Karin's production request", readOnlyHint=True, destructiveHint=False))
async def get_production_request(job_id: str = Field(description='Job ID of the approved campaign')) -> dict:
    """Return the saved production request and message for Karin. Queued does not mean sent to Teams."""
    return await asyncio.to_thread(service.get_production_request, current_principal(), job_id)


@mcp.tool(annotations=ToolAnnotations(title='Inspect HorizonDB AI pipelines', readOnlyHint=True, destructiveHint=False))
async def get_ai_workflow(job_id: str = Field(description='Job ID whose pipeline runs should be inspected')) -> dict:
    """Read deployed pipeline definitions, graphs and the actual durable runs associated with this request."""
    return await asyncio.to_thread(service.get_ai_workflow, current_principal(), job_id)


@asynccontextmanager
async def lifespan(app):
    async with mcp.session_manager.run():
        yield


app = FastAPI(title='Caldova decision evidence', lifespan=lifespan)
app.add_middleware(IdentityMiddleware)
static = Path(__file__).parent / 'static'
app.mount('/static', StaticFiles(directory=static), name='static')
app.mount('/mcp', mcp.streamable_http_app())


@app.get('/')
def index():
    return FileResponse(static / 'index.html')


@app.get('/health')
def health():
    return {'status': 'ok'}


@app.get('/privacy', response_class=PlainTextResponse)
def privacy():
    return ('Caldova campaign demonstration — privacy notice\n\n'
            'This privately installed demonstration processes campaign questions, '
            'signed-in tenant/user identifiers, planning evidence and approval records. '
            'Records are stored in the demonstration Azure HorizonDB database. '
            'The configured Azure AI model processes planning text to extract facts and generate briefs. '
            'Campaign data is fictional. Do not submit personal or confidential production data. '
            'The demonstration operator manages access and removal of these records. '
            'The plugin prepares production requests but does not send Teams messages.')


@app.get('/terms', response_class=PlainTextResponse)
def terms():
    return ('Caldova campaign demonstration — terms of use\n\n'
            'For private demonstration and evaluation only. Caldova and campaign fixtures are fictional. '
            'Generated recommendations require human review. This demonstration is not a production '
            'marketing, financial, or factory-planning service. Approval writes a demonstration record '
            'and queues a capacity request; it does not authorize real expenditure or production. '
            'Use only with the demonstration operator\'s permission.')


@app.get('/api/jobs/{job_id}')
def proposal(job_id: str):
    try:
        return service.get_campaign_proposal(current_principal(), job_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.get('/api/jobs/{job_id}/workflow')
def workflow(job_id: str):
    try:
        return service.get_ai_workflow(current_principal(), job_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.get('/api/jobs/{job_id}/production')
def production(job_id: str):
    try:
        return service.get_production_request(current_principal(), job_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
