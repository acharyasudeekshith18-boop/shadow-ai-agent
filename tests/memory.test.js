import { test } from "node:test";
import assert from "node:assert/strict";
import { Memory } from "../js/memory.js";
import { loadSettings, saveSettings, clearKeys, DEFAULT_SETTINGS } from "../js/settings.js";
import { FakeStorage } from "./helpers.js";

test("history keeps only the newest messages", () => {
  const m = new Memory(new FakeStorage(), { historyLimit: 4 });
  for (let i = 0; i < 10; i++) m.addToHistory("user", `msg ${i}`);
  assert.deepEqual(m.history().map((h) => h.text), ["msg 6", "msg 7", "msg 8", "msg 9"]);
});

test("memory survives a 'page reload' (new Memory on the same storage)", () => {
  const storage = new FakeStorage();
  new Memory(storage).addFact("Favourite food is masala dosa");
  assert.deepEqual(new Memory(storage).facts(), ["Favourite food is masala dosa"]);
});

test("reminders can be marked done; wipeAll clears everything", () => {
  const m = new Memory(new FakeStorage());
  const r = m.addReminder("call mom", Date.now() + 1000);
  m.markReminderDone(r.id);
  assert.equal(m.pendingReminders().length, 0);
  m.addNote("x"); m.addFact("y");
  m.wipeAll();
  assert.equal(m.notes().length + m.facts().length + m.reminders().length, 0);
});

test("settings: defaults, save/load, and keys can be deleted", () => {
  const s = new FakeStorage();
  assert.equal(loadSettings(s).models.gemini[0], DEFAULT_SETTINGS.models.gemini[0]);
  saveSettings(s, { ...DEFAULT_SETTINGS, geminiKey: "AIzaTEST", userName: "Sudeekshith" });
  assert.equal(loadSettings(s).userName, "Sudeekshith");
  clearKeys(s, loadSettings(s));
  assert.equal(loadSettings(s).geminiKey, "");
});
