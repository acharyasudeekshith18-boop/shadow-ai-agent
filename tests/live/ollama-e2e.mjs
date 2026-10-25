// LIVE end-to-end test with a REAL local model through Ollama (no key).
// Needs:  ollama pull qwen2.5:3b   (and Ollama running)
// Run:    node tests/live/ollama-e2e.mjs
// This uses the SAME OpenAI-compatible code path as Groq.
import { runAgent } from "../../js/agent.js";
import { Brain } from "../../js/llm.js";
import { Memory } from "../../js/memory.js";
import { DEFAULT_SETTINGS } from "../../js/settings.js";
import { FakeStorage } from "../helpers.js";

const settings = { ...DEFAULT_SETTINGS, providerOrder: ["ollama"], useOllama: true, userName: "Sudeekshith", models: { ...DEFAULT_SETTINGS.models, ollama: [process.env.OLLAMA_MODEL || "qwen2.5:3b"] } };
const memory = new Memory(new FakeStorage());
const brain = new Brain(settings);
const ctx = { fetch, ui: { openUrl: (u) => console.log("      (would open)", u) }, navigator: {} };

const questions = process.argv.slice(2).length ? process.argv.slice(2) : [
  "What's the weather in Shivamogga right now?",
  "What is 18% of 2500?",
  "Remember that my birthday is 12 March.",
  "Who was Kuvempu? Answer in two sentences.",
  "When is my birthday?",
];
for (const q of questions) {
  console.log(`\nUSER: ${q}`);
  const t0 = Date.now();
  const answer = await runAgent({
    userText: q, brain, memory, settings, ctx,
    onStep: (s) => {
      if (s.type === "action") console.log(`  ACT     ${s.name}(${JSON.stringify(s.args)})`);
      if (s.type === "observation") console.log(`  OBSERVE ${JSON.stringify(s.result).slice(0, 160)}`);
      if (s.type === "thought") console.log(`  THINK   ${s.text.slice(0, 160)}`);
    },
  });
  console.log(`SHADOW (${((Date.now() - t0) / 1000).toFixed(1)}s): ${answer}`);
}
console.log("\nFacts in memory:", memory.facts());
