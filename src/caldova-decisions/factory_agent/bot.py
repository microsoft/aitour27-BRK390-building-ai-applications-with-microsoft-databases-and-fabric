"""Teams channel bot. Bot Service JWT verification is handled by the Teams SDK."""

import asyncio
import html
import logging
import os
import re

from microsoft_teams.api import MessageActivity
from microsoft_teams.apps import App, ActivityContext
from microsoft_teams.apps.http import FastAPIAdapter
from fastapi import FastAPI
from fastapi.responses import PlainTextResponse
import uvicorn

from factory_agent.service import handle


def create_app():
    for key in ('CLIENT_ID', 'CLIENT_SECRET', 'TENANT_ID', 'FACTORY_ALLOWED_USERS', 'FACTORY_CASE_ID'):
        if not os.environ.get(key):
            raise ValueError(f'Set {key}; anonymous bot mode is not supported')
    allowed = set(os.environ['FACTORY_ALLOWED_USERS'].split(','))
    http = FastAPI()

    @http.get('/health')
    def health():
        return {'status': 'ok', 'agent': 'Factory Planning Agent'}

    @http.get('/privacy', response_class=PlainTextResponse)
    def privacy():
        return ('Caldova Factory Planning demonstration. Fictional planning data, Teams user IDs, '
                'questions, responses and approvals are stored in Azure HorizonDB. Questions are '
                'processed by the configured Azure AI model. Do not submit confidential production data. '
                'Contact the demonstration operator for access or deletion requests.')

    @http.get('/terms', response_class=PlainTextResponse)
    def terms():
        return ('Private demonstration only. All manufacturing fixtures are fictional. '
                'Approval records a demonstration schedule, not a real factory instruction.')

    adapter = FastAPIAdapter(http, server_factory=lambda app: uvicorn.Server(
        uvicorn.Config(app, host=os.environ.get('FACTORY_HOST', '::'), port=int(os.environ.get('PORT', '3978')),
                       proxy_headers=False)))
    app = App(http_server_adapter=adapter)

    @app.on_message
    async def message(ctx: ActivityContext[MessageActivity]):
        activity = ctx.activity
        data = activity.model_dump(mode='json', by_alias=True)
        tenant = (data.get('channelData') or {}).get('tenant', {}).get('id') or data.get('conversation', {}).get('tenantId')
        user = (data.get('from') or {}).get('aadObjectId')
        if tenant != os.environ['TENANT_ID'] or user not in allowed:
            await ctx.reply('This factory planning demonstration is available to its assigned Tim and Karin accounts.')
            return
        text = html.unescape(re.sub(r'<[^>]+>', '', re.sub(r'<at>.*?</at>', '', activity.text or '', flags=re.S))).strip()
        if not text:
            await ctx.reply('Ask whether PKG-03 can cover the approved Hydration Sunscreen campaign, or ask for production alternatives.')
            return
        # SDK's activity conversation ID includes channel thread scope when present;
        # append root ID defensively if a plain channel conversation is delivered.
        conversation = activity.conversation.id
        root = activity.reply_to_id or activity.id
        if data.get('conversation', {}).get('conversationType') == 'channel' and ';messageid=' not in conversation:
            conversation += ';messageid=' + root
        try:
            answer = await asyncio.to_thread(handle, tenant, conversation, activity.id, user,
                                             text, os.environ['FACTORY_CASE_ID'])
        except ValueError as exc:
            answer = str(exc)
        except Exception:
            logging.exception('Factory planning request failed')
            answer = 'I could not complete the planning check. No approval was recorded. Please retry after the service recovers.'
        await ctx.reply(answer)

    return app


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    asyncio.run(create_app().start())
