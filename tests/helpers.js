// Test helpers: a fake localStorage and a fake fetch, so tests run in Node
// with no browser and no internet.
export class FakeStorage {
  constructor() { this.data = new Map(); }
  getItem(k) { return this.data.has(k) ? this.data.get(k) : null; }
  setItem(k, v) { this.data.set(k, String(v)); }
  removeItem(k) { this.data.delete(k); }
}

// fakeFetch(routes): routes is a list of [testFn(url, options), responseFn(url, options)].
// Every call is recorded in fetch.calls so tests can check what was sent.
export function fakeFetch(routes) {
  const f = async (url, options = {}) => {
    f.calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    for (const [match, respond] of routes) {
      if (match(url, options)) {
        const r = await respond(url, options);
        const status = r.status || 200;
        return { ok: status < 400, status, json: async () => r.json, text: async () => JSON.stringify(r.json ?? r.text ?? "") };
      }
    }
    throw new Error(`no fake route for ${url}`);
  };
  f.calls = [];
  return f;
}
