"""HTTP subscription endpoint for VPN client apps."""
from __future__ import annotations

from fastapi import FastAPI, Response

import config
from services.subscription import fetch_user_subscription_payload

app = FastAPI(title="AirVPN Subscription", docs_url=None, redoc_url=None)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/sub/{token}")
async def subscription(token: str) -> Response:
    if not config.SUB_ENABLED:
        return Response(status_code=503, content="Subscription service disabled")

    result = await fetch_user_subscription_payload(token)
    if not result:
        return Response(status_code=404, content="Not found")

    body, headers = result
    return Response(content=body, headers=headers)
