"""Validate Entra delegated tokens; local mode is restricted to loopback clients."""

from contextvars import ContextVar
import os

import jwt
from starlette.responses import JSONResponse

principal: ContextVar[str | None] = ContextVar("principal", default=None)


def validate_claims(claims):
    if not claims.get('oid') or not claims.get('tid'):
        raise ValueError('A user identity is required')
    if 'Campaign.Access' not in claims.get('scp', '').split():
        raise ValueError('Campaign.Access delegated scope is required')
    return f"{claims['tid']}:{claims['oid']}"


class IdentityMiddleware:
    def __init__(self, app):
        self.app = app
        self.mode = os.environ.get('AUTH_MODE', 'entra')
        self.tenant = os.environ.get('ENTRA_TENANT_ID', '')
        self.audience = os.environ.get('ENTRA_API_CLIENT_ID', '')
        if self.mode not in ('local', 'entra'):
            raise ValueError('AUTH_MODE must be local or entra')
        if self.mode == 'entra' and (not self.tenant or not self.audience):
            raise ValueError('Set ENTRA_TENANT_ID and ENTRA_API_CLIENT_ID')
        self.keys = jwt.PyJWKClient(
            f'https://login.microsoftonline.com/{self.tenant}/discovery/v2.0/keys') if self.tenant else None

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or not scope['path'].startswith(('/api/', '/mcp')):
            await self.app(scope, receive, send)
            return
        try:
            if self.mode == 'local':
                host = (scope.get('client') or ('',))[0]
                headers = dict(scope['headers'])
                if host not in ('127.0.0.1', '::1', 'testclient') or any(
                    key in headers for key in (b'forwarded', b'x-forwarded-for', b'x-original-host')
                ):
                    raise ValueError('Local mode only accepts loopback connections')
                user = 'local:presenter'
            else:
                headers = dict(scope['headers'])
                header = headers.get(b'authorization', b'').decode()
                if not header.startswith('Bearer '):
                    raise ValueError('Bearer token required')
                token = header[7:]
                import asyncio
                assert self.keys is not None
                key = await asyncio.to_thread(self.keys.get_signing_key_from_jwt, token)
                claims = jwt.decode(token, key.key, algorithms=['RS256'], audience=self.audience,
                                    issuer=f'https://login.microsoftonline.com/{self.tenant}/v2.0',
                                    options={'require': ['exp', 'iss', 'aud', 'oid', 'tid']})
                user = validate_claims(claims)
            reset = principal.set(user)
        except (ValueError, jwt.PyJWTError):
            await JSONResponse({'error': 'Authentication required or token is not authorized'}, status_code=401,
                               headers={'WWW-Authenticate': 'Bearer'})(scope, receive, send)
            return
        try:
            await self.app(scope, receive, send)
        finally:
            principal.reset(reset)


def current_principal():
    value = principal.get()
    if not value:
        raise ValueError('Authenticated user is required')
    return value
