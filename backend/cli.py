"""cli.py - talk to the backend agent in the terminal (good for testing).

    python cli.py
"""
from pathlib import Path

from shadow import memory
from shadow.agent import run_agent
from shadow.config import load_config
from shadow.llm import LLMClient

config = load_config()
memory.set_store(memory.MemoryStore(str(Path(config["data_dir"]) / "shadow.db")))
brain = LLMClient(config)
print("Shadow (terminal). Type 'quit' to exit.")
while True:
    text = input("\nYou: ").strip()
    if text.lower() in ("quit", "exit"):
        break
    if text:
        answer, _ = run_agent(text, brain, config, on_step=lambda s: print("   ", s))
        print(f"Shadow: {answer}   [{brain.last_used}]")
