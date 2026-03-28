"""
Mock OpenRAG Server — for local demo / testing without a real LLM backend.

Implements the OpenRAG API surface used by the wiki app:
  GET  /health_check
  GET  /v1/models
  POST /v1/chat/completions
  POST /indexer/partition/{partition}/file/{file_id}
  GET  /indexer/task/{task_id}
  GET  /partition/

Answers are generated from a small built-in knowledge base.
Run alongside the wiki app to see the full system working locally.
"""

import json
import re
import uuid
import time
from fastapi import FastAPI, Header, HTTPException, UploadFile, File, Path
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional

app = FastAPI(title="Mock OpenRAG", version="1.0.0-mock")

# ---------------------------------------------------------------------------
# Simulated company knowledge base
# ---------------------------------------------------------------------------
KNOWLEDGE_BASE = [
    {
        "source": "Employee Handbook 2025.pdf",
        "page": 34,
        "keywords": ["vacation", "pto", "paid time off", "annual leave", "days off", "holiday"],
        "content": (
            "Employees receive 15 days of paid vacation per year, accruing at 1.25 days per month "
            "starting from the hire date. There is no waiting period — days accrue from day one. "
            "Up to 5 unused vacation days roll over to the following year. Days above the 5-day "
            "rollover cap are forfeited on December 31. Submit vacation requests in the HR portal "
            "at least 5 business days in advance for absences of 3 days or fewer, and at least "
            "2 weeks in advance for longer periods."
        ),
    },
    {
        "source": "IT Onboarding Guide v3.2.pdf",
        "page": 5,
        "keywords": ["vpn", "laptop", "setup", "onboarding", "first day", "device", "computer", "macbook"],
        "content": (
            "Day 1 Laptop Setup: (1) Power on your laptop and connect to CorpNet-5G using your "
            "employee credentials (format: firstname.lastname@company.com). (2) Open System "
            "Preferences → Security and enable FileVault full-disk encryption. (3) Download and "
            "install the VPN client from https://vpn.company.internal/download. (4) Connect to "
            "the VPN using your employee credentials and the MFA code from your authenticator app. "
            "If you get stuck, contact IT Helpdesk at helpdesk@company.com or Slack #it-support."
        ),
    },
    {
        "source": "IT Security Policy SEC-003.pdf",
        "page": 12,
        "keywords": ["phishing", "email", "suspicious", "click", "link", "scam", "fraud", "social engineering"],
        "content": (
            "Phishing and Social Engineering: The company will NEVER ask you to verify your "
            "credentials via an unsolicited email link. If you receive a suspicious email: "
            "(1) Do not click any links. (2) Forward the email as an attachment to "
            "security@company.com. (3) Notify IT via Slack #security-incidents. "
            "If you already clicked a link, report it immediately regardless — the IT Security "
            "team can check for compromise and reset credentials within 2 hours. "
            "IT Security hotline: +1-800-555-0100 (24/7)."
        ),
    },
    {
        "source": "2025 Benefits Guide.pdf",
        "page": 8,
        "keywords": ["health", "insurance", "benefits", "medical", "enrollment", "hmo", "ppo", "premium"],
        "content": (
            "Health Insurance Options: Three plans are available. "
            "Plan A (Essential HMO): $85/month employee premium, $1,500 deductible. "
            "Plan B (Standard PPO): $145/month, $750 deductible. "
            "Plan C (Premium PPO): $210/month, $250 deductible. "
            "The company covers 70% of the premium for all plans. "
            "New employees must enroll within 30 days of hire date — missing this window "
            "means waiting until November open enrollment. Enroll via the Benefits Portal "
            "on the HR intranet."
        ),
    },
    {
        "source": "Finance Policy FIN-007.pdf",
        "page": 3,
        "keywords": ["expense", "reimbursement", "receipt", "travel", "spend", "purchase", "claim"],
        "content": (
            "Expense Reimbursement: Submit expense reports within 30 days of incurring the expense. "
            "Required: itemized receipt for any single expense over $25. "
            "Per diem limits: meals $60/day domestic, $90/day international; "
            "accommodation $200/night domestic, $300/night international. "
            "Submit via the Expenses module in the HR portal. Manager approval required for "
            "amounts over $500. Finance processes approved claims within 5 business days."
        ),
    },
    {
        "source": "New Employee Checklist 2025.pdf",
        "page": 1,
        "keywords": ["first day", "checklist", "new employee", "start", "onboarding", "week 1", "begin"],
        "content": (
            "First Day Checklist: (1) Complete HR paperwork in the HR portal — tax forms, "
            "emergency contact, direct deposit. Deadline: end of day 1. "
            "(2) Set up laptop — install VPN, enable encryption, connect to CorpNet. "
            "(3) Request system access — submit IT access form for tools your manager listed. "
            "(4) Complete mandatory training — Security Awareness and Data Privacy modules "
            "must be done within your first 5 business days (access via the LMS). "
            "(5) Review Employee Handbook sections 2 (Code of Conduct) and 5 (Benefits)."
        ),
    },
    {
        "source": "Remote Work Policy RW-002.pdf",
        "page": 7,
        "keywords": ["remote", "work from home", "wfh", "flexible", "hybrid", "office", "home"],
        "content": (
            "Remote Work Policy: Employees may work remotely up to 3 days per week with manager "
            "approval. Full remote arrangements require VP-level approval and must be reviewed "
            "quarterly. Working remotely from another country for more than 14 consecutive days "
            "requires HR and Legal approval due to tax and employment law implications. "
            "Employees are responsible for maintaining a secure workspace and reliable internet "
            "connection. The company provides a one-time $500 home office equipment allowance."
        ),
    },
    {
        "source": "HR Policy PTO-002.pdf",
        "page": 2,
        "keywords": ["parental", "maternity", "paternity", "leave", "baby", "child", "birth", "adoption"],
        "content": (
            "Parental Leave: Primary caregivers receive 16 weeks of fully paid parental leave. "
            "Secondary caregivers receive 4 weeks of fully paid leave. Leave may begin up to "
            "4 weeks before the expected birth/adoption date. Benefits (health insurance, "
            "retirement contributions) continue during leave. Notify HR at least 30 days before "
            "intended leave start date. Leave may be taken in one continuous block or in two "
            "separate periods within 12 months of the qualifying event."
        ),
    },
]


def _find_relevant_docs(question: str) -> list[dict]:
    """Simple keyword-based retrieval from the knowledge base."""
    q = question.lower()
    scored = []
    for doc in KNOWLEDGE_BASE:
        score = sum(1 for kw in doc["keywords"] if kw in q)
        if score > 0:
            scored.append((score, doc))
    scored.sort(key=lambda x: -x[0])
    return [d for _, d in scored[:3]]


def _generate_answer(question: str, docs: list[dict]) -> str:
    """Generate a wiki-style answer from retrieved documents."""
    if not docs:
        return (
            "I wasn't able to find a relevant policy or procedure in the knowledge base "
            "for your question.\n\n"
            "**Next steps:** Please contact the relevant team directly:\n"
            "- HR questions: hr@company.com\n"
            "- IT questions: helpdesk@company.com or Slack #it-support\n"
            "- Finance questions: finance@company.com"
        )

    doc = docs[0]
    answer = f"## Answer\n\n{doc['content']}\n\n"

    if len(docs) > 1:
        answer += "## Related Information\n\n"
        for related in docs[1:]:
            answer += f"**{related['source']}** also covers related information.\n\n"

    answer += "## Sources\n"
    for d in docs:
        page = f", p. {d['page']}" if d.get("page") else ""
        answer += f"- **{d['source']}**{page}\n"

    return answer


# ---------------------------------------------------------------------------
# In-memory task store for upload simulation
# ---------------------------------------------------------------------------
TASKS: dict[str, dict] = {}
INDEXED_FILES: list[dict] = []


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    model: Optional[str] = "openrag-all"
    messages: list[ChatMessage]
    stream: Optional[bool] = False
    temperature: Optional[float] = 0.3


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/health_check")
def health_check():
    return {"status": "ok", "version": "mock"}


@app.get("/version")
def version():
    return {"version": "mock-1.0.0"}


@app.get("/v1/models")
def list_models():
    return {
        "object": "list",
        "data": [
            {"id": "openrag-all",     "object": "model", "created": int(time.time()), "owned_by": "OpenRAG"},
            {"id": "openrag-default", "object": "model", "created": int(time.time()), "owned_by": "OpenRAG"},
        ],
    }


@app.post("/v1/chat/completions")
async def chat_completions(req: ChatRequest):
    # Extract last user message
    user_msgs = [m for m in req.messages if m.role == "user"]
    question = user_msgs[-1].content if user_msgs else ""

    docs = _find_relevant_docs(question)
    answer = _generate_answer(question, docs)

    # Build sources in OpenRAG format
    sources = [
        {
            "source": d["source"],
            "file_url": f"/files/{d['source'].replace(' ', '_')}",
            "chunk_url": f"/extract/{uuid.uuid4().hex[:8]}",
            "_id": uuid.uuid4().hex[:12],
            "metadata": {
                "filename": d["source"],
                "page": d.get("page", 1),
            },
        }
        for d in docs
    ]

    return {
        "model": req.model or "openrag-all",
        "choices": [
            {
                "message": {"role": "assistant", "content": answer},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": len(question.split()) * 2,
            "completion_tokens": len(answer.split()),
            "total_tokens": len(question.split()) * 2 + len(answer.split()),
        },
        # extra as dict (wiki app handles both dict and string)
        "extra": {"sources": sources},
    }


@app.post("/indexer/partition/{partition}/file/{file_id}")
async def upload_file(
    partition: str = Path(...),
    file_id: str = Path(...),
    file: UploadFile = File(...),
):
    task_id = uuid.uuid4().hex
    content = await file.read()
    TASKS[task_id] = {
        "status": "SUCCESS",
        "task_id": task_id,
        "file_id": file_id,
        "partition": partition,
        "filename": file.filename,
        "size": len(content),
    }
    INDEXED_FILES.append({"filename": file.filename, "partition": partition, "file_id": file_id})
    return JSONResponse(
        status_code=201,
        content={
            "task_id": task_id,
            "task_url": f"/indexer/task/{task_id}",
            "status": "QUEUED",
        },
    )


@app.get("/indexer/task/{task_id}")
def task_status(task_id: str):
    task = TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.get("/partition/")
def list_partitions():
    return [{"name": "default", "owner": "admin", "files": len(INDEXED_FILES)}]


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("mock_openrag:app", host="0.0.0.0", port=8080, reload=False)
