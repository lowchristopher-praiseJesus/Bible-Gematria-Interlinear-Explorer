#!/bin/bash
# Start the Bible Chatbot with Ollama integration

set -e

echo "=== Bible Chatbot Startup Script ==="
echo ""

# Configuration
OLLAMA_API_URL="${OLLAMA_API_URL:-http://localhost:11434}"
OLLAMA_MODEL="${OLLAMA_MODEL:-deepseek-v4-pro:cloud}"

# Check if using cloud (requires API key) or local
if echo "$OLLAMA_API_URL" | grep -q "api.ollama.com" || echo "$OLLAMA_API_URL" | grep -q "^https://"; then
    if [ -z "$OLLAMA_API_KEY" ]; then
        echo "ERROR: Using Ollama Cloud but OLLAMA_API_KEY is not set!"
        echo ""
        echo "Please set your Ollama API key:"
        echo "  export OLLAMA_API_KEY='your-api-key-here'"
        echo ""
        exit 1
    fi
    echo "Mode: Ollama Cloud"
    echo "OLLAMA_API_KEY: [SET]"
else
    echo "Mode: Local Ollama"
    echo "OLLAMA_API_KEY: [optional - not needed for local]"
fi

echo "OLLAMA_MODEL: $OLLAMA_MODEL"
echo "OLLAMA_API_URL: $OLLAMA_API_URL"
echo ""

# Check if uvicorn is installed
if ! command -v uvicorn &> /dev/null; then
    echo "Installing uvicorn..."
    pip install uvicorn[standard] fastapi httpx pydantic
fi

echo "Starting chatbot service on http://localhost:8000"
echo "Press Ctrl+C to stop"
echo ""

# Change to mybibletoolbox-code directory if it exists, otherwise use local chatbot
if [ -d "$HOME/Documents/mybibletoolbox-code" ]; then
    cd "$HOME/Documents/mybibletoolbox-code"
    exec uvicorn chatbot.main:app --host 0.0.0.0 --port 8000 --reload
else
    cd "$(dirname "$0")"
    exec python -c "from chatbot import create_chatbot_app; import uvicorn; uvicorn.run(create_chatbot_app(), host='0.0.0.0', port=8000)"
fi
