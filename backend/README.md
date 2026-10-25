# Shadow backend (optional) – Python + FastAPI

The main Shadow app runs completely in the browser. This folder is an **optional server version**
of the same agent, useful when:
- you want to hide one API key on a server (users don't need their own key), or
- your report/viva needs a client–server architecture.

It uses **prompt-based function calling** (the model replies in a JSON format), which works with
any model, including small local ones through Ollama.

```
backend/
  app.py              FastAPI server: /api/chat, /api/health, /api/memory
  cli.py              chat with the agent in the terminal
  shadow/config.py    settings (config.json) + keys (.env)
  shadow/llm.py       Gemini / Groq / Ollama over plain HTTP, with fallback + retry
  shadow/agent.py     the ReAct loop (JSON thought/action/observation)
  shadow/memory.py    SQLite memory: history, facts, notes, reminders
  shadow/tools/       calculator, time, system info, weather, Wikipedia, DuckDuckGo, notes, memory
  tests/              pytest tests with a fake brain
```

## Run it locally
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate            # Windows   (Linux/Mac: source .venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env             # Linux/Mac: cp .env.example .env   -> paste your keys
copy config.example.json config.json
pytest -q                          # 11 tests
uvicorn app:app --reload           # open http://127.0.0.1:8000/docs
```

## Deploy free (needs your own account)
- **Render.com** (free web service): New → Web Service → connect this repo → Root directory `backend` →
  Build `pip install -r requirements.txt` → Start `uvicorn app:app --host 0.0.0.0 --port $PORT` →
  add `GEMINI_API_KEY` under Environment. Free services sleep when idle (first request is slow).
- **Hugging Face Spaces** (Docker Space): same start command on port 7860.

Keys go in the host's **Environment variables** settings, never in the code.
