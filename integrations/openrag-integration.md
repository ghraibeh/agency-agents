# OpenRAG Integration

> Connect the Employee Wiki Assistant — and any other agent — to your company's OpenRAG knowledge base for real-time, document-grounded answers.

## What is OpenRAG

[OpenRAG](https://github.com/linagora/openrag) is an open-source Retrieval-Augmented Generation (RAG) platform by Linagora. It indexes your company documents and exposes a query interface that returns answers grounded in those documents, with source attribution.

Key properties relevant to this integration:

- **OpenAI-compatible API** — works as a drop-in replacement; use the standard `openai` Python client or any OpenAI-compatible library
- **Self-hosted** — your documents never leave your infrastructure
- **Multi-format ingestion** — PDFs, Word documents, text files, images, audio
- **Source attribution** — every answer references the originating document

---

## Quick Start

### 1. Run OpenRAG with Docker Compose

```bash
git clone https://github.com/linagora/openrag.git
cd openrag/quick_start

# Copy and configure the environment file
cp .env.example .env
# Edit .env: set AUTH_TOKEN, LLM model settings, and embedding model

docker compose up -d
```

OpenRAG starts on port `8080` by default. The interactive API docs are available at `http://localhost:8080/docs`.

### 2. Set Environment Variables

Expose the connection details to your agent environment:

```bash
export OPENRAG_BASE_URL="http://localhost:8080/api/v1"
export OPENRAG_API_KEY="your-auth-token-here"   # must match AUTH_TOKEN in OpenRAG .env
```

For production deployments, use your secrets manager (Vault, AWS Secrets Manager, Azure Key Vault) rather than shell exports.

### 3. Index Your Company Documents

Open the OpenRAG indexer UI at `http://localhost:8081` (default port):

1. Drag and drop documents into the upload area — PDFs, `.docx`, `.txt`, images, and audio files are all supported
2. Wait for the indexing progress bar to complete (large PDFs may take a minute)
3. Indexed documents are immediately available for querying

You can also index documents via the REST API:

```bash
curl -X POST http://localhost:8080/api/v1/index \
  -H "Authorization: Bearer $OPENRAG_API_KEY" \
  -F "file=@/path/to/employee-handbook.pdf"
```

---

## Activate the Employee Wiki Assistant

### Claude Code

```bash
# Copy the agent to your Claude Code agents directory
cp support/support-employee-wiki-assistant.md ~/.claude/agents/

# Or install all agents at once
./scripts/install.sh --tool claude-code
```

Then in any Claude Code session:

```
Activate Employee Wiki Assistant.
What is our policy on remote work?
```

### Cursor

```bash
cd /your/project
/path/to/agency-agents/scripts/install.sh --tool cursor
```

The agent is added as a `.cursor/rules/support-employee-wiki-assistant.mdc` file.

### GitHub Copilot

```bash
./scripts/install.sh --tool copilot
```

### All Other Tools

```bash
# Regenerate all integration formats after adding the agent
./scripts/convert.sh

# Then install for your tool
./scripts/install.sh --tool windsurf    # or aider, opencode, etc.
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENRAG_BASE_URL` | Yes | Base URL of your OpenRAG instance, e.g. `http://localhost:8080/api/v1` |
| `OPENRAG_API_KEY` | Yes | Bearer token — must match `AUTH_TOKEN` in OpenRAG's `.env` |
| `OPENRAG_MODEL` | No | Model name for the OpenAI-compatible endpoint. Defaults to `openrag`. Run `GET /api/v1/models` to list available models. |

---

## Verify the Connection

```python
import os
from openai import OpenAI

client = OpenAI(
    base_url=os.environ["OPENRAG_BASE_URL"],
    api_key=os.environ["OPENRAG_API_KEY"],
)

# List available models
models = client.models.list()
print([m.id for m in models.data])

# Test a query
response = client.chat.completions.create(
    model=os.environ.get("OPENRAG_MODEL", "openrag"),
    messages=[{"role": "user", "content": "What documents are indexed?"}],
)
print(response.choices[0].message.content)
```

---

## Security Notes

- **Store credentials in a secrets manager**, not in `.env` files committed to version control. Add `.env` to `.gitignore`.
- **OpenRAG is self-hosted** — company documents are processed and stored entirely within your infrastructure. No data is sent to external services.
- **Restrict indexer access** — the indexer UI should only be accessible to HR/IT administrators responsible for maintaining the knowledge base.
- **Rotate `AUTH_TOKEN` periodically** and update `OPENRAG_API_KEY` in your secrets manager accordingly.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `401 Unauthorized` | Wrong API key | Verify `OPENRAG_API_KEY` matches `AUTH_TOKEN` in OpenRAG `.env` |
| Empty or generic answers | No documents indexed | Upload documents via the indexer UI and wait for indexing to complete |
| `model not found` error | Wrong model name | Run `GET /api/v1/models` and use the returned model ID |
| `Connection refused` | OpenRAG not running | Check `docker compose ps` and confirm the container is up |
| Slow responses | Large document corpus | This is normal for first queries; subsequent queries use cached embeddings |
| Low-quality answers | Query too vague | The agent will rephrase automatically; for manual testing, be more specific |

---

## Related

- [Employee Wiki Assistant agent](../support/support-employee-wiki-assistant.md)
- [Example workflow](../examples/workflow-employee-wiki.md)
- [OpenRAG documentation](https://github.com/linagora/openrag)
