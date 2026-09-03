"""Bible Study Chatbot Backend for myBibleToolbox.

A FastAPI sub-application that exposes biblical research tools
(verse lookup, commentary, Strong's) as REST endpoints with
hybrid deterministic + Claude API routing.

Usage:
    from chatbot import create_chatbot_app
    app.mount("/api/bible-chat", create_chatbot_app())
"""

from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load the repo-root .env so a directly-launched process picks up LLM_PROVIDER
# and the provider-specific vars. docker-compose wires these via `env_file`, but
# `python -m chatbot` / uvicorn started by hand does not. Runs at import time,
# before create_chatbot_app() imports chatbot.api -> ollama_client (which reads
# these vars into module-level constants). Real env vars still win over .env.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def create_chatbot_app() -> FastAPI:
    """Create and configure the chatbot FastAPI sub-application."""
    app = FastAPI(
        title="myBibleToolbox Chatbot",
        description="Bible study chatbot with verse lookup, commentary, and Strong's tools",
        version="0.1.0",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from chatbot.api import router
    app.include_router(router, prefix="")

    return app
