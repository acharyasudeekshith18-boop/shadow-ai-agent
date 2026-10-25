// Tests for the agent loop (agent.js) using a FAKE brain - no API key needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgent, buildSystemPrompt } from "../js/agent.js";
import { Memory } from "../js/memory.js";
import { DEFAULT_SETTINGS } from "../js/settings.js";
import { FakeStorage } from "./helpers.js";

// A fake brain that returns pre-written replies, one per call, and records
// the conversation it was given each time.
function scriptedBrain(replies) {
  return {
    lastUsed: "fake / test-model",
    seen: [],
    async chat(system, conversation, tools) {
      this.seen.push({ system, conversation: structuredClone(conversation), toolNames: tools.map((t) => t.name) });
      const r = replies.shift();
      if (!r) throw new Error("brain called too many times");
      return r;
    },
  };
}

const ctx = { fetch: null, ui: { openUrl() {} } };

test("agent calls a tool, reads the observation, then answers", async () => {
  const memory = new Memory(new FakeStorage());
  const brain = scriptedBrain([
    { text: "", toolCalls: [{ id: "c1", name: "calculator", args: { expression: "18% * 2500".replace("%", "/100") } }] },
    { text: "18 percent of 2500 is 450.", toolCalls: [] },
  ]);
  const steps = [];
  const answer = await runAgent({ userText: "what is 18% of 2500", brain, memory, settings: DEFAULT_SETTINGS, ctx, onStep: (s) => steps.push(s) });

  assert.equal(answer, "18 percent of 2500 is 450.");
  // The second brain call must contain the tool result (the OBSERVE step).
  const second = brain.seen[1].conversation;
  const toolMsg = second.find((m) => m.role === "tool");
  assert.equal(toolMsg.name, "calculator");
  assert.equal(toolMsg.result.result, 450);
  // Steps shown on screen, in ReAct order.
  assert.deepEqual(steps.map((s) => s.type), ["thinking", "brain", "action", "observation", "thinking", "brain", "answer"]);
  // Short-term memory saved the exchange.
  assert.deepEqual(memory.history().map((h) => h.role), ["user", "assistant"]);
});

test("agent can chain two tools (remember a fact, then take a note)", async () => {
  const memory = new Memory(new FakeStorage());
  const brain = scriptedBrain([
    { text: "I'll save both.", toolCalls: [{ id: "a", name: "remember_fact", args: { fact: "User's birthday is 12 March" } }] },
    { text: "", toolCalls: [{ id: "b", name: "take_note", args: { text: "Buy cake" } }] },
    { text: "Done, Boss.", toolCalls: [] },
  ]);
  const steps = [];
  await runAgent({ userText: "remember my birthday is 12 March and note buy cake", brain, memory, settings: DEFAULT_SETTINGS, ctx, onStep: (s) => steps.push(s) });
  assert.deepEqual(memory.facts(), ["User's birthday is 12 March"]);
  assert.equal(memory.notes()[0].text, "Buy cake");
  assert.ok(steps.some((s) => s.type === "thought" && s.text === "I'll save both."));
});

test("long-term facts are put into the system prompt", () => {
  const memory = new Memory(new FakeStorage());
  memory.addFact("User studies BCA at Kuvempu University");
  const p = buildSystemPrompt({ ...DEFAULT_SETTINGS, userName: "Sudeekshith" }, memory);
  assert.match(p, /BCA at Kuvempu University/);
  assert.match(p, /Sudeekshith/);
});

test("a broken/unknown tool does not crash the agent", async () => {
  const memory = new Memory(new FakeStorage());
  const brain = scriptedBrain([
    { text: "", toolCalls: [{ id: "x", name: "hack_nasa", args: {} }] },
    { text: "I can't do that.", toolCalls: [] },
  ]);
  const answer = await runAgent({ userText: "hack nasa", brain, memory, settings: DEFAULT_SETTINGS, ctx });
  assert.equal(answer, "I can't do that.");
  assert.match(brain.seen[1].conversation.at(-1).result.error, /no tool named hack_nasa/);
});

test("step limit stops an endless tool loop and asks for a final answer", async () => {
  const memory = new Memory(new FakeStorage());
  const loop = { text: "", toolCalls: [{ id: "t", name: "get_time_date", args: {} }] };
  const settings = { ...DEFAULT_SETTINGS, maxSteps: 3 };
  const brain = scriptedBrain([loop, loop, loop, { text: "It is morning.", toolCalls: [] }]);
  const answer = await runAgent({ userText: "time?", brain, memory, settings, ctx });
  assert.equal(answer, "It is morning.");
  assert.equal(brain.seen.length, 4);
  assert.deepEqual(brain.seen[3].toolNames, []); // last call has NO tools
});

test("chat history (short-term memory) is sent with the next question", async () => {
  const memory = new Memory(new FakeStorage());
  memory.addToHistory("user", "weather in Mysuru?");
  memory.addToHistory("assistant", "It's 27 degrees in Mysuru.");
  const brain = scriptedBrain([{ text: "Tomorrow looks similar.", toolCalls: [] }]);
  await runAgent({ userText: "and tomorrow?", brain, memory, settings: DEFAULT_SETTINGS, ctx });
  assert.deepEqual(brain.seen[0].conversation.map((m) => m.text), ["weather in Mysuru?", "It's 27 degrees in Mysuru.", "and tomorrow?"]);
});
