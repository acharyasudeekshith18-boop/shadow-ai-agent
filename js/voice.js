// =====================================================================
// voice.js  -  ears (speech -> text) and mouth (text -> speech)
// ---------------------------------------------------------------------
// Both use the Web Speech API that is built into the browser, so they are
// FREE and need no key. Best support: Google Chrome (desktop and Android)
// and Microsoft Edge. (Firefox has no speech recognition yet.)
//
// THE "IT CUTS ME OFF" PROBLEM AND HOW WE FIX IT
// The browser's recognizer likes to stop as soon as you pause for breath.
// We fix this ourselves:
//   1. We collect the words from every result into one sentence.
//   2. If the browser stops on its own, we quietly START IT AGAIN and keep
//      adding words.
//   3. We only finish when YOU have been silent for `silenceMs` (2 s by
//      default), or when you tap the orb again.
// =====================================================================

const Recognition = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

export const speechSupported = () => Boolean(Recognition);
export const ttsSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

// ---------------------------------------------------------------------
// Listener: one "turn" of listening (press the orb, speak, done)
// ---------------------------------------------------------------------
export class Listener {
  constructor(settings) { this.settings = settings; this.active = false; }

  /** Start listening. Calls onInterim(text) while you speak and onDone(text) at the end. */
  start({ onInterim = () => {}, onDone = () => {}, onError = () => {} }) {
    if (!Recognition) { onError("Speech recognition isn't supported in this browser. Use Chrome, or type instead."); return; }
    this.active = true;
    this.committed = "";        // words from earlier recognition sessions
    this.current = "";          // words from the session running now
    this.onInterim = onInterim; this.onDone = onDone; this.onError = onError;
    this.heardSomething = false;
    this.startedAt = Date.now();
    this.startSession();
    this.resetSilenceTimer(8000); // you get 8 s to START talking
  }

  startSession() {
    const rec = new Recognition();
    this.rec = rec;
    rec.lang = this.settings.language;
    rec.interimResults = true;        // give us words WHILE you speak (live text)
    // Android Chrome repeats words in continuous mode, so there we use short
    // sessions and restart them; on desktop one continuous session is best.
    rec.continuous = !isAndroid;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      // Rebuild this session's text from ALL its results (avoids duplicates).
      let finalText = "", interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
      }
      this.current = (finalText + " " + interim).trim();
      this.heardSomething = true;
      this.onInterim(this.fullText());
      this.resetSilenceTimer(this.settings.silenceMs); // you're still talking: wait again
    };

    rec.onerror = (e) => {
      // "no-speech" and "aborted" are normal; real problems are reported.
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.active = false; clearTimeout(this.timer);
        this.onError("Microphone permission was denied. Allow the mic for this site in the browser settings.");
      } else if (e.error === "network") {
        this.active = false; clearTimeout(this.timer);
        this.onError("Speech recognition needs internet (Chrome sends audio to Google to transcribe).");
      }
    };

    rec.onend = () => {
      // The browser stopped by itself. Save the words, and if we are still
      // supposed to be listening, start a NEW session so you aren't cut off.
      this.committed = this.fullText();
      this.current = "";
      if (this.active) {
        try { this.startSession(); } catch { this.finish(); }
      }
    };

    try { rec.start(); } catch (e) { /* already started: ignore */ }
  }

  fullText() { return `${this.committed} ${this.current}`.replace(/\s+/g, " ").trim(); }

  resetSilenceTimer(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.finish(), ms);
  }

  /** Stop listening and hand over the text (called by the silence timer or a tap). */
  finish() {
    if (!this.active) return;
    this.active = false;
    clearTimeout(this.timer);
    try { this.rec && this.rec.stop(); } catch { /* ignore */ }
    this.onDone(this.fullText());
  }

  /** Cancel without sending anything. */
  cancel() { this.active = false; clearTimeout(this.timer); try { this.rec && this.rec.abort(); } catch { /* ignore */ } }
}

// ---------------------------------------------------------------------
// Speaker: text -> voice
// ---------------------------------------------------------------------
export class Speaker {
  constructor(settings) { this.settings = settings; }

  voices() { return ttsSupported() ? window.speechSynthesis.getVoices() : []; }

  // Choose a voice: the one picked in Settings, else an English-India voice,
  // else any English voice.
  pickVoice() {
    const all = this.voices();
    return all.find((v) => v.name === this.settings.voiceName)
      || all.find((v) => v.lang === "en-IN")
      || all.find((v) => /en-GB/.test(v.lang) && /male/i.test(v.name))
      || all.find((v) => v.lang && v.lang.startsWith("en"))
      || null;
  }

  /** Speak text. Returns a Promise that resolves when speaking has FINISHED,
   *  so the app can safely turn the microphone on afterwards (no echo). */
  speak(text) {
    if (!ttsSupported() || !text) return Promise.resolve();
    const synth = window.speechSynthesis;
    synth.cancel();
    // Chrome stops long speeches after ~15 s, so we speak sentence by sentence.
    const chunks = cleanForSpeech(text).match(/[^.!?]+[.!?]*/g) || [text];
    const voice = this.pickVoice();
    return new Promise((resolve) => {
      let left = chunks.length;
      const safety = setTimeout(resolve, 2000 + text.length * 90); // in case onend never fires
      for (const chunk of chunks) {
        const u = new SpeechSynthesisUtterance(chunk.trim());
        if (voice) u.voice = voice;
        u.lang = voice ? voice.lang : "en-IN";
        u.rate = this.settings.voiceRate;
        u.pitch = this.settings.voicePitch;
        u.onend = u.onerror = () => { if (--left === 0) { clearTimeout(safety); resolve(); } };
        synth.speak(u);
      }
    });
  }

  stop() { if (ttsSupported()) window.speechSynthesis.cancel(); }
}

// Remove things that sound silly when read aloud (markdown, emojis, links).
export function cleanForSpeech(text) {
  return String(text)
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/[*_#`>|~]/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------
// WakeWord: listens quietly in the background for "Shadow"
// (works only while the page is open and in front - a browser rule)
// ---------------------------------------------------------------------
export class WakeWord {
  constructor(settings, onWake) { this.settings = settings; this.onWake = onWake; this.running = false; }

  start() {
    if (!Recognition || this.running) return;
    this.running = true;
    const rec = new Recognition();
    this.rec = rec;
    rec.lang = this.settings.language;
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (event) => {
      const said = event.results[event.results.length - 1][0].transcript.toLowerCase();
      const name = this.settings.assistantName.toLowerCase();
      const at = said.indexOf(name);
      if (at !== -1) {
        // Anything said after the name is treated as the command:
        // "hey shadow what's the time" -> "what's the time"
        const command = said.slice(at + name.length).replace(/^[\s,.!?]+/, "");
        this.stop();
        this.onWake(command);
      }
    };
    rec.onend = () => { if (this.running) { try { rec.start(); } catch { /* ignore */ } } };
    rec.onerror = (e) => { if (e.error === "not-allowed") this.running = false; };
    try { rec.start(); } catch { /* ignore */ }
  }

  stop() { this.running = false; try { this.rec && this.rec.abort(); } catch { /* ignore */ } }
}
