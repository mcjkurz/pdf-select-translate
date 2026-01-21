# PDF Select & Translate

A minimal web app for translating selected text from PDF documents.

![Screenshot](data/screenshot.png)

## Features

- Upload and view PDF documents with text selection
- Translate selected text into 11+ languages
- Context-aware translation for better accuracy

## Setup

```bash
# Create virtualenv and install dependencies
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your API_KEY and API_ENDPOINT

# Run
./start.sh
```

Stop the server with `./stop.sh`.

## License

MIT
