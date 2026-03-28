"""
Employee Wiki Assistant — FastAPI backend
Connects to OpenRAG (OpenAI-compatible RAG API) and serves the chat UI.

OpenRAG API reference: https://github.com/linagora/openrag
- Chat completions: POST /v1/chat/completions
  Sources are returned in response.extra.sources (not inside choices[].message)
- Document upload:  POST /indexer/partition/{partition}/file/{file_id}
- Health:           GET  /health_check
- Models:           GET  /v1/models
"""

import os
import uuid
import logging
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
# OPENRAG_BASE_URL should point to the root of OpenRAG (no trailing path).
# The wiki app appends /v1 for OpenAI-compatible endpoints and /indexer for
# document management. Example: http://openrag:8080
OPENRAG_BASE_URL    = os.environ.get("OPENRAG_BASE_URL", "http://openrag:8080").rstrip("/")
OPENRAG_API_KEY     = os.environ.get("OPENRAG_API_KEY", "sk-openrag-1234")
# Model: "openrag-all" queries all partitions; "openrag-{name}" queries one.
OPENRAG_MODEL       = os.environ.get("OPENRAG_MODEL", "openrag-all")
# Partition for document uploads (default partition created at startup)
OPENRAG_PARTITION   = os.environ.get("OPENRAG_PARTITION", "default")
APP_TITLE           = os.environ.get("APP_TITLE", "Employee Wiki Assistant")
APP_PORT            = int(os.environ.get("APP_PORT", "8000"))

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
# Pydantic models
# ---------------------------------------------------------------------------
class ChatMessage(BaseModel):
    role: str       # "user" | "assistant" | "system"
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
def _auth_header() -> dict:
    return {"Authorization": f"Bearer {OPENRAG_API_KEY}"}


def _json_header() -> dict:
    return {**_auth_header(), "Content-Type": "application/json"}


async def query_openrag(messages: list[dict]) -> dict:
    """
    POST /v1/chat/completions to OpenRAG.
    Returns the full raw JSON response (sources are under response["extra"]["sources"]).
    """
    payload = {
        "model": OPENRAG_MODEL,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}] + messages,
        "stream": False,
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            resp = await client.post(
                f"{OPENRAG_BASE_URL}/v1/chat/completions",
                headers=_json_header(),
                json=payload,
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.ConnectError:
            raise HTTPException(
                status_code=503,
                detail=(
                    f"Cannot connect to OpenRAG at {OPENRAG_BASE_URL}. "
                    "Check OPENRAG_BASE_URL and ensure the service is running."
                ),
            )
        except httpx.HTTPStatusError as e:
            raise HTTPException(
                status_code=e.response.status_code,
                detail=f"OpenRAG error: {e.response.text}",
            )


def _extract_sources(raw: dict) -> list[dict]:
    """
    OpenRAG returns source citations in response["extra"]["sources"].
    Each source has: link, file_url, chunk_url, source (filename), metadata, ...

    NOTE: "extra" may be a JSON string in some OpenRAG versions — we parse it
    if needed before reading sources.

    We normalise to a simple {document, section, link} shape for the frontend.
    """
    import json as _json

    sources = []

    # "extra" may be a dict or a JSON-encoded string
    extra = raw.get("extra", {})
    if isinstance(extra, str):
        try:
            extra = _json.loads(extra)
        except Exception:
            extra = {}

    # Primary location: extra.sources (OpenRAG standard)
    # Each source: {source, file_url, chunk_url, _id, metadata: {filename, page, ...}}
    for s in extra.get("sources", []):
        meta = s.get("metadata", {})
        # "source" field holds the original filename; fall back to metadata or chunk_url
        doc_name = (
            s.get("source")                    # e.g. "Employee Handbook.pdf"
            or meta.get("filename")
            or s.get("file_url", "Unknown")
        )
        page = meta.get("page")
        sources.append({
            "document": doc_name,
            "section": f"page {page}" if page else "",
            "link": s.get("chunk_url", s.get("link", "")),
        })

    # Fallback: some OpenRAG versions may put sources inside choices[0].message
    if not sources:
        message = raw.get("choices", [{}])[0].get("message", {})
        for field in ("context", "sources", "references"):
            items = message.get(field, [])
            if items:
                for s in items:
                    if isinstance(s, dict):
                        sources.append({
                            "document": s.get("filename", s.get("document",
                                             s.get("source", s.get("title", "Unknown")))),
                            "section": s.get("section", s.get("chunk", "")),
                            "link": s.get("link", ""),
                        })
                    elif isinstance(s, str):
                        sources.append({"document": s, "section": "", "link": ""})
                break

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
    """
    Health check for this app, plus OpenRAG reachability probe.
    Uses OpenRAG's /health_check endpoint.
    """
    openrag_ok = False
    openrag_error = None
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(
                f"{OPENRAG_BASE_URL}/health_check",
                headers=_auth_header(),
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
    Forwards messages to OpenRAG and returns the answer with source citations.
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
    partition: str = Form(default=""),
):
    """
    Upload a document to OpenRAG for indexing.
    Endpoint: POST /indexer/partition/{partition}/file/{file_id}
    Supported: PDF, DOCX, PPTX, XLS, TXT, MD, PNG, JPG, MP3, MP4, etc.

    Returns immediately with a task ID; indexing happens asynchronously.
    """
    target_partition = partition.strip() or OPENRAG_PARTITION
    # Use filename (stripped of extension) as the file_id key.
    # Replace spaces and special chars with hyphens for a safe URL segment.
    safe_name = "".join(
        c if c.isalnum() or c in "-_." else "-" for c in (file.filename or "upload")
    )
    file_id = f"{safe_name}-{uuid.uuid4().hex[:8]}"

    content_type = file.content_type or "application/octet-stream"
    content = await file.read()

    async with httpx.AsyncClient(timeout=300.0) as client:
        try:
            url = f"{OPENRAG_BASE_URL}/indexer/partition/{target_partition}/file/{file_id}"
            resp = await client.post(
                url,
                headers=_auth_header(),
                files={"file": (file.filename, content, content_type)},
            )
            resp.raise_for_status()
            body = resp.json() if resp.content else {}

            # Poll task status URL if provided
            task_url = body.get("task_url") or body.get("status_url")
            return {
                "status": "queued",
                "filename": file.filename,
                "file_id": file_id,
                "partition": target_partition,
                "task_url": task_url,
                "detail": body,
            }
        except httpx.ConnectError:
            raise HTTPException(status_code=503, detail="Cannot connect to OpenRAG indexer.")
        except httpx.HTTPStatusError as e:
            raise HTTPException(
                status_code=e.response.status_code,
                detail=f"Indexer error ({e.response.status_code}): {e.response.text}",
            )


@app.get("/api/upload/status/{task_id}")
async def upload_status(task_id: str):
    """
    Poll the status of an indexing task.
    OpenRAG task states: QUEUED, RUNNING, SUCCESS, FAILED
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            r = await client.get(
                f"{OPENRAG_BASE_URL}/indexer/task/{task_id}",
                headers=_auth_header(),
            )
            r.raise_for_status()
            return r.json()
        except Exception as e:
            raise HTTPException(status_code=503, detail=str(e))


@app.get("/api/models")
async def list_models():
    """List models available in this OpenRAG instance (GET /v1/models)."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            r = await client.get(
                f"{OPENRAG_BASE_URL}/v1/models",
                headers=_auth_header(),
            )
            r.raise_for_status()
            return r.json()
        except Exception as e:
            raise HTTPException(status_code=503, detail=str(e))


@app.get("/api/partitions")
async def list_partitions():
    """List document partitions (knowledge base collections) available to this token."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            r = await client.get(
                f"{OPENRAG_BASE_URL}/partition/",
                headers=_auth_header(),
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
