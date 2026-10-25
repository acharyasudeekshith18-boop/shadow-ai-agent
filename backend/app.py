"""app.py - optional FastAPI backend for Shadow.

Why have a backend at all? In the browser version each user pastes their own
key. If you want to give the app to people WITHOUT asking for a key, the key
must stay secret on a server: the browser calls /api/chat, and only the server
talks to Gemini. (Never put a key in front-end JavaScript - anyone can read it.)

Run locally:
    cd backend
    pip install -r requirements.txt
    copy .env.example .env      (then paste your keys into .env)
    uvicorn app:app --reload
Open http://127.0.0.1:8000/docs to try the API in your browser.
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from shadow import memory
from shadow.agent import run_agent
from shadow.config import load_config
from shadow.llm import LLMClient, LLMError

config = load_config()
memory.set_store(memory.MemoryStore(str(Path(config["data_dir"]) / "shadow.db")))
brain = LLMClient(config)

app = FastAPI(title="Shadow AI Agent API", version="1.0.0")
# CORS: allow the web app (e.g. GitHub Pages) to call this API from the browser.
app.add_middleware(CORSMiddleware, allow_origins=config.get("allowed_origins", ["*"]),
                   allow_methods=["*"], allow_headers=["*"])


class ChatRequest(BaseModel):
    message: str


@app.get("/api/health")
def health():
    """Quick check that the server is up and which brains are configured."""
    return {"ok": True, "providers": config["provider_order"],
            "gemini_key": bool(config["gemini_api_key"]), "groq_key": bool(config["groq_api_key"])}


@app.post("/api/chat")
def chat(req: ChatRequest):
    """Run the agent on one message and return the answer plus every reasoning step."""
    try:
        answer, steps = run_agent(req.message, brain, config, on_step=lambda s: None)
        return {"answer": answer, "steps": steps, "brain": brain.last_used}
    except LLMError as e:
        return {"answer": f"Sorry, my brain is unreachable right now: {e}", "steps": [], "brain": None}


@app.get("/api/memory")
def get_memory():
    return {"facts": memory.STORE.facts(), "notes": memory.STORE.notes(),
            "reminders": memory.STORE.pending_reminders()}
