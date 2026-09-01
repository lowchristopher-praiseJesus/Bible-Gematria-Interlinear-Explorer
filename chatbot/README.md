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
- `~/Documents/study-wikis/` — External library directory (not part of this repo) holding registered study-wiki series for Topical Study mode; see `chatbot/data/study_wikis.py` for the registry and the three-layer schema (`raw/`, `wiki/`, `AGENTS.md`) each entry's `path` must follow. A machine without this directory simply gets an empty study-wiki library (entries whose `path` doesn't resolve are skipped and logged), not a crash — but Topical Study mode and its tests that expect real series data need it present.

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
| GET | `/study-wikis` | List registered study-wiki series for Topical Study mode |
| GET | `/study-wikis/{series_id}/pages/{slug}` | Fetch one rendered concept/entity/source page from a registered study wiki |

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
