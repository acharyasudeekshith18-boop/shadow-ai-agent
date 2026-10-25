// LIVE check: calls the REAL free APIs (needs internet, no keys).
// Run:  node tests/live/live-tools.mjs
import { runTool } from "../../js/tools.js";
import { Memory } from "../../js/memory.js";
import { FakeStorage } from "../helpers.js";

const ctx = { fetch, memory: new Memory(new FakeStorage()), ui: { openUrl() {} }, navigator: {} };
const checks = [
  ["get_weather", { city: "Shivamogga" }, (r) => typeof r.temperature_c === "number"],
  ["wikipedia", { topic: "Kuvempu University" }, (r) => /university/i.test(r.summary || "")],
  ["web_search", { query: "what is an AI agent" }, (r) => (r.results || []).length > 0],
  ["calculator", { expression: "(1200*18)/100" }, (r) => r.result === 216],
  ["get_time_date", {}, (r) => Boolean(r.time)],
];
let failed = 0;
for (const [name, args, ok] of checks) {
  const r = await runTool(name, args, ctx);
  const pass = ok(r);
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}(${JSON.stringify(args)})\n      ${JSON.stringify(r).slice(0, 230)}`);
}
process.exit(failed ? 1 : 0);
