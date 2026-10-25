// =====================================================================
// app.js  -  connects the screen, the voice, the memory and the agent
// ---------------------------------------------------------------------
// Flow of one question:
//   tap orb -> Listener (speech to text) -> runAgent (think/act/observe)
//   -> show answer + steps -> Speaker (text to speech) -> maybe listen again
// =====================================================================

import { loadSettings, saveSettings, clearKeys } from "./settings.js";
import { Memory } from "./memory.js";
import { Brain } from "./llm.js";
import { runAgent } from "./agent.js";
import { Listener, Speaker, WakeWord, speechSupported } from "./voice.js";

// ---------- grab the HTML elements we need ----------
const $ = (id) => document.getElementById(id);
const orb = $("orb"), statusEl = $("status"), liveText = $("liveText"), chat = $("chat");
const input = $("textInput"), badge = $("providerBadge");

// ---------- create the main objects ----------
let settings = loadSettings(localStorage);
const memory = new Memory(localStorage);
let brain = new Brain(settings);
let listener = new Listener(settings);
let speaker = new Speaker(settings);
let wake = null;
let busy = false;           // true while the agent is working
let currentBubble = null;   // the bot message being filled in right now

// =====================================================================
// 1. Orb states: idle / listening / thinking / speaking
// =====================================================================
const STATUS_TEXT = {
  idle: "Tap the orb and talk",
  listening: "Listening… tap again when done",
  thinking: "Thinking…",
  speaking: "Speaking… tap to stop",
};
function setState(state) {
  orb.className = `orb ${state}`;
  statusEl.textContent = STATUS_TEXT[state];
  orb.dataset.state = state;
}

// =====================================================================
// 2. Chat bubbles
// =====================================================================
function addMessage(role, text, extraClass = "") {
  const div = document.createElement("div");
  div.className = `msg ${role} ${extraClass}`.trim();
  const body = document.createElement("div");
  body.className = "body";
  body.textContent = text;
  div.appendChild(body);
  chat.appendChild(div);
  div.scrollIntoView({ behavior: "smooth", block: "end" });
  return div;
}

// The collapsible "Agent steps" list inside a bot bubble.
function stepsList(bubble) {
  let details = bubble.querySelector(".steps");
  if (!details) {
    details = document.createElement("details");
    details.className = "steps";
    details.innerHTML = "<summary>Agent steps</summary><ol></ol>";
    bubble.appendChild(details);
  }
  return details.querySelector("ol");
}

function addStep(bubble, html) {
  const li = document.createElement("li");
  li.innerHTML = html;
  stepsList(bubble).appendChild(li);
  const n = bubble.querySelectorAll(".steps li").length;
  bubble.querySelector(".steps summary").textContent = `Agent steps (${n})`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const short = (obj) => { const s = JSON.stringify(obj); return s.length > 220 ? s.slice(0, 220) + "…" : s; };

// Called by the agent for every step -> shows the reasoning live.
function showStep(step) {
  const b = currentBubble;
  if (step.type === "thinking") b.querySelector(".body").textContent = step.step === 1 ? "Thinking" : "Reading the results";
  if (step.type === "brain") badge.textContent = step.provider;
  if (step.type === "thought") addStep(b, `💭 <b>Think:</b> ${esc(step.text)}`);
  if (step.type === "action") addStep(b, `🛠 <b>Act:</b> call <code>${esc(step.name)}(${esc(short(step.args))})</code>`);
  if (step.type === "observation") addStep(b, `👁 <b>Observe:</b> <code>${esc(short(step.result))}</code>`);
  if (step.type === "answer") addStep(b, "✅ <b>Answer</b> ready");
}

// =====================================================================
// 3. Things the tools can ask the UI to do
// =====================================================================
const ui = {
  // Open a link. Browsers may block pop-ups that don't come from a tap,
  // so we ALSO show a link chip the user can tap.
  openUrl(url) {
    window.open(url, "_blank", "noopener");
    if (currentBubble) {
      const a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noopener"; a.className = "link-chip";
      a.textContent = "↗ " + url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40);
      currentBubble.appendChild(a);
    }
  },
  scheduleReminder,
};

// =====================================================================
// 4. The main function: handle one message from the user
// =====================================================================
async function handleUserText(text) {
  text = text.trim();
  if (!text || busy) return;
  busy = true;
  wake?.stop();
  addMessage("user", text);
  currentBubble = addMessage("bot", "Thinking", "typing");
  setState("thinking");
  try {
    const answer = await runAgent({
      userText: text, brain, memory, settings,
      ctx: { fetch: (...a) => fetch(...a), ui, navigator, screen },
      onStep: showStep,
    });
    currentBubble.classList.remove("typing");
    currentBubble.querySelector(".body").textContent = answer;
    if (settings.speakReplies) {
      setState("speaking");
      await speaker.speak(answer);           // wait until speaking has FINISHED
    }
    busy = false;
    setState("idle");
    if (settings.conversationMode && speechSupported()) {
      setTimeout(startListening, 400);       // short gap so the mic doesn't hear the speaker
      return;
    }
  } catch (err) {
    currentBubble.classList.remove("typing");
    currentBubble.classList.add("error");
    currentBubble.querySelector(".body").textContent = "⚠ " + err.message;
    busy = false;
    setState("idle");
  }
  if (settings.wakeWord) startWakeWord();
}

// =====================================================================
// 5. Voice: tap the orb
// =====================================================================
function startListening() {
  if (busy) return;
  speaker.stop();
  wake?.stop();
  setState("listening");
  liveText.textContent = "";
  listener.start({
    onInterim: (t) => { liveText.textContent = t; },        // live words on screen
    onDone: (t) => { liveText.textContent = ""; setState("idle"); if (t) handleUserText(t); else if (settings.wakeWord) startWakeWord(); },
    onError: (msg) => { setState("idle"); addMessage("system", msg); },
  });
}

orb.addEventListener("click", () => {
  const state = orb.dataset.state;
  if (state === "listening") listener.finish();              // tap again = "I'm done"
  else if (state === "speaking") { speaker.stop(); setState("idle"); }
  else if (state !== "thinking") startListening();
});

$("inputBar").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = input.value;
  input.value = "";
  handleUserText(t);
});

function startWakeWord() {
  if (!settings.wakeWord || !speechSupported() || busy) return;
  wake = wake || new WakeWord(settings, (command) => {
    if (command) handleUserText(command);
    else { speaker.speak("Yes?").then(startListening); }
  });
  wake.settings = settings;
  wake.start();
  statusEl.textContent = `Say "Hey ${settings.assistantName}"`;
}

// =====================================================================
// 6. Reminders (work while the page/app is open)
// =====================================================================
function scheduleReminder(r) {
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  const delay = Math.max(0, r.at - Date.now());
  setTimeout(() => fireReminder(r), Math.min(delay, 2 ** 31 - 1));
}
function fireReminder(r) {
  if (memory.reminders().find((x) => x.id === r.id)?.done) return;
  memory.markReminderDone(r.id);
  const text = `⏰ Reminder: ${r.message}`;
  addMessage("system", text);
  if ("Notification" in window && Notification.permission === "granted") new Notification("Shadow", { body: r.message, icon: "icons/icon-192.png" });
  speaker.speak(`${settings.userName}, reminder: ${r.message}`);
}
memory.pendingReminders().forEach(scheduleReminder);   // re-arm saved reminders on page load

// =====================================================================
// 7. Settings dialog
// =====================================================================
const form = $("settingsForm");
function fillVoices() {
  const select = form.elements.voiceName;
  const voices = speaker.voices();
  select.innerHTML = '<option value="">Automatic</option>' +
    voices.map((v) => `<option value="${esc(v.name)}">${esc(v.name)} (${v.lang})</option>`).join("");
  select.value = settings.voiceName;
}
if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = fillVoices;

function openSettings() {
  const f = form.elements;
  for (const k of ["userName", "city", "geminiKey", "groqKey", "ollamaUrl", "voiceRate", "voicePitch", "silenceMs", "language"]) f[k].value = settings[k];
  for (const k of ["useOllama", "speakReplies", "conversationMode", "wakeWord"]) f[k].checked = settings[k];
  f.geminiModels.value = settings.models.gemini.join(", ");
  f.groqModels.value = settings.models.groq.join(", ");
  f.ollamaModels.value = settings.models.ollama.join(", ");
  fillVoices();
  $("testResult").textContent = "";
  $("settingsDialog").showModal();
}

function readForm() {
  const f = form.elements;
  const list = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
  return {
    ...settings,
    userName: f.userName.value.trim() || "Boss",
    city: f.city.value.trim() || "Shivamogga",
    geminiKey: f.geminiKey.value.trim(),
    groqKey: f.groqKey.value.trim(),
    useOllama: f.useOllama.checked,
    ollamaUrl: f.ollamaUrl.value.trim(),
    models: { gemini: list(f.geminiModels.value), groq: list(f.groqModels.value), ollama: list(f.ollamaModels.value) },
    speakReplies: f.speakReplies.checked,
    conversationMode: f.conversationMode.checked,
    wakeWord: f.wakeWord.checked,
    voiceName: f.voiceName.value,
    voiceRate: Number(f.voiceRate.value),
    voicePitch: Number(f.voicePitch.value),
    silenceMs: Number(f.silenceMs.value) || 2000,
    language: f.language.value,
  };
}

function applySettings(s) {
  settings = s;
  saveSettings(localStorage, settings);
  brain = new Brain(settings);
  listener = new Listener(settings);
  speaker = new Speaker(settings);
  if (wake) { wake.stop(); wake = null; }
  if (settings.wakeWord) startWakeWord();
  refreshSetupCard();
}

form.addEventListener("submit", () => applySettings(readForm()));
$("settingsBtn").onclick = openSettings;
$("openSettingsFromCard").onclick = openSettings;
$("clearKeysBtn").onclick = () => { applySettings(clearKeys(localStorage, readForm())); openSettings(); $("testResult").textContent = "Keys deleted from this device."; };

// "Test my key": one tiny request with no tools.
$("testBtn").onclick = async () => {
  const out = $("testResult");
  out.textContent = "Testing…";
  const testBrain = new Brain(readForm());
  try {
    const r = await testBrain.chat("Reply with exactly: OK", [{ role: "user", text: "Say OK" }], []);
    out.textContent = `✅ Working: ${testBrain.lastUsed} replied "${r.text.slice(0, 40)}"`;
  } catch (e) {
    out.textContent = "❌ " + e.message;
  }
};

// =====================================================================
// 8. Memory dialog
// =====================================================================
function renderMemory() {
  const li = (text, onDelete) => {
    const el = document.createElement("li");
    el.textContent = text;
    if (onDelete) { const b = document.createElement("button"); b.type = "button"; b.textContent = "✕"; b.onclick = () => { onDelete(); renderMemory(); }; el.appendChild(b); }
    return el;
  };
  const facts = $("factsList"), notes = $("notesList"), rems = $("remindersList");
  facts.replaceChildren(...memory.facts().map((f) => li(f, () => memory.forgetFact(f))));
  notes.replaceChildren(...memory.notes().map((n, i) => li(n.text, () => memory.deleteNote(i))));
  rems.replaceChildren(...memory.pendingReminders().map((r) => li(`${new Date(r.at).toLocaleString("en-IN")} – ${r.message}`, () => memory.markReminderDone(r.id))));
  for (const [el, word] of [[facts, "No facts yet. Say: remember my birthday is 12 March"], [notes, "No notes yet"], [rems, "No reminders"]]) {
    if (!el.children.length) el.appendChild(li(word));
  }
}
$("memoryBtn").onclick = () => { renderMemory(); $("memoryDialog").showModal(); };
$("clearChatBtn").onclick = () => { memory.clearHistory(); chat.replaceChildren(); };
$("wipeBtn").onclick = () => { if (confirm("Erase all facts, notes, reminders and chat history?")) { memory.wipeAll(); renderMemory(); chat.replaceChildren(); } };

// =====================================================================
// 9. Start-up
// =====================================================================
function refreshSetupCard() {
  $("setupCard").classList.toggle("hidden", Boolean(settings.geminiKey || settings.groqKey || settings.useOllama));
}
refreshSetupCard();
setState("idle");
addMessage("bot", greeting());
if (!speechSupported()) addMessage("system", "Voice input isn't supported in this browser. Use Chrome or Edge for voice, or just type.");
if (settings.wakeWord) startWakeWord();

function greeting() {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return `${part}, ${settings.userName}. I'm ${settings.assistantName}. Ask me anything, or tell me to do something.`;
}

// PWA: register the service worker so the app can be installed and opens offline.
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// Expose for testing in the browser console / automated tests.
window.shadow = { handleUserText, memory, get settings() { return settings; } };
