"""agent.py - the ReAct agent loop (server version, PROMPT-BASED function calling).

The browser version uses Gemini's *native* function calling. This server
version shows the other classic way, which works with ANY model (even tiny
local ones): we describe the tools in the prompt and ask the model to reply
in a fixed JSON format.

    To use a tool:   {"thought": "...", "action": "get_weather", "action_input": {"city": "Mysuru"}}
    To answer:       {"thought": "...", "final_answer": "It is 27 degrees in Mysuru."}

Loop:  THINK (model writes JSON) -> ACT (we run the tool) -> OBSERVE (we send
the result back as "Observation: ...") -> repeat until "final_answer".
"""

import datetime
import json

from shadow import memory
from shadow.tools import describe_tools, run_tool

PROMPT = """You are {name}, a personal AI assistant agent for {user}. Be calm, smart and a little witty.
Today is {now}. The user's home city is {city}.

You can use these tools:
{tools}

ALWAYS reply with ONE JSON object and nothing else, in one of these two forms:
1) To use a tool:
   {{"thought": "why I need the tool", "action": "<tool name>", "action_input": {{...inputs...}}}}
2) To give the final answer:
   {{"thought": "I have what I need", "final_answer": "<your answer to the user>"}}

Rules: use the calculator for any maths; use a tool for live facts instead of guessing;
after each tool you will get an Observation - read it, then decide the next step;
if the user says "remember", use remember_fact. Final answers are spoken aloud:
short, natural sentences, no markdown.

{facts}"""


def parse_json_reply(text):
    """Find the first JSON object in the model's reply (models sometimes add
    extra words or ```json fences around it). Returns a dict or None."""
    text = text.strip().replace("```json", "").replace("```", "")
    decoder = json.JSONDecoder()
    for i, ch in enumerate(text):
        if ch == "{":
            try:
                obj, _ = decoder.raw_decode(text[i:])
                if isinstance(obj, dict):
                    return obj
            except json.JSONDecodeError:
                continue
    return None


def run_agent(user_text, brain, config, on_step=print):
    """Answer one message. Returns (answer, steps) where steps is the reasoning trace."""
    store = memory.STORE
    facts = store.facts()
    system = PROMPT.format(
        name=config["assistant_name"], user=config["user_name"], city=config["city"],
        now=datetime.datetime.now().strftime("%A %d %B %Y, %I:%M %p"),
        tools=describe_tools(),
        facts=("Facts you know about the user:\n- " + "\n- ".join(facts)) if facts else "",
    )
    # Short-term memory first, then the new message.
    messages = [{"role": "system", "content": system}]
    for h in store.recent_history(config["history_turns"]):
        messages.append({"role": h["role"], "content": h["text"]})
    messages.append({"role": "user", "content": user_text})

    steps = []

    def log(kind, value):
        steps.append({"type": kind, "value": value})
        on_step(f"{kind.upper():<12}{value}")

    answer = None
    for _ in range(config["agent_max_steps"]):
        reply = brain.chat(messages, json_mode=True)          # THINK
        messages.append({"role": "assistant", "content": reply})
        data = parse_json_reply(reply)
        if data is None:                                      # not JSON: treat as the answer
            answer = reply.strip()
            break
        if data.get("thought"):
            log("thought", data["thought"])
        if "final_answer" in data:                            # ANSWER
            answer = str(data["final_answer"])
            break
        tool_name = data.get("action")
        tool_input = data.get("action_input") or {}
        if not tool_name or str(tool_name).lower() in ("none", "null"):
            # Small models sometimes write a thought but no action and no answer.
            # Nudge them back into the format instead of running a "None" tool.
            messages.append({"role": "user", "content": 'No tool needed? Then reply now as {"final_answer": "..."}.'})
            continue
        log("action", f"{tool_name}({json.dumps(tool_input)})")
        observation = run_tool(tool_name, tool_input)         # ACT
        log("observation", observation[:300])
        messages.append({"role": "user", "content": f"Observation: {observation}"})   # OBSERVE
    if answer is None:
        answer = "Sorry, I needed too many steps for that one. Can you ask it more simply?"

    store.add_history("user", user_text)
    store.add_history("assistant", answer)
    log("answer", answer)
    return answer, steps
