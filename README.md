# PDF Select & Translate

A minimal web app for translating selected text from PDF documents.

![Screenshot](data/screenshot.png)

## Features

- 📄 Upload and view PDF documents with text selection
- 🌍 Translate selected text into 11+ languages
- 🧠 Context-aware translation for better accuracy
- ⚡ Fast, powered by Poe's OpenAI-compatible API

## Quick Start

```bash
# Create virtualenv
python -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Set your API key
export POE_API_KEY="your-key-here"

# Run
uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POE_API_KEY` | — | Required. Your Poe API key |
| `POE_MODEL` | `GPT-5.2` | Model to use for translation |
| `POE_BASE_URL` | `https://api.poe.com/v1` | API endpoint |

## License

MIT
