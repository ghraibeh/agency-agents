/**
 * Employee Wiki Assistant — Frontend
 * Manages chat sessions, message rendering, and document upload.
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  sessions: JSON.parse(localStorage.getItem("wiki_sessions") || "[]"),
  currentId: null,
  messages: [],  // [{role, content}]
  loading: false,
};

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const messagesEl    = document.getElementById("messages");
const inputForm     = document.getElementById("inputForm");
const questionInput = document.getElementById("questionInput");
const sendBtn       = document.getElementById("sendBtn");
const newChatBtn    = document.getElementById("newChatBtn");
const chatHistoryEl = document.getElementById("chatHistory");
const statusDot     = document.getElementById("statusDot");
const topbarTitle   = document.getElementById("topbarTitle");
const uploadModal   = document.getElementById("uploadModal");
const openUploadBtn = document.getElementById("openUploadBtn");
const closeUploadBtn = document.getElementById("closeUploadBtn");
const dropZone      = document.getElementById("dropZone");
const fileInput     = document.getElementById("fileInput");
const uploadProgress = document.getElementById("uploadProgress");
const progressFill  = document.getElementById("progressFill");
const progressLabel = document.getElementById("progressLabel");
const uploadResults = document.getElementById("uploadResults");
const sidebar       = document.getElementById("sidebar");
const sidebarOpen   = document.getElementById("sidebarOpen");
const sidebarClose  = document.getElementById("sidebarClose");

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
async function checkHealth() {
  try {
    const r = await fetch("/health");
    const data = await r.json();
    if (data.openrag?.reachable) {
      statusDot.className = "status-dot ok";
      statusDot.title = `OpenRAG connected: ${data.openrag.url}`;
    } else {
      statusDot.className = "status-dot err";
      statusDot.title = `OpenRAG unreachable: ${data.openrag?.error || "unknown error"}`;
    }
  } catch {
    statusDot.className = "status-dot err";
    statusDot.title = "Backend unreachable";
  }
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------
function saveSession() {
  const idx = state.sessions.findIndex(s => s.id === state.currentId);
  if (idx >= 0) {
    state.sessions[idx].messages = state.messages;
    state.sessions[idx].title = getSessionTitle();
  }
  localStorage.setItem("wiki_sessions", JSON.stringify(state.sessions));
}

function getSessionTitle() {
  const first = state.messages.find(m => m.role === "user");
  if (!first) return "New conversation";
  return first.content.slice(0, 48) + (first.content.length > 48 ? "…" : "");
}

function newSession() {
  const id = "s_" + Date.now();
  state.currentId = id;
  state.messages = [];
  state.sessions.unshift({ id, title: "New conversation", messages: [] });
  localStorage.setItem("wiki_sessions", JSON.stringify(state.sessions));
  renderHistory();
  renderMessages();
  topbarTitle.textContent = "Employee Wiki Assistant";
  questionInput.focus();
}

function loadSession(id) {
  const s = state.sessions.find(s => s.id === id);
  if (!s) return;
  state.currentId = id;
  state.messages = s.messages || [];
  renderHistory();
  renderMessages();
  topbarTitle.textContent = s.title;
  // Scroll to bottom
  requestAnimationFrame(() => messagesEl.scrollTop = messagesEl.scrollHeight);
}

function renderHistory() {
  chatHistoryEl.innerHTML = "";
  state.sessions.forEach(s => {
    const el = document.createElement("div");
    el.className = "history-item" + (s.id === state.currentId ? " active" : "");
    el.textContent = s.title;
    el.addEventListener("click", () => loadSession(s.id));
    chatHistoryEl.appendChild(el);
  });
}

// ---------------------------------------------------------------------------
// Message rendering
// ---------------------------------------------------------------------------
function renderMessages() {
  messagesEl.innerHTML = "";
  if (state.messages.length === 0) {
    messagesEl.innerHTML = `
      <div class="welcome">
        <div class="welcome-icon">📚</div>
        <h2>Employee Wiki Assistant</h2>
        <p>Ask anything about company policies, IT setup, HR procedures, onboarding, and more.</p>
        <div class="suggestions">
          <button class="suggestion" data-q="What is our vacation policy?">Vacation policy</button>
          <button class="suggestion" data-q="How do I set up VPN on my laptop?">VPN setup</button>
          <button class="suggestion" data-q="What are the steps for expense reimbursement?">Expense reimbursement</button>
          <button class="suggestion" data-q="What mandatory training do I need to complete?">Mandatory training</button>
        </div>
      </div>`;
    bindSuggestions();
    return;
  }
  state.messages.forEach(m => {
    if (m.role === "user") appendUserMessage(m.content);
    else if (m.role === "assistant") appendBotMessage(m.content, m.sources || []);
  });
}

function bindSuggestions() {
  document.querySelectorAll(".suggestion").forEach(btn => {
    btn.addEventListener("click", () => {
      questionInput.value = btn.dataset.q;
      submitQuestion(btn.dataset.q);
    });
  });
}

function appendUserMessage(text) {
  const el = document.createElement("div");
  el.className = "message user";
  el.innerHTML = `
    <div class="message-avatar">👤</div>
    <div class="message-body">
      <div class="message-bubble">${escapeHtml(text)}</div>
    </div>`;
  messagesEl.appendChild(el);
  return el;
}

function appendBotMessage(text, sources = []) {
  const el = document.createElement("div");
  el.className = "message bot";

  const sourcesHtml = sources.length ? `
    <div class="sources">
      <div class="sources-label">Sources</div>
      ${sources.map(s => `
        <div class="source-item">
          <span class="source-doc">${escapeHtml(s.document || "Unknown")}</span>
          ${s.section ? `<span class="source-section">— ${escapeHtml(s.section)}</span>` : ""}
        </div>`).join("")}
    </div>` : "";

  el.innerHTML = `
    <div class="message-avatar">📚</div>
    <div class="message-body">
      <div class="message-bubble">${renderMarkdown(text)}</div>
      ${sourcesHtml}
    </div>`;
  messagesEl.appendChild(el);
  return el;
}

function appendTypingIndicator() {
  const el = document.createElement("div");
  el.className = "message bot typing-wrapper";
  el.id = "typing";
  el.innerHTML = `
    <div class="message-avatar">📚</div>
    <div class="message-body">
      <div class="message-bubble typing">
        <span class="dot"></span><span class="dot"></span><span class="dot"></span>
      </div>
    </div>`;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

function removeTypingIndicator() {
  document.getElementById("typing")?.remove();
}

// ---------------------------------------------------------------------------
// Minimal markdown renderer
// ---------------------------------------------------------------------------
function renderMarkdown(text) {
  // Escape HTML first
  let html = escapeHtml(text);
  // Code blocks
  html = html.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, c) =>
    `<pre><code>${c.trim()}</code></pre>`);
  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // Headers (##, ###)
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm,  "<h2>$1</h2>");
  // Unordered lists
  html = html.replace(/^[-*] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, s => `<ul>${s}</ul>`);
  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
  // Horizontal rule
  html = html.replace(/^---+$/gm, "<hr>");
  // Paragraphs (blank lines)
  html = html.replace(/\n{2,}/g, "</p><p>");
  html = `<p>${html}</p>`;
  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, "");
  html = html.replace(/<p>(<[uh][l23r])/g, "$1");
  html = html.replace(/(<\/[uh][l23r]>)<\/p>/g, "$1");
  return html;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Chat API
// ---------------------------------------------------------------------------
async function submitQuestion(question) {
  if (state.loading || !question.trim()) return;

  // Ensure we have a session
  if (!state.currentId) newSession();
  else if (state.messages.length === 0) renderMessages();

  // Hide welcome screen if visible
  const welcome = messagesEl.querySelector(".welcome");
  if (welcome) welcome.remove();

  state.loading = true;
  sendBtn.disabled = true;
  questionInput.value = "";
  questionInput.style.height = "auto";

  // Add user message to state and DOM
  state.messages.push({ role: "user", content: question });
  appendUserMessage(question);
  const typingEl = appendTypingIndicator();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: state.messages.map(m => ({ role: m.role, content: m.content })),
        session_id: state.currentId,
      }),
    });

    removeTypingIndicator();

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      const errMsg = err.detail || "An error occurred.";
      const errEl = document.createElement("div");
      errEl.className = "message error";
      errEl.innerHTML = `
        <div class="message-avatar">⚠</div>
        <div class="message-body">
          <div class="message-bubble">${escapeHtml(errMsg)}</div>
        </div>`;
      messagesEl.appendChild(errEl);
    } else {
      const data = await res.json();
      state.messages.push({ role: "assistant", content: data.answer, sources: data.sources });
      appendBotMessage(data.answer, data.sources);
    }
  } catch (e) {
    removeTypingIndicator();
    const errEl = document.createElement("div");
    errEl.className = "message error";
    errEl.innerHTML = `
      <div class="message-avatar">⚠</div>
      <div class="message-body">
        <div class="message-bubble">Network error: ${escapeHtml(e.message)}</div>
      </div>`;
    messagesEl.appendChild(errEl);
  }

  messagesEl.scrollTop = messagesEl.scrollHeight;
  state.loading = false;
  sendBtn.disabled = false;
  questionInput.focus();
  saveSession();
  renderHistory();
  topbarTitle.textContent = getSessionTitle();
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------
async function uploadFile(file) {
  const formData = new FormData();
  formData.append("file", file);

  const resultEl = document.createElement("div");
  resultEl.className = "upload-result-item";
  resultEl.innerHTML = `<span class="upload-result-icon">⏳</span> ${escapeHtml(file.name)}`;
  uploadResults.appendChild(resultEl);

  try {
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    if (res.ok) {
      resultEl.innerHTML = `<span class="upload-result-icon">✅</span> ${escapeHtml(file.name)} — indexed`;
    } else {
      const err = await res.json().catch(() => ({ detail: "Upload failed" }));
      resultEl.innerHTML = `<span class="upload-result-icon">❌</span> ${escapeHtml(file.name)} — ${escapeHtml(err.detail)}`;
    }
  } catch (e) {
    resultEl.innerHTML = `<span class="upload-result-icon">❌</span> ${escapeHtml(file.name)} — ${escapeHtml(e.message)}`;
  }
}

async function handleFiles(files) {
  if (!files.length) return;
  uploadProgress.hidden = false;
  uploadResults.innerHTML = "";
  progressFill.style.width = "0%";
  progressLabel.textContent = `Uploading ${files.length} file(s)…`;

  for (let i = 0; i < files.length; i++) {
    progressFill.style.width = `${((i + 1) / files.length) * 100}%`;
    progressLabel.textContent = `Uploading ${files[i].name}…`;
    await uploadFile(files[i]);
  }

  progressFill.style.width = "100%";
  progressLabel.textContent = "Done.";
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------
inputForm.addEventListener("submit", e => {
  e.preventDefault();
  submitQuestion(questionInput.value);
});

questionInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submitQuestion(questionInput.value);
  }
});

// Auto-resize textarea
questionInput.addEventListener("input", () => {
  questionInput.style.height = "auto";
  questionInput.style.height = Math.min(questionInput.scrollHeight, 160) + "px";
});

newChatBtn.addEventListener("click", newSession);

openUploadBtn.addEventListener("click", () => {
  uploadModal.hidden = false;
  uploadResults.innerHTML = "";
  uploadProgress.hidden = true;
});
closeUploadBtn.addEventListener("click", () => { uploadModal.hidden = true; });
uploadModal.addEventListener("click", e => {
  if (e.target === uploadModal) uploadModal.hidden = true;
});

dropZone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => handleFiles(Array.from(fileInput.files)));

dropZone.addEventListener("dragover", e => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", e => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  handleFiles(Array.from(e.dataTransfer.files));
});

// Sidebar mobile toggle
sidebarOpen.addEventListener("click",  () => sidebar.classList.add("open"));
sidebarClose.addEventListener("click", () => sidebar.classList.remove("open"));

// Suggestion chips (initial render)
bindSuggestions();

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
checkHealth();
setInterval(checkHealth, 30_000);

if (state.sessions.length > 0) {
  loadSession(state.sessions[0].id);
} else {
  newSession();
}
