"""LIVE end-to-end run of the backend agent with a local Ollama model (no key).
    ollama pull qwen2.5:3b
    python tests/live_ollama.py
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from shadow import memory                     # noqa: E402
from shadow.agent import run_agent            # noqa: E402
from shadow.config import load_config         # noqa: E402
from shadow.llm import LLMClient              # noqa: E402

config = load_config()
config["provider_order"] = ["ollama"]
memory.set_store(memory.MemoryStore(str(Path(tempfile.mkdtemp()) / "live.db")))
brain = LLMClient(config)
for q in ["What is the weather in Mysuru?", "What is 15% of 2400?", "Remember that my favourite food is masala dosa.", "What is my favourite food?"]:
    print("\nUSER:", q)
    answer, _ = run_agent(q, brain, config, on_step=lambda s: print("   ", s[:170]))
    print("SHADOW:", answer)
