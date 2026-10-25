// =====================================================================
// memory.js  -  what Shadow remembers
// ---------------------------------------------------------------------
// Two kinds of memory, like a human:
//   SHORT-TERM : the last few chat messages. Sent with every question so
//                Shadow understands "and tomorrow?" after a weather question.
//   LONG-TERM  : facts ("my birthday is 12 March"), notes and reminders.
//                Saved permanently in the browser's localStorage, so they
//                survive closing the tab or restarting the phone.
//
// localStorage is a small key-value store inside the browser (about 5 MB),
// private to this website on this device. Nothing is sent to any server.
// =====================================================================

export class Memory {
  // storage = window.localStorage in the browser; tests pass a fake one.
  constructor(storage, { historyLimit = 10 } = {}) {
    this.storage = storage;
    this.historyLimit = historyLimit;
  }

  // ---- tiny helpers to save / load JSON in localStorage ----
  load(key, fallback) {
    try { const v = this.storage.getItem(`shadow.${key}`); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  }
  save(key, value) { this.storage.setItem(`shadow.${key}`, JSON.stringify(value)); }

  // ------------------------------------------------- short-term: chat history
  history() { return this.load("history", []); }
  addToHistory(role, text) {
    const h = this.history();
    h.push({ role, text });
    // keep only the newest messages so requests stay small and cheap
    this.save("history", h.slice(-this.historyLimit));
  }
  clearHistory() { this.save("history", []); }

  // ---------------------------------------------------------- long-term facts
  facts() { return this.load("facts", []); }
  addFact(fact) {
    const facts = this.facts();
    if (!facts.some((f) => f.toLowerCase() === fact.toLowerCase())) facts.push(fact);
    this.save("facts", facts);
  }
  forgetFact(words) {
    const w = words.toLowerCase();
    const facts = this.facts();
    const removed = facts.filter((f) => f.toLowerCase().includes(w));
    this.save("facts", facts.filter((f) => !f.toLowerCase().includes(w)));
    return removed;
  }

  // -------------------------------------------------------------------- notes
  notes() { return this.load("notes", []); }
  addNote(text) {
    const notes = this.notes();
    notes.push({ text, at: Date.now() });
    this.save("notes", notes);
  }
  deleteNote(index) { const n = this.notes(); n.splice(index, 1); this.save("notes", n); }

  // ---------------------------------------------------------------- reminders
  reminders() { return this.load("reminders", []); }
  pendingReminders() { return this.reminders().filter((r) => !r.done); }
  addReminder(message, at) {
    const list = this.reminders();
    const r = { id: `r${Date.now()}${Math.floor(Math.random() * 1000)}`, message, at, done: false };
    list.push(r);
    this.save("reminders", list);
    return r;
  }
  markReminderDone(id) {
    this.save("reminders", this.reminders().map((r) => (r.id === id ? { ...r, done: true } : r)));
  }

  wipeAll() { ["history", "facts", "notes", "reminders"].forEach((k) => this.storage.removeItem(`shadow.${k}`)); }
}
