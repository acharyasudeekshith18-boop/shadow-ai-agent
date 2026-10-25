"""tools/ - the HANDS of the agent.

A "tool" is just a normal Python function that the AI is allowed to call.
The AI cannot run code by itself; it can only WRITE the name of a tool and
the inputs it wants. OUR program then runs the real function and gives the
result back to the AI. That is the whole secret of "function calling".

Every tool is registered with the  @tool  decorator, which stores:
    * name         - what the AI writes to call it  (e.g. "get_weather")
    * description  - tells the AI WHEN to use it
    * params       - the inputs it takes, with a short explanation each
"""

import inspect

# The registry: tool name -> {"func", "description", "params"}
TOOLS = {}


def tool(name, description, params=None):
    """Decorator that adds a function to the TOOLS registry.

    Example:
        @tool("get_time", "Tells the current time and date")
        def get_time():
            ...
    """
    def register(func):
        TOOLS[name] = {"func": func, "description": description, "params": params or {}}
        return func
    return register


def describe_tools():
    """Make the text "menu" of tools that we paste into the AI's instructions."""
    lines = []
    for name, info in TOOLS.items():
        if info["params"]:
            args = ", ".join(f'"{p}": {d}' for p, d in info["params"].items())
            lines.append(f"- {name}: {info['description']}  Inputs: {{{args}}}")
        else:
            lines.append(f"- {name}: {info['description']}  Inputs: {{}}")
    return "\n".join(lines)


def run_tool(name, args):
    """Run a tool by name and ALWAYS return a string (never crash the agent).

    The AI sometimes invents tools or inputs, so we check everything:
      * unknown tool       -> tell the AI which tools exist
      * extra/unknown args -> ignored
      * any exception      -> turned into an "ERROR: ..." message the AI can read
    """
    if name not in TOOLS:
        return f"ERROR: there is no tool called '{name}'. Available tools: {', '.join(TOOLS)}"
    func = TOOLS[name]["func"]
    if not isinstance(args, dict):
        args = {}
    # Keep only the arguments the Python function really accepts.
    accepted = inspect.signature(func).parameters
    clean_args = {k: v for k, v in args.items() if k in accepted}
    try:
        result = func(**clean_args)
    except TypeError as e:            # a required input is missing
        return f"ERROR: wrong inputs for {name}: {e}"
    except Exception as e:            # network down, file problem, etc.
        return f"ERROR: {name} failed: {e}"
    return str(result)


# Importing these modules runs their @tool decorators, filling TOOLS.
from shadow.tools import system_tools, web_tools, productivity_tools  # noqa: E402,F401
