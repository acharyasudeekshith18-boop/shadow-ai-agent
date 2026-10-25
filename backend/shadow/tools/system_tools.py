"""system_tools.py - tools that run on the server: get_time_date, system_info, calculator.

(Opening websites or playing YouTube happens in the BROWSER version, because a
server has no screen. That is a good viva point: tools run where the agent runs.)
"""

import ast
import datetime
import math
import operator

import psutil

from shadow.tools import tool


# --------------------------------------------------------------- time & date
@tool("get_time_date", "Gives the current local time, date and day of the week.")
def get_time_date():
    now = datetime.datetime.now()
    # Example: "Sunday, 25 October 2026, 08:15 AM"
    return now.strftime("%A, %d %B %Y, %I:%M %p")


# --------------------------------------------------------------- system info
@tool("system_info", "Shows battery level, CPU usage, RAM usage and free disk space of this computer.")
def system_info():
    cpu = psutil.cpu_percent(interval=0.5)          # % CPU used, measured over 0.5 s
    ram = psutil.virtual_memory()                    # RAM details
    disk = psutil.disk_usage("/")                    # main drive (C:\ on Windows)
    parts = [
        f"CPU usage {cpu:.0f}%",
        f"RAM used {ram.percent:.0f}% of {ram.total / 1e9:.1f} GB",
        f"Disk free {disk.free / 1e9:.0f} GB",
    ]
    battery = psutil.sensors_battery()               # None on desktops without a battery
    if battery is not None:
        state = "charging" if battery.power_plugged else "on battery"
        parts.insert(0, f"Battery {battery.percent:.0f}% ({state})")
    else:
        parts.insert(0, "No battery found (desktop PC)")
    return ", ".join(parts)


# ---------------------------------------------------------------- calculator
# We NEVER use Python's eval() on text from the AI or user: eval("__import__('os')
# .system('del *')") would run any command! Instead we read the maths with the
# "ast" module and allow ONLY numbers, + - * / ** % and a few math functions.
_OPERATORS = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
    ast.Div: operator.truediv, ast.Pow: operator.pow, ast.Mod: operator.mod,
    ast.FloorDiv: operator.floordiv, ast.USub: operator.neg, ast.UAdd: operator.pos,
}
_FUNCTIONS = {
    "sqrt": math.sqrt, "sin": lambda x: math.sin(math.radians(x)),
    "cos": lambda x: math.cos(math.radians(x)), "tan": lambda x: math.tan(math.radians(x)),
    "log": math.log10, "ln": math.log, "abs": abs, "round": round,
    "factorial": math.factorial,
}
_CONSTANTS = {"pi": math.pi, "e": math.e}


def _safe_eval(node):
    """Walk the expression tree and calculate it, refusing anything unsafe."""
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _OPERATORS:
        return _OPERATORS[type(node.op)](_safe_eval(node.left), _safe_eval(node.right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _OPERATORS:
        return _OPERATORS[type(node.op)](_safe_eval(node.operand))
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _FUNCTIONS:
        return _FUNCTIONS[node.func.id](*[_safe_eval(a) for a in node.args])
    if isinstance(node, ast.Name) and node.id in _CONSTANTS:
        return _CONSTANTS[node.id]
    raise ValueError("only numbers and basic maths are allowed")


@tool("calculator", "Calculates a maths expression exactly. Use it for ANY arithmetic.",
      {"expression": "maths like '(25*4)+sqrt(16)' or '15% of 2000' written as '0.15*2000'"})
def calculator(expression):
    expr = str(expression).replace("^", "**").replace("x", "*").replace("×", "*").replace("÷", "/")
    expr = expr.replace(",", "")                     # "1,000" -> "1000"
    result = _safe_eval(ast.parse(expr, mode="eval").body)
    if isinstance(result, float) and result.is_integer():
        result = int(result)
    elif isinstance(result, float):
        result = round(result, 6)
    return f"{expression} = {result}"
