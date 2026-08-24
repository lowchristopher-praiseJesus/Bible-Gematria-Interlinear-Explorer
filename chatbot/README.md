# Bible Study Chatbot Backend

FastAPI sub-application that exposes myBibleToolbox research tools as REST endpoints.

## Quick Start (Standalone)

```bash
# Install dependencies
pip install -r requirements.txt

# Start the server
uvicorn chatbot.main:app --reload --port 8000
```

## Embed in Existing Backend

```python
from fastapi import FastAPI
from chatbot import create_chatbot_app

app = FastAPI()
app.mount("/api/bible-chat", create_chatbot_app())
```

## Environment Variables

- `ANTHROPIC_API_KEY` — Required for Claude API fallback on complex theological questions.
- `MYBIBLE_DATA_DIR` — Path to mybibletoolbox-data repo (auto-detected if not set).

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/verse/{reference}` | Fetch verse translations |
| GET | `/study/{reference}?depth=medium` | Fetch commentary |
| GET | `/strongs/{query}` | Strong's lookup by number or word |
| POST | `/chat` | Chat with deterministic + Claude routing |
| POST | `/chat/stream` | Same, with SSE streaming |
| GET | `/book_context/{book}` | Fetch book-level context (historical setting, themes, etc.) for a NT book |
| GET | `/parables` | List curated parables for Parable Study mode |
| GET | `/topics` | List curated topics for Topical Study mode |

## Example Requests

```bash
# Verse lookup
curl http://localhost:8000/verse/JHN%203:16

# Commentary
curl http://localhost:8000/study/LUK%2016:8?depth=medium

# Strong's number
curl http://localhost:8000/strongs/G0026

# Chat
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "quote John 3:16"}'
```
