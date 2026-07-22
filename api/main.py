"""Run the AirVPN mobile API: python -m api.main"""
from __future__ import annotations

import os

import uvicorn


def main() -> None:
    host = os.getenv("MOBILE_API_HOST", "0.0.0.0")
    port = int(os.getenv("MOBILE_API_PORT", "8081"))
    uvicorn.run("api.app:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()
