"""Bible Study Chatbot Backend for myBibleToolbox.

A FastAPI sub-application that exposes biblical research tools
(verse lookup, commentary, Strong's) as REST endpoints with
hybrid deterministic + Claude API routing.

Usage:
    from chatbot import create_chatbot_app
    app.mount("/api/bible-chat", create_chatbot_app())
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


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
