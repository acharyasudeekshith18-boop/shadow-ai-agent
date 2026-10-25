"""productivity_tools.py - notes, reminders and long-term memory tools."""

import datetime

from shadow import memory
from shadow.tools import tool


@tool("remember_fact", "Permanently remembers a fact about the user (birthday, likes, college...).",
      {"fact": "the fact as a short sentence"})
def remember_fact(fact):
    memory.STORE.add_fact(fact)
    return f"Remembered: {fact}"


@tool("forget_fact", "Forgets facts containing the given words.", {"fact": "words of the fact to forget"})
def forget_fact(fact):
    return f"Forgot {memory.STORE.forget_fact(fact)} fact(s)."


@tool("take_note", "Saves a note for the user.", {"text": "the note"})
def take_note(text):
    memory.STORE.add_note(text)
    return f"Note saved. You have {len(memory.STORE.notes())} notes."


@tool("read_notes", "Reads back the saved notes.")
def read_notes():
    notes = memory.STORE.notes()
    return "\n".join(f"{i + 1}. {n}" for i, n in enumerate(notes)) or "No notes yet."


@tool("set_reminder", "Saves a reminder for some minutes from now.",
      {"message": "what to remind", "minutes": "minutes from now (a number)"})
def set_reminder(message, minutes):
    due = datetime.datetime.now() + datetime.timedelta(minutes=float(minutes))
    memory.STORE.add_reminder(message, due.timestamp())
    return f"Reminder saved for {due.strftime('%I:%M %p')}: {message}"
