// =====================================================================
// settings.js  -  user settings, saved in this browser only
// ---------------------------------------------------------------------
// IMPORTANT ABOUT API KEYS
//  * Your key is typed into the Settings panel and saved in localStorage
//    on YOUR device. It is never written in the code and never uploaded
//    to GitHub, so the public repo contains no keys at all.
//  * The browser sends the key ONLY to Google / Groq when it asks them a
//    question. Anyone using your device's browser could read it, so use
//    your own device, and you can delete the key any time (Settings > Clear).
// =====================================================================

export const DEFAULT_SETTINGS = {
  userName: "Boss",
  assistantName: "Shadow",
  city: "Shivamogga",            // default city for weather

  geminiKey: "",                 // free from https://aistudio.google.com/apikey
  groqKey: "",                   // optional, free from https://console.groq.com/keys
  useOllama: false,              // optional: local model on your laptop (no key)
  ollamaUrl: "http://localhost:11434",

  // Order to try the brains in. If one fails, the next is tried automatically.
  providerOrder: ["gemini", "groq", "ollama"],
  // Model names change over time. These were current in October 2026:
  models: {
    gemini: ["gemini-flash-lite-latest", "gemini-flash-latest"],
    groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    ollama: ["qwen2.5:3b"],
  },
  temperature: 0.4,
  maxOutputTokens: 1024,
  maxSteps: 6,                   // max tool calls per question (stops endless loops)

  // Voice
  language: "en-IN",             // speech recognition language (Indian English)
  silenceMs: 2000,               // how long you must be quiet before Shadow stops listening
  speakReplies: true,
  voiceName: "",                 // "" = pick automatically
  voiceRate: 1.0,
  voicePitch: 0.8,               // a little deeper than normal
  conversationMode: false,       // listen again automatically after speaking
  wakeWord: false,               // listen in the background for "Hey Shadow"
};

const KEY = "shadow.settings";

export function loadSettings(storage) {
  try {
    const saved = JSON.parse(storage.getItem(KEY) || "{}");
    // merge: defaults first, then whatever the user saved
    return { ...DEFAULT_SETTINGS, ...saved, models: { ...DEFAULT_SETTINGS.models, ...(saved.models || {}) } };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(storage, settings) {
  storage.setItem(KEY, JSON.stringify(settings));
}

export function clearKeys(storage, settings) {
  const s = { ...settings, geminiKey: "", groqKey: "" };
  saveSettings(storage, s);
  return s;
}
