"""
Employee Wiki Assistant — FastAPI backend
Connects to OpenRAG (OpenAI-compatible RAG API) and serves the chat UI.
"""

import os
import uuid
import logging
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
OPENRAG_BASE_URL = os.environ.get("OPENRAG_BASE_URL", "http://openrag:8080/api/v1").rstrip("/")
OPENRAG_API_KEY  = os.environ.get("OPENRAG_API_KEY", "changeme")
OPENRAG_MODEL    = os.environ.get("OPENRAG_MODEL", "openrag")
APP_TITLE        = os.environ.get("APP_TITLE", "Employee Wiki Assistant")
APP_PORT         = int(os.environ.get("APP_PORT", "8000"))

SYSTEM_PROMPT = os.environ.get(
    "SYSTEM_PROMPT",
    (
        "You are an internal company wiki assistant. "
        "Answer only from the provided company documents. "
        "For every fact you state, cite the source document name. "
        "If the documents do not contain a reliable answer, say so clearly "
        "and suggest who the employee should contact. "
        "Be concise, structured, and use bullet points for procedural answers."
    ),
)

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title=APP_TITLE, version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static files (CSS, JS)
frontend_static = Path(__file__).parent.parent / "frontend" / "static"
if frontend_static.exists():
    app.mount("/static", StaticFiles(directory=str(frontend_static)), name="static")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class ChatMessage(BaseModel):
    role: str  # "user" | "assistant" | "system"
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    answer: str
    sources: list[dict]
    session_id: str


# ---------------------------------------------------------------------------
# OpenRAG client helpers
# ---------------------------------------------------------------------------
def _openrag_headers() -> dict:
    return {
        "Authorization": f"Bearer {OPENRAG_API_KEY}",
        "Content-Type": "application/json",
    }


async def query_openrag(messages: list[dict]) -> dict:
    """Send a chat completion request to OpenRAG and return the raw response."""
    payload = {
        "model": OPENRAG_MODEL,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}] + messages,
        "stream": False,
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            resp = await client.post(
                f"{OPENRAG_BASE_URL}/chat/completions",
                headers=_openrag_headers(),
                json=payload,
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.ConnectError:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Cannot connect to OpenRAG. "
                    f"Check that OPENRAG_BASE_URL={OPENRAG_BASE_URL} is correct "
                    "and the service is running."
                ),
            )
        except httpx.HTTPStatusError as e:
            raise HTTPException(
                status_code=e.response.status_code,
                detail=f"OpenRAG error: {e.response.text}",
            )


def _extract_sources(raw: dict) -> list[dict]:
    """
    Extract source document citations from the OpenRAG response.
    OpenRAG may return sources in different fields depending on version.
    """
    sources = []
    choice = raw.get("choices", [{}])[0]
    message = choice.get("message", {})

    # Try common OpenRAG source fields
    for field in ("context", "sources", "references", "citations"):
        if field in message and message[field]:
            for s in message[field]:
                if isinstance(s, dict):
                    sources.append({
                        "document": s.get("document", s.get("source", s.get("title", "Unknown"))),
                        "section": s.get("section", s.get("chunk", "")),
                        "score": s.get("score", s.get("relevance", None)),
                    })
                elif isinstance(s, str):
                    sources.append({"document": s, "section": "", "score": None})
            break

    # Also check top-level response
    if not sources and "sources" in raw:
        for s in raw["sources"]:
            sources.append({
                "document": s.get("document", s.get("title", "Unknown")),
                "section": s.get("section", ""),
                "score": None,
            })

    return sources


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
async def serve_index():
    """Serve the chat UI."""
    index_path = Path(__file__).parent.parent / "frontend" / "index.html"
    if index_path.exists():
        return HTMLResponse(index_path.read_text())
    return HTMLResponse("<h1>Employee Wiki Assistant</h1><p>Frontend not found.</p>")


@app.get("/health")
async def health():
    """Health check — also verifies OpenRAG reachability."""
    openrag_ok = False
    openrag_error = None
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(
                f"{OPENRAG_BASE_URL}/models",
                headers=_openrag_headers(),
            )
            openrag_ok = r.status_code < 400
    except Exception as e:
        openrag_error = str(e)

    return {
        "status": "ok",
        "openrag": {
            "url": OPENRAG_BASE_URL,
            "reachable": openrag_ok,
            "error": openrag_error,
        },
    }


@app.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """
    Main chat endpoint.
    Accepts a list of messages and returns an answer with source citations.
    """
    if not req.messages:
        raise HTTPException(status_code=400, detail="messages cannot be empty")

    messages = [{"role": m.role, "content": m.content} for m in req.messages]
    raw = await query_openrag(messages)

    answer = raw.get("choices", [{}])[0].get("message", {}).get("content", "")
    if not answer:
        answer = "I was unable to retrieve an answer. Please try rephrasing your question."

    sources = _extract_sources(raw)
    session_id = req.session_id or str(uuid.uuid4())

    log.info("chat session=%s sources=%d", session_id, len(sources))
    return ChatResponse(answer=answer, sources=sources, session_id=session_id)


@app.post("/api/upload")
async def upload_document(
    file: UploadFile = File(...),
    description: str = Form(default=""),
):
    """
    Upload a document to OpenRAG for indexing.
    Supported formats: PDF, DOCX, TXT, MD, PNG, JPG, MP3, MP4, etc.
    """
    allowed_types = {
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
        "text/markdown",
        "image/png",
        "image/jpeg",
        "audio/mpeg",
        "audio/mp4",
    }

    content_type = file.content_type or "application/octet-stream"
    # Be lenient — OpenRAG handles format detection
    content = await file.read()

    async with httpx.AsyncClient(timeout=300.0) as client:
        try:
            resp = await client.post(
                f"{OPENRAG_BASE_URL}/index",
                headers={"Authorization": f"Bearer {OPENRAG_API_KEY}"},
                files={"file": (file.filename, content, content_type)},
                data={"description": description} if description else {},
            )
            if resp.status_code == 404:
                # Try alternative indexer endpoint
                resp = await client.post(
                    f"{OPENRAG_BASE_URL}/upload",
                    headers={"Authorization": f"Bearer {OPENRAG_API_KEY}"},
                    files={"file": (file.filename, content, content_type)},
                )
            resp.raise_for_status()
            return {"status": "indexed", "filename": file.filename, "detail": resp.json()}
        except httpx.ConnectError:
            raise HTTPException(status_code=503, detail="Cannot connect to OpenRAG indexer.")
        except httpx.HTTPStatusError as e:
            raise HTTPException(
                status_code=e.response.status_code,
                detail=f"Indexer error: {e.response.text}",
            )


@app.get("/api/models")
async def list_models():
    """List models available in this OpenRAG instance."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            r = await client.get(
                f"{OPENRAG_BASE_URL}/models",
                headers=_openrag_headers(),
            )
            r.raise_for_status()
            return r.json()
        except Exception as e:
            raise HTTPException(status_code=503, detail=str(e))


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=APP_PORT, reload=False)
