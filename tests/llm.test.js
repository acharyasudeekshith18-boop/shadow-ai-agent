// Tests for llm.js: the exact requests sent to Gemini / Groq / Ollama and the
// fallback chain. fetch is faked, so no key and no internet are needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Brain, callGemini, callOpenAICompatible } from "../js/llm.js";
import { tools } from "../js/tools.js";
import { DEFAULT_SETTINGS } from "../js/settings.js";
import { fakeFetch } from "./helpers.js";

const noSleep = async () => {};
const geminiText = (text) => ({ json: { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] } });

test("Gemini request has system prompt, tools and key header; functionCall is parsed", async () => {
  const f = fakeFetch([[(u) => u.includes("generativelanguage"), () => ({
    json: { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "get_weather", args: { city: "Mysuru" } }, thoughtSignature: "sig123" }] } }] },
  })]]);
  const r = await callGemini({ apiKey: "TESTKEY", model: "gemini-flash-lite-latest", system: "SYS", conversation: [{ role: "user", text: "weather in Mysuru" }], tools, settings: DEFAULT_SETTINGS, fetchFn: f });

  const call = f.calls[0];
  assert.match(call.url, /models\/gemini-flash-lite-latest:generateContent$/);
  assert.equal(call.options.headers["x-goog-api-key"], "TESTKEY");
  assert.equal(call.url.includes("TESTKEY"), false, "key must not be in the URL");
  assert.equal(call.body.systemInstruction.parts[0].text, "SYS");
  assert.ok(call.body.tools[0].functionDeclarations.some((d) => d.name === "get_weather"));
  assert.deepEqual(r.toolCalls.map((c) => [c.name, c.args]), [["get_weather", { city: "Mysuru" }]]);
  assert.equal(r.geminiParts[0].thoughtSignature, "sig123");
});

test("Gemini: tool results go back as functionResponse and model parts are echoed exactly", async () => {
  const f = fakeFetch([[() => true, () => geminiText("It is 27 degrees.")]]);
  const modelParts = [{ functionCall: { name: "get_weather", args: { city: "Mysuru" } }, thoughtSignature: "sig123" }];
  await callGemini({
    apiKey: "K", model: "m", system: "S", tools, settings: DEFAULT_SETTINGS, fetchFn: f,
    conversation: [
      { role: "user", text: "weather?" },
      { role: "assistant", text: "", toolCalls: [{ id: "1", name: "get_weather", args: { city: "Mysuru" } }], geminiParts: modelParts },
      { role: "tool", id: "1", name: "get_weather", result: { temperature_c: 27 } },
    ],
  });
  const contents = f.calls[0].body.contents;
  assert.deepEqual(contents.map((c) => c.role), ["user", "model", "user"]);
  assert.deepEqual(contents[1].parts, modelParts);
  assert.deepEqual(contents[2].parts[0].functionResponse, { name: "get_weather", response: { result: { temperature_c: 27 } } });
});

test("Gemini blocked / empty reply becomes a clear error", async () => {
  const f = fakeFetch([[() => true, () => ({ json: { promptFeedback: { blockReason: "SAFETY" } } })]]);
  await assert.rejects(callGemini({ apiKey: "K", model: "m", system: "S", conversation: [{ role: "user", text: "x" }], tools: [], settings: DEFAULT_SETTINGS, fetchFn: f }), /SAFETY/);
});

test("Groq/Ollama (OpenAI format): tools, tool_calls and tool messages", async () => {
  const f = fakeFetch([[(u) => u.endsWith("/chat/completions"), () => ({
    json: { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_9", type: "function", function: { name: "wikipedia", arguments: "{\"topic\":\"Kuvempu\"}" } }] } }] },
  })]]);
  const r = await callOpenAICompatible({
    baseUrl: "https://api.groq.com/openai/v1", apiKey: "gsk_test", model: "llama-3.3-70b-versatile", system: "S", tools, settings: DEFAULT_SETTINGS, fetchFn: f,
    conversation: [
      { role: "user", text: "who is kuvempu" },
      { role: "assistant", text: "", toolCalls: [{ id: "c0", name: "get_time_date", args: {} }] },
      { role: "tool", id: "c0", name: "get_time_date", result: { time: "08:00" } },
    ],
  });
  const body = f.calls[0].body;
  assert.equal(f.calls[0].options.headers.Authorization, "Bearer gsk_test");
  assert.equal(body.messages[0].role, "system");
  assert.equal(body.messages[2].tool_calls[0].function.name, "get_time_date");
  assert.equal(body.messages[3].role, "tool");
  assert.equal(body.messages[3].tool_call_id, "c0");
  assert.equal(body.tools[0].type, "function");
  assert.deepEqual(r.toolCalls[0], { id: "call_9", name: "wikipedia", args: { topic: "Kuvempu" } });
});

test("fallback chain: 429 is retried once, then the next model answers", async () => {
  let n = 0;
  const f = fakeFetch([
    [(u) => u.includes("gemini-flash-lite-latest"), () => { n++; return { status: 429, json: { error: "quota" } }; }],
    [(u) => u.includes("gemini-flash-latest"), () => geminiText("hello from model 2")],
  ]);
  const brain = new Brain({ ...DEFAULT_SETTINGS, geminiKey: "K" }, { fetchFn: f, sleep: noSleep });
  const r = await brain.chat("S", [{ role: "user", text: "hi" }], []);
  assert.equal(n, 2, "first model tried twice (one retry)");
  assert.equal(r.text, "hello from model 2");
  assert.equal(brain.lastUsed, "gemini / gemini-flash-latest");
});

test("fallback chain: Gemini fails completely -> Groq answers", async () => {
  const f = fakeFetch([
    [(u) => u.includes("generativelanguage"), () => ({ status: 400, json: { error: { message: "API key not valid" } } })],
    [(u) => u.includes("api.groq.com"), () => ({ json: { choices: [{ message: { content: "groq here" } }] } })],
  ]);
  const brain = new Brain({ ...DEFAULT_SETTINGS, geminiKey: "BAD", groqKey: "G" }, { fetchFn: f, sleep: noSleep });
  const r = await brain.chat("S", [{ role: "user", text: "hi" }], []);
  assert.equal(r.text, "groq here");
  assert.equal(brain.lastUsed, "groq / llama-3.3-70b-versatile");
});

test("no keys at all -> friendly message", async () => {
  const brain = new Brain({ ...DEFAULT_SETTINGS }, { fetchFn: fakeFetch([]), sleep: noSleep });
  await assert.rejects(brain.chat("S", [{ role: "user", text: "hi" }], []), /paste your free Gemini key/);
});

test("every provider rate-limited -> explains the free limit", async () => {
  const f = fakeFetch([[() => true, () => ({ status: 429, json: { error: "RESOURCE_EXHAUSTED" } })]]);
  const brain = new Brain({ ...DEFAULT_SETTINGS, geminiKey: "K" }, { fetchFn: f, sleep: noSleep });
  await assert.rejects(brain.chat("S", [{ role: "user", text: "hi" }], []), /free limit/);
});

test("Ollama uses the local /v1 endpoint with no key", async () => {
  const f = fakeFetch([[(u) => u === "http://localhost:11434/v1/chat/completions", () => ({ json: { choices: [{ message: { content: "offline hi" } }] } })]]);
  const brain = new Brain({ ...DEFAULT_SETTINGS, useOllama: true }, { fetchFn: f, sleep: noSleep });
  const r = await brain.chat("S", [{ role: "user", text: "hi" }], []);
  assert.equal(r.text, "offline hi");
  assert.equal(f.calls[0].options.headers.Authorization, undefined);
});
