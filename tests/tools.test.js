// Tests for every tool (tools.js). Network calls use a fake fetch that returns
// sample responses shaped like the real APIs (live checks: tests/live/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { runTool, calculate, siteToUrl, reminderTime, tools } from "../js/tools.js";
import { Memory } from "../js/memory.js";
import { FakeStorage, fakeFetch } from "./helpers.js";

const baseCtx = () => {
  const opened = [];
  return { opened, memory: new Memory(new FakeStorage()), ui: { openUrl: (u) => opened.push(u) } };
};

test("there are 14 tools and each has a name, description and JSON schema", () => {
  assert.equal(tools.length, 14);
  for (const t of tools) {
    assert.match(t.name, /^[a-z_]+$/);
    assert.ok(t.description.length > 10);
    assert.equal(t.parameters.type, "object");
  }
});

test("calculator: maths is right", () => {
  assert.equal(calculate("2+3*4"), 14);
  assert.equal(calculate("(2+3)*4"), 20);
  assert.equal(calculate("2^10"), 1024);
  assert.equal(calculate("sqrt(16)+10%3"), 5);
  assert.equal(calculate("0.1+0.2"), 0.3);
  assert.equal(calculate("-5+2"), -3);
  assert.equal(calculate("1,000 x 3"), 3000);
  assert.equal(calculate("sin(30)"), 0.5);
});

test("calculator: refuses code (injection) and bad input", () => {
  assert.throws(() => calculate("alert(1)"), /unknown symbol/);
  assert.throws(() => calculate("fetch('http://x')"), /only numbers/);
  assert.throws(() => calculate("1/0"), /finite/);
  assert.throws(() => calculate("(2+3"), /missing \)/);
});

test("time/date tool returns date and time", async () => {
  const r = await runTool("get_time_date", {}, baseCtx());
  assert.ok(r.date && r.time);
});

test("weather tool: geocode then forecast", async () => {
  const f = fakeFetch([
    [(u) => u.includes("geocoding-api"), () => ({ json: { results: [{ name: "Shivamogga", admin1: "Karnataka", country: "India", latitude: 13.93, longitude: 75.57 }] } })],
    [(u) => u.includes("api.open-meteo.com"), () => ({ json: {
      current: { temperature_2m: 26.4, apparent_temperature: 28, relative_humidity_2m: 70, wind_speed_10m: 9, weather_code: 2 },
      daily: { temperature_2m_max: [30], temperature_2m_min: [20], precipitation_probability_max: [40] } } })],
  ]);
  const r = await runTool("get_weather", { city: "Shivamogga" }, { ...baseCtx(), fetch: f });
  assert.equal(r.temperature_c, 26.4);
  assert.equal(r.conditions, "partly cloudy");
  assert.match(f.calls[1].url, /latitude=13.93&longitude=75.57/);
});

test("weather tool: unknown city gives an error message, not a crash", async () => {
  const f = fakeFetch([[() => true, () => ({ json: {} })]]);
  const r = await runTool("get_weather", { city: "Xyzzyville" }, { ...baseCtx(), fetch: f });
  assert.match(r.error, /couldn't find/);
});

test("wikipedia tool: search title then summary", async () => {
  const f = fakeFetch([
    [(u) => u.includes("opensearch"), () => ({ json: ["kuvempu", ["Kuvempu"], [""], [""]] })],
    [(u) => u.includes("page/summary/Kuvempu"), () => ({ json: { title: "Kuvempu", extract: "Kuppali Venkatappa Puttappa, known as Kuvempu, was a Kannada poet.", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Kuvempu" } } } })],
  ]);
  const r = await runTool("wikipedia", { topic: "kuvempu" }, { ...baseCtx(), fetch: f });
  assert.equal(r.title, "Kuvempu");
  assert.match(r.summary, /Kannada poet/);
});

test("web search: DuckDuckGo + Wikipedia results combined; DDG failure tolerated", async () => {
  const f = fakeFetch([
    [(u) => u.includes("duckduckgo"), () => ({ status: 500, json: {} })],
    [(u) => u.includes("list=search"), () => ({ json: { query: { search: [{ title: "Python (programming language)", snippet: "<span>Python</span> is a language" }] } } })],
  ]);
  const r = await runTool("web_search", { query: "python" }, { ...baseCtx(), fetch: f });
  assert.equal(r.results[0].source, "Wikipedia");
  assert.equal(r.results[0].text, "Python is a language");
});

test("open_website and play_youtube open the right URLs", async () => {
  const ctx = baseCtx();
  await runTool("open_website", { site: "github" }, ctx);
  await runTool("play_youtube", { query: "kgf bgm" }, ctx);
  assert.deepEqual(ctx.opened, ["https://github.com", "https://www.youtube.com/results?search_query=kgf%20bgm"]);
  assert.equal(siteToUrl("python.org"), "https://python.org");
  assert.equal(siteToUrl("best biryani in mysuru"), "https://www.google.com/search?q=best%20biryani%20in%20mysuru");
});

test("reminders: minutes or HH:MM, saved in memory", async () => {
  const now = new Date(2026, 9, 25, 9, 0, 0);
  assert.equal(reminderTime({ minutes: 10 }, now).getTime(), now.getTime() + 600000);
  assert.equal(reminderTime({ time: "18:30" }, now).getHours(), 18);
  assert.equal(reminderTime({ time: "08:00" }, now).getDate(), 26); // already passed -> tomorrow
  assert.equal(reminderTime({}, now), null);
  const ctx = baseCtx();
  const r = await runTool("set_reminder", { message: "drink water", minutes: 5 }, ctx);
  assert.equal(r.reminder_set, "drink water");
  assert.equal(ctx.memory.pendingReminders().length, 1);
  const list = await runTool("list_reminders", {}, ctx);
  assert.equal(list.reminders[0].message, "drink water");
});

test("notes and memory facts", async () => {
  const ctx = baseCtx();
  await runTool("take_note", { text: "submit project report" }, ctx);
  assert.deepEqual((await runTool("read_notes", {}, ctx)).notes, ["submit project report"]);
  await runTool("remember_fact", { fact: "User's birthday is 12 March" }, ctx);
  await runTool("remember_fact", { fact: "user's birthday is 12 march" }, ctx); // duplicate ignored
  assert.equal(ctx.memory.facts().length, 1);
  const f = await runTool("forget_fact", { fact: "birthday" }, ctx);
  assert.equal(f.forgotten.length, 1);
  assert.equal(ctx.memory.facts().length, 0);
});

test("device_info uses the Battery API when present", async () => {
  const ctx = { ...baseCtx(), navigator: { onLine: true, platform: "Android", getBattery: async () => ({ level: 0.82, charging: false }) }, screen: { width: 412, height: 915 } };
  const r = await runTool("device_info", {}, ctx);
  assert.equal(r.battery_percent, 82);
  assert.equal(r.screen, "412x915");
});

test("runTool never throws, even when a tool crashes", async () => {
  const f = async () => { throw new Error("offline"); };
  const r = await runTool("wikipedia", { topic: "x" }, { ...baseCtx(), fetch: f });
  assert.match(r.error, /wikipedia failed: offline/);
});
