"""Shadow backend package - the server version of the Shadow AI agent.

    config.py   -> settings (config.json) and secret keys (.env)
    llm.py      -> talks to the AI brain (Gemini, Groq or Ollama)
    agent.py    -> the ReAct loop: think -> pick tool -> act -> observe -> answer
    memory.py   -> SQLite memory: chat history, facts, notes, reminders
    tools/      -> the actions the agent can take
"""

__version__ = "1.0.0"
