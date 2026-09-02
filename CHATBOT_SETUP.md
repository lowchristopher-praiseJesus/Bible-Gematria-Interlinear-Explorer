# Bible Chatbot Setup Guide

## Overview

The chatbot talks to one LLM provider, chosen by the `LLM_PROVIDER` env var:
**`nvidia`** (NVIDIA NIM, OpenAI-compatible) or **`ollama`** (Ollama native API,
the default when unset). The Docker deployment defaults to `nvidia`.

## Configuration Modes

### Option 0: NVIDIA NIM (hosted build.nvidia.com)

OpenAI-compatible endpoint. API key required (`nvapi-...` from
<https://build.nvidia.com>). No GPU needed locally — inference is off-box.

```bash
export LLM_PROVIDER="nvidia"
export NVIDIA_API_URL="https://integrate.api.nvidia.com/v1"
export NVIDIA_MODEL="meta/llama-3.3-70b-instruct"
export NVIDIA_API_KEY="nvapi-your-key-here"
```

### Option 1: Local Ollama (Recommended)

Uses your locally installed Ollama app. No API key required.

```bash
# Local Ollama (default - no API key needed)
export OLLAMA_API_URL="http://localhost:11434"
export OLLAMA_MODEL="deepseek-v4-pro:cloud"
```

### Option 2: Ollama Cloud

Uses Ollama's cloud service. API key required.

```bash
# Ollama Cloud
export OLLAMA_API_KEY="your-ollama-api-key-here"
export OLLAMA_API_URL="https://api.ollama.com/v1"
export OLLAMA_MODEL="deepseek-v4-pro:cloud"
```

## Starting the Services

### Step 1: Start the Chatbot Backend (FastAPI)

```bash
# Navigate to the mybibletoolbox-code directory (or use the copied chatbot)
cd ~/Documents/mybibletoolbox-code

# Install dependencies (if not done)
pip install -r requirements.txt

# Set your Ollama API key
export OLLAMA_API_KEY="your-api-key-here"

# Start the chatbot service on port 8000
uvicorn chatbot.main:app --host 0.0.0.0 --port 8000
```

### Step 2: Start the Flask Frontend

```bash
# In a new terminal
cd /Volumes/HomeX/Chris/Documents/Bible-Gematria-Interlinear-Explorer

# Install Flask dependencies
pip install flask flask-caching flask-cors dataset

# Run the Flask app
python myproject.py
```

### Alternative: Running Both from the Same Project

If you want to run the chatbot directly from this project:

```bash
cd /Volumes/HomeX/Chris/Documents/Bible-Gematria-Interlinear-Explorer

# Install all dependencies
pip install -r requirements.txt

# Set Ollama API key
export OLLAMA_API_KEY="your-api-key-here"

# Terminal 1: Start chatbot
python -c "from chatbot import create_chatbot_app; import uvicorn; uvicorn.run(create_chatbot_app(), host='0.0.0.0', port=8000)"

# Terminal 2: Start Flask
python myproject.py
```

## Features

The chatbot supports:

1. **Deterministic Pattern Matching** (no AI needed):
   - Verse lookups: `"John 3:16"`, `"Genesis 1:1"`
   - Strong's numbers: `"Strong's G26"`, `"H7225"`
   - Scripture study: `"Explain Romans 8:28"`

2. **AI-Powered Responses** (via Ollama deepseek-v4-pro:cloud):
   - Complex theological questions
   - Cross-reference analysis
   - Greek/Hebrew word studies
   - Commentary synthesis

## Troubleshooting

### Chatbot service not available

If you see "Chatbot service unavailable", ensure:
- The chatbot is running on port 8000
- For cloud: The OLLAMA_API_KEY is set
- For local: Ollama app is running

### No AI responses (Local Ollama)

If the chatbot only returns verse lookups but no AI answers:
- Ensure Ollama app is running
- Check that `deepseek-v4-pro:cloud` model is available: `ollama list`
- Pull the model if needed: `ollama pull deepseek-v4-pro:cloud`
- Check Ollama logs for errors

### No AI responses (Ollama Cloud)

- Check that OLLAMA_API_KEY is exported
- Verify the Ollama API URL is correct
- Check logs for API errors

### Frontend widget not loading

- Check browser console for JavaScript errors
- Ensure the chatbot-widget files are in `/static/chatbot-widget/`
- Verify the CSS and JS files are accessible at `/static/chatbot-widget.css` and `/static/chatbot-widget.umd.js`

## API Endpoints

- `POST /api/bible-chat/chat` - Non-streaming chat
- `POST /api/bible-chat/chat/stream` - Streaming chat (SSE)
- `GET /api/bible-chat/verse/{reference}` - Verse lookup
- `GET /api/bible-chat/study/{reference}` - Commentary lookup
- `GET /api/bible-chat/strongs/{query}` - Strong's lookup

## Model Information

- **Provider**: selected by `LLM_PROVIDER` (`nvidia` | `ollama`)
- **Model**: `NVIDIA_MODEL` (default `meta/llama-3.3-70b-instruct`) or
  `OLLAMA_MODEL` (default `deepseek-v4-pro:cloud`)
- **Temperature**: 0.7 (hard-coded in `chatbot/ollama_client.py`)
- **Max Tokens**: 2048
