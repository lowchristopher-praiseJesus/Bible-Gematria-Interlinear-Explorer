"""Standalone entry point for the Bible chatbot backend.

Usage:
    uvicorn chatbot.main:app --reload --port 8000
"""

from chatbot import create_chatbot_app

app = create_chatbot_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("chatbot.main:app", host="0.0.0.0", port=8000, reload=True)
