"""config.py - loads Shadow's settings.

Two kinds of settings live in two different places:

1. Normal settings (which AI provider, which voice, how long to wait for
   speech...) live in  config.json . It is safe to read, but we still keep it
   out of GitHub because it is YOUR personal setup.

2. SECRET API keys live ONLY in the  .env  file (or in real environment
   variables). They are NEVER written inside the Python code, and the .env
   file is listed in .gitignore so it never gets uploaded to GitHub.
   Anyone who has your key can use your quota, so treat it like a password.
"""

import copy
import json
import os
from pathlib import Path

# python-dotenv reads a ".env" file and puts its lines into os.environ.
# If the library is missing we simply skip it (real env variables still work).
try:
    from dotenv import load_dotenv
except ImportError:          # pragma: no cover - only when the package is absent
    load_dotenv = None

# The project folder = the folder that contains the "shadow" package.
PROJECT_DIR = Path(__file__).resolve().parent.parent

# Default settings. config.json only needs to contain what you want to CHANGE.
DEFAULTS = {
    "assistant_name": "Shadow",
    "user_name": "Boss",

    # Which brains to try, in order. If the first fails (no key, no internet,
    # daily limit reached) Shadow automatically tries the next one.
    "provider_order": ["gemini", "groq", "ollama"],

    # Model names. Each provider has a list: the first model is tried first.
    # (Model names change over time - check each provider's docs page.)
    "gemini_models": ["gemini-flash-lite-latest", "gemini-flash-latest"],
    "groq_models": ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    "ollama_models": ["qwen2.5:3b"],
    "ollama_url": "http://localhost:11434",

    "temperature": 0.3,          # 0 = very predictable, 1 = more creative
    "max_output_tokens": 1024,   # longest reply the brain may write
    "request_timeout": 60,       # seconds to wait for the brain before giving up

    "agent_max_steps": 6,        # max tool calls for one question (stops loops)
    "history_turns": 8,          # how many past messages to send as context

    "city": "Shivamogga",        # default city for the weather tool
    "data_dir": "data",          # where memory, notes and reminders are saved
}


def load_config(path=None):
    """Return a dict with every setting, plus the API keys from .env."""
    config = copy.deepcopy(DEFAULTS)

    # 1) Read the user's config.json (if it exists) and override the defaults.
    path = Path(path) if path else PROJECT_DIR / "config.json"
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            user_settings = json.load(f)
        config.update(user_settings)

    # 2) Read secret keys from .env / environment variables.
    if load_dotenv:
        load_dotenv(PROJECT_DIR / ".env")
    config["gemini_api_key"] = os.getenv("GEMINI_API_KEY", "").strip()
    config["groq_api_key"] = os.getenv("GROQ_API_KEY", "").strip()

    # 3) Make the data folder an absolute path and create it.
    data_dir = Path(config["data_dir"])
    if not data_dir.is_absolute():
        data_dir = PROJECT_DIR / data_dir
    data_dir.mkdir(parents=True, exist_ok=True)
    config["data_dir"] = str(data_dir)
    return config
