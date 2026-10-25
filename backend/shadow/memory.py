"""memory.py - Shadow's memory on the server, saved in an SQLite database.

SHORT-TERM memory = recent chat messages (sent with each question).
LONG-TERM memory  = facts about the user, plus notes and reminders.

SQLite is a full SQL database stored in ONE file (data/shadow.db). It comes
built into Python (import sqlite3), so there is nothing to install.
We always use "?" placeholders in SQL - never string formatting - so user
text can't cause SQL injection (you showed that attack in your demo!).
"""

import sqlite3
import time
from pathlib import Path


class MemoryStore:
    def __init__(self, db_path):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        # check_same_thread=False: FastAPI may use several threads.
        self.db = sqlite3.connect(db_path, check_same_thread=False)
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS history  (id INTEGER PRIMARY KEY, role TEXT, text TEXT, at REAL);
            CREATE TABLE IF NOT EXISTS facts    (id INTEGER PRIMARY KEY, fact TEXT UNIQUE, at REAL);
            CREATE TABLE IF NOT EXISTS notes    (id INTEGER PRIMARY KEY, text TEXT, at REAL);
            CREATE TABLE IF NOT EXISTS reminders(id INTEGER PRIMARY KEY, message TEXT, due REAL, done INTEGER DEFAULT 0);
        """)
        self.db.commit()

    # ---------------- short-term ----------------
    def add_history(self, role, text):
        self.db.execute("INSERT INTO history(role, text, at) VALUES (?, ?, ?)", (role, text, time.time()))
        self.db.commit()

    def recent_history(self, limit=8):
        rows = self.db.execute("SELECT role, text FROM history ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [{"role": r, "text": t} for r, t in reversed(rows)]

    # ---------------- long-term facts ----------------
    def add_fact(self, fact):
        self.db.execute("INSERT OR IGNORE INTO facts(fact, at) VALUES (?, ?)", (fact.strip(), time.time()))
        self.db.commit()

    def facts(self):
        return [r[0] for r in self.db.execute("SELECT fact FROM facts ORDER BY id")]

    def forget_fact(self, words):
        cur = self.db.execute("DELETE FROM facts WHERE fact LIKE ?", (f"%{words}%",))
        self.db.commit()
        return cur.rowcount

    # ---------------- notes & reminders ----------------
    def add_note(self, text):
        self.db.execute("INSERT INTO notes(text, at) VALUES (?, ?)", (text, time.time()))
        self.db.commit()

    def notes(self):
        return [r[0] for r in self.db.execute("SELECT text FROM notes ORDER BY id")]

    def add_reminder(self, message, due_timestamp):
        self.db.execute("INSERT INTO reminders(message, due) VALUES (?, ?)", (message, due_timestamp))
        self.db.commit()

    def pending_reminders(self):
        return [{"message": m, "due": d} for m, d in
                self.db.execute("SELECT message, due FROM reminders WHERE done = 0 ORDER BY due")]


# One shared store, created by app.py at start-up (tests create their own).
STORE = None


def set_store(store):
    global STORE
    STORE = store
