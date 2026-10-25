// =====================================================================
// llm.js  -  the BRAIN connection
// ---------------------------------------------------------------------
// An LLM (Large Language Model) reads text and writes text. We don't run
// Gemini or Llama inside the browser; we SEND our conversation to them over
// the internet with fetch() and get their reply back.
//
// The agent keeps the conversation in ONE simple, provider-neutral format:
//    { role: "user",      text: "weather in Mysuru?" }
//    { role: "assistant", text: "", toolCalls: [{ id, name, args }] }
//    { role: "tool",      id, name, result: {...} }
//    { role: "assistant", text: "It's 27°C and sunny in Mysuru." }
//
// Each provider wants its own JSON shape, so for each one we write a small
// "translator" function. The agent never needs to know which brain answered.
//
// Providers:
//   gemini -> Google Gemini (free key: aistudio.google.com)        PRIMARY
//   groq   -> Groq, OpenAI-style API (free key: console.groq.com)  FALLBACK
//   ollama -> a model running on your own laptop (no key, offline) OPTIONAL
// =====================================================================

export class LLMError extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.retryable = retryable; // true for 429 (rate limit) and 5xx (server busy)
  }
}

// ---------------------------------------------------------------------
// Gemini  (native "function calling")
// ---------------------------------------------------------------------
export async function callGemini({ apiKey, model, system, conversation, tools, settings, fetchFn = fetch }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  // 1. Translate our neutral conversation into Gemini's "contents" format.
  const contents = [];
  for (const item of conversation) {
    if (item.role === "user") {
      contents.push({ role: "user", parts: [{ text: item.text }] });
    } else if (item.role === "assistant") {
      // If Gemini itself wrote this turn we send its parts back EXACTLY as they
      // were (newer Gemini models attach a hidden "thoughtSignature" they need back).
      const parts = item.geminiParts || [
        ...(item.text ? [{ text: item.text }] : []),
        ...(item.toolCalls || []).map((c) => ({ functionCall: { name: c.name, args: c.args } })),
      ];
      contents.push({ role: "model", parts });
    } else if (item.role === "tool") {
      // A tool result goes back as a "functionResponse" part.
      const part = { functionResponse: { name: item.name, response: { result: item.result } } };
      const last = contents[contents.length - 1];
      // Several tool results in a row are sent together in one turn.
      if (last && last.role === "user" && last.parts[0].functionResponse) last.parts.push(part);
      else contents.push({ role: "user", parts: [part] });
    }
  }

  // 2. Build the request body.
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { temperature: settings.temperature, maxOutputTokens: settings.maxOutputTokens },
  };
  if (tools && tools.length) {
    // The "menu" of tools: name + description + JSON-Schema of the inputs.
    body.tools = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
  }

  // 3. Send it. The key goes in a header and comes from Settings, never the code.
  const data = await postJSON(fetchFn, url, body, { "x-goog-api-key": apiKey });

  // 4. Read the reply. It may contain text, functionCalls, or both.
  const candidate = (data.candidates || [])[0];
  if (!candidate || !candidate.content) {
    const reason = data.promptFeedback?.blockReason || candidate?.finishReason || "empty reply";
    throw new LLMError(`Gemini gave no answer (${reason})`);
  }
  const parts = candidate.content.parts || [];
  const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
  const toolCalls = parts
    .filter((p) => p.functionCall)
    .map((p, i) => ({ id: `call_${Date.now()}_${i}`, name: p.functionCall.name, args: p.functionCall.args || {} }));
  if (!text && toolCalls.length === 0) {
    throw new LLMError(`Gemini reply was empty (finishReason ${candidate.finishReason})`);
  }
  return { text, toolCalls, geminiParts: parts };
}

// ---------------------------------------------------------------------
// OpenAI-compatible APIs: Groq and Ollama both speak this format
// ---------------------------------------------------------------------
export async function callOpenAICompatible({ baseUrl, apiKey, model, system, conversation, tools, settings, fetchFn = fetch }) {
  // 1. Translate the conversation into OpenAI-style "messages".
  const messages = [{ role: "system", content: system }];
  for (const item of conversation) {
    if (item.role === "user") messages.push({ role: "user", content: item.text });
    else if (item.role === "assistant") {
      const msg = { role: "assistant", content: item.text || "" };
      if (item.toolCalls && item.toolCalls.length) {
        msg.tool_calls = item.toolCalls.map((c) => ({
          id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) },
        }));
      }
      messages.push(msg);
    } else if (item.role === "tool") {
      messages.push({ role: "tool", tool_call_id: item.id, content: JSON.stringify(item.result) });
    }
  }

  const body = { model, messages, temperature: settings.temperature, max_tokens: settings.maxOutputTokens };
  if (tools && tools.length) {
    body.tools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
    body.tool_choice = "auto";
  }
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const data = await postJSON(fetchFn, `${baseUrl.replace(/\/$/, "")}/chat/completions`, body, headers);

  const msg = data.choices?.[0]?.message;
  if (!msg) throw new LLMError("reply had an unexpected format");
  const toolCalls = (msg.tool_calls || []).map((c) => ({
    id: c.id, name: c.function.name, args: safeParse(c.function.arguments),
  }));
  const text = (msg.content || "").trim();
  if (!text && toolCalls.length === 0) throw new LLMError("empty reply");
  return { text, toolCalls };
}

// ---------------------------------------------------------------------
// The Brain: tries each provider/model in order (the "fallback chain")
// ---------------------------------------------------------------------
export class Brain {
  constructor(settings, { fetchFn = (...a) => fetch(...a), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    this.settings = settings;
    this.fetchFn = fetchFn;
    this.sleep = sleep;
    this.lastUsed = ""; // e.g. "gemini / gemini-flash-lite-latest" - shown in the UI
  }

  // Which providers can we actually use? (Gemini/Groq need a key.)
  available() {
    const s = this.settings;
    return s.providerOrder.filter((p) =>
      (p === "gemini" && s.geminiKey) || (p === "groq" && s.groqKey) || (p === "ollama" && s.useOllama));
  }

  async chat(system, conversation, tools) {
    const errors = [];
    const providers = this.available();
    if (providers.length === 0) {
      throw new LLMError("No AI key yet. Open Settings (⚙) and paste your free Gemini key.");
    }
    for (const provider of providers) {
      for (const model of this.settings.models[provider]) {
        // Try each model up to 2 times (retry once if it was a temporary error).
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const reply = await this.callOne(provider, model, system, conversation, tools);
            this.lastUsed = `${provider} / ${model}`;
            return reply;
          } catch (err) {
            if (err.retryable && attempt === 1) { await this.sleep(1500); continue; }
            errors.push(`${provider}/${model}: ${err.message}`);
            break; // move on to the next model
          }
        }
      }
    }
    throw new LLMError(explain(errors));
  }

  callOne(provider, model, system, conversation, tools) {
    const s = this.settings;
    const common = { model, system, conversation, tools, settings: s, fetchFn: this.fetchFn };
    if (provider === "gemini") return callGemini({ ...common, apiKey: s.geminiKey });
    if (provider === "groq") return callOpenAICompatible({ ...common, baseUrl: "https://api.groq.com/openai/v1", apiKey: s.groqKey });
    if (provider === "ollama") return callOpenAICompatible({ ...common, baseUrl: `${s.ollamaUrl.replace(/\/$/, "")}/v1` });
    throw new LLMError(`unknown provider ${provider}`);
  }
}

// ---------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------
async function postJSON(fetchFn, url, body, headers) {
  let res;
  try {
    res = await fetchFn(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  } catch (e) {
    throw new LLMError("network error (no internet, or the server is not running)", { retryable: false });
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    const retryable = res.status === 429 || res.status >= 500;
    throw new LLMError(`HTTP ${res.status} ${detail}`, { retryable });
  }
  return res.json();
}

function safeParse(s) {
  try { return typeof s === "string" ? JSON.parse(s || "{}") : s || {}; } catch { return {}; }
}

// Turn a list of technical errors into one human sentence for the UI.
function explain(errors) {
  const all = errors.join(" | ");
  let hint = "Every AI provider failed.";
  if (/HTTP 429/.test(all)) hint = "I've hit the free limit for now (too many requests). Wait a minute, or add a Groq key as backup.";
  else if (/HTTP (400|401|403)/.test(all) && /key|API_KEY|permission|auth/i.test(all)) hint = "The API key looks wrong. Check it in Settings.";
  else if (/ollama\/[^|]*network error/.test(all) && !/(gemini|groq)\//.test(all)) hint = "I can't reach Ollama. Is it running? Start it with OLLAMA_ORIGINS=* ollama serve, and open Shadow from http://localhost.";
  else if (/network error/.test(all)) hint = "I can't reach the AI. Check your internet connection.";
  return `${hint} (details: ${all})`;
}
