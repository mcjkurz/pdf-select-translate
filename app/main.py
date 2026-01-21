import logging
import os
import re
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from openai import OpenAI
from pydantic import BaseModel, Field

# Configure logging with timestamps
logging.basicConfig(
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    level=logging.INFO,
)

ROOT = Path(__file__).resolve().parent.parent
UPLOADS_DIR = ROOT / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


def _get_env(name: str, default: str | None = None) -> str | None:
    v = os.getenv(name)
    if v is None or v.strip() == "":
        return default
    return v


def _api_client() -> OpenAI:
    api_key = _get_env("API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="Missing API_KEY. Set it in your environment before starting the server.",
        )
    base_url = _get_env("API_ENDPOINT", "https://api.openai.com/v1")
    return OpenAI(api_key=api_key, base_url=base_url)


def _target_language_label(lang: str) -> str:
    """Normalize and validate target language."""
    lang_norm = (lang or "").strip()
    if not lang_norm:
        return "English"
    # Expand common abbreviations
    abbrev = {
        "en": "English", "zh": "Chinese (Simplified)", "es": "Spanish", "fr": "French",
        "de": "German", "ja": "Japanese", "ko": "Korean", "ru": "Russian",
        "pt": "Portuguese", "it": "Italian", "zh-cn": "Chinese (Simplified)",
        "zh-hans": "Chinese (Simplified)", "zh-hant": "Chinese (Traditional)",
    }
    lower = lang_norm.lower()
    if lower in abbrev:
        return abbrev[lower]
    # Accept any language name as-is
    return lang_norm


def _context_chars() -> int:
    raw = _get_env("CONTEXT_CHARS", "240")
    try:
        v = int(raw or "240")
    except ValueError:
        v = 240
    return max(0, min(v, 2000))


def _normalize_whitespace(s: str) -> str:
    """Collapse all whitespace (including newlines) into single spaces."""
    return re.sub(r"\s+", " ", s).strip()


def _count_meaningful_chars(s: str) -> int:
    """Count letters (a-z, A-Z) and CJK characters for validation."""
    count = 0
    for c in s:
        if c.isalpha():
            count += 1
        elif "\u4e00" <= c <= "\u9fff":  # CJK Unified Ideographs
            count += 1
        elif "\u3400" <= c <= "\u4dbf":  # CJK Extension A
            count += 1
    return count


MIN_CHARS_FOR_TRANSLATION = 16


app = FastAPI(title="PDF Select & Translate")


class UploadResponse(BaseModel):
    pdf_id: str
    pdf_url: str


class TranslateRequest(BaseModel):
    selected_text: str = Field(min_length=1)
    target_language: str = Field(description="Target language for translation")
    context_before: str = ""
    context_after: str = ""


class TranslateResponse(BaseModel):
    translation: str


@app.post("/api/upload", response_model=UploadResponse)
async def upload_pdf(file: UploadFile = File(...)) -> UploadResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename.")
    if file.content_type not in {"application/pdf", "application/x-pdf", "application/octet-stream"}:
        raise HTTPException(status_code=400, detail="Please upload a PDF file.")

    data = await file.read()
    if not data or len(data) < 5 or not data.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="Invalid PDF.")

    pdf_id = str(uuid.uuid4())
    out_path = UPLOADS_DIR / f"{pdf_id}.pdf"
    out_path.write_bytes(data)
    return UploadResponse(pdf_id=pdf_id, pdf_url=f"/pdf/{pdf_id}.pdf")


@app.get("/pdf/{pdf_name}")
async def get_pdf(pdf_name: str) -> FileResponse:
    # Expect filenames like "<uuid>.pdf"
    safe = Path(pdf_name).name
    path = UPLOADS_DIR / safe
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="PDF not found.")
    return FileResponse(path, media_type="application/pdf", filename=safe)


@app.post("/api/translate", response_model=TranslateResponse)
async def translate(req: TranslateRequest) -> TranslateResponse:
    target = _target_language_label(req.target_language)
    model = _get_env("MODEL", "gpt-4o-mini") or "gpt-4o-mini"
    ctx_chars = _context_chars()

    # Normalize whitespace for cleaner input to the model
    selected = _normalize_whitespace(req.selected_text)

    # Validate minimum character count
    char_count = _count_meaningful_chars(selected)
    if char_count < MIN_CHARS_FOR_TRANSLATION:
        raise HTTPException(
            status_code=400,
            detail=f"Selection too short ({char_count} chars). Need at least {MIN_CHARS_FOR_TRANSLATION} letters/characters.",
        )
    before = _normalize_whitespace((req.context_before or "")[-ctx_chars:])
    after = _normalize_whitespace((req.context_after or "")[:ctx_chars])

    # Include context for disambiguation, but require output to be ONLY the translation of selected_text.
    system = (
        "You are a precise translation engine.\n"
        f"Translate ONLY the 'Selected text' into {target}.\n"
        "Output ONLY the translation text.\n"
        "Do not include explanations, quotes, commentary, prefixes, or extra lines.\n"
        "Do not translate the surrounding context; it is provided only to disambiguate meaning.\n"
    )

    user = (
        f"Context (before): {before}\n\n"
        f"Selected text: {selected}\n\n"
        f"Context (after): {after}"
    )

    client = _api_client()
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.1,
    )

    text = (resp.choices[0].message.content or "").strip()
    if not text:
        raise HTTPException(status_code=502, detail="Empty translation response.")
    return TranslateResponse(translation=text)


# Serve index.html with cache-busting version
static_dir = ROOT / "static"
_index_html_path = static_dir / "index.html"
_server_start_time = str(int(time.time()))


@app.get("/", response_class=HTMLResponse)
async def serve_index() -> HTMLResponse:
    """Serve index.html with dynamic cache version to bust Cloudflare cache."""
    html = _index_html_path.read_text()
    html = html.replace("{{CACHE_VERSION}}", _server_start_time)
    return HTMLResponse(content=html)


# Register static files last so /api/* and /pdf/* routes take precedence.
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

