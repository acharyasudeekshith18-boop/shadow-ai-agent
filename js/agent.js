// =====================================================================
// agent.js  -  the AGENT LOOP (this is what makes Shadow an "agent")
// ---------------------------------------------------------------------
// A chatbot does:   question -> AI -> answer.
// An AGENT does a loop (called ReAct = Reason + Act):
//
//     1. THINK    The AI reads the question + the list of tools.
//     2. ACT      If it needs information or an action, it replies with a
//                 tool call, e.g.  get_weather({city: "Mysuru"})
//     3. OBSERVE  Our code runs the tool and gives the AI the result.
//     4. REPEAT   The AI may call more tools (search, then calculate...)
//     5. ANSWER   When it has enough, it replies with normal text.
//
// maxSteps stops the loop if the AI keeps calling tools forever.
// onStep() reports every step to the screen, so you can SEE it reasoning.
// =====================================================================

import { tools as ALL_TOOLS, runTool } from "./tools.js";

export function buildSystemPrompt(settings, memory, now = new Date()) {
  const facts = memory.facts();
  return [
    `You are ${settings.assistantName}, a personal AI assistant agent for ${settings.userName}.`,
    `Personality: calm, smart, a little witty, loyal. Call the user "${settings.userName}".`,
    `Current date and time: ${now.toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" })}.`,
    `The user's home city is ${settings.city}.`,
    "",
    "HOW TO WORK:",
    "- You have tools. Use a tool whenever it gives a better answer than guessing:",
    "  live facts (weather, time), maths (always use the calculator), lookups (wikipedia, web_search),",
    "  actions (open websites, play YouTube, notes, reminders) and memory (remember_fact).",
    "- For ANY question about a person, place, event or fact, call wikipedia or web_search FIRST.",
    "  Do not answer factual questions from your own memory: it may be wrong.",
    "- For ANY calculation, call the calculator, even for easy sums.",
    "- You may call several tools one after another. Read each tool result before deciding the next step.",
    "- If a tool returns an error, try another way or explain the problem honestly. Never invent results.",
    "- When the user tells you something personal or says 'remember', call remember_fact.",
    "",
    "HOW TO ANSWER:",
    "- Your answer is read aloud, so write the way a person speaks: short, clear sentences,",
    "  no markdown, no tables, no bullet symbols, no emojis.",
    "- Answer the actual question fully, usually in 1 to 4 sentences. Give more detail only if asked.",
    "",
    facts.length ? `THINGS YOU KNOW ABOUT ${settings.userName.toUpperCase()} (long-term memory):\n- ${facts.join("\n- ")}` : "You don't know any personal facts about the user yet.",
  ].join("\n");
}

/**
 * Run the agent for one user message.
 * @param userText  what the user said or typed
 * @param brain     a Brain from llm.js (talks to Gemini / Groq / Ollama)
 * @param memory    a Memory from memory.js
 * @param settings  the settings object
 * @param ctx       things the tools need: { fetch, ui, navigator, screen }
 * @param onStep    function called with each step, to show it on screen
 * @returns the final answer text
 */
export async function runAgent({ userText, brain, memory, settings, ctx, onStep = () => {}, tools = ALL_TOOLS }) {
  const system = buildSystemPrompt(settings, memory);

  // Start the conversation with recent history (short-term memory) + the new message.
  const conversation = memory.history().map((h) => ({ role: h.role, text: h.text }));
  conversation.push({ role: "user", text: userText });

  for (let step = 1; step <= settings.maxSteps; step++) {
    // ---- 1. THINK: ask the brain what to do next
    onStep({ type: "thinking", step });
    const reply = await brain.chat(system, conversation, tools);
    onStep({ type: "brain", step, provider: brain.lastUsed });

    // Remember exactly what the AI said (needed for the next round).
    conversation.push({ role: "assistant", text: reply.text, toolCalls: reply.toolCalls, geminiParts: reply.geminiParts });

    // ---- 5. ANSWER: no tool calls means the AI is done
    if (!reply.toolCalls || reply.toolCalls.length === 0) {
      return finish(memory, userText, reply.text, onStep, step);
    }

    // Some models write a short plan before calling tools: show it as a "thought".
    if (reply.text) onStep({ type: "thought", step, text: reply.text });

    // ---- 2 + 3. ACT and OBSERVE: run every tool the AI asked for
    for (const call of reply.toolCalls) {
      onStep({ type: "action", step, name: call.name, args: call.args });
      const result = await runTool(call.name, call.args, { ...ctx, memory, settings });
      onStep({ type: "observation", step, name: call.name, result });
      conversation.push({ role: "tool", id: call.id, name: call.name, result });
    }
    // ---- 4. REPEAT: loop back so the AI can read the results
  }

  // Safety net: too many steps. Ask for a final answer WITHOUT tools.
  onStep({ type: "thought", step: settings.maxSteps, text: "Step limit reached, answering with what I have." });
  conversation.push({ role: "user", text: "Stop using tools now and give your best final answer." });
  const last = await brain.chat(system, conversation, []);
  return finish(memory, userText, last.text, onStep, settings.maxSteps + 1);
}

function finish(memory, userText, answer, onStep, step) {
  const text = answer || "Sorry, I couldn't come up with an answer.";
  // Save the exchange to short-term memory (history).
  memory.addToHistory("user", userText);
  memory.addToHistory("assistant", text);
  onStep({ type: "answer", step, text });
  return text;
}
