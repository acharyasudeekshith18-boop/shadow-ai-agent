# Contributing to Shadow

Thanks for wanting to improve Shadow! Anyone can contribute: students, beginners, experts.

## Ways to help
- **Report a bug:** open an [issue](../../issues) with what you did, what you expected, what happened, and your browser/phone.
- **Suggest a feature:** open an issue starting with `Idea:`.
- **Add a tool:** new tools are the easiest contribution (see below).
- **Improve docs or translations** (Kannada, Hindi and other languages are very welcome).

## How to send a change (pull request)
1. **Fork** this repo (button at the top right on GitHub).
2. Clone your fork: `git clone https://github.com/<your-username>/shadow-ai-agent.git`
3. Create a branch: `git checkout -b my-new-tool`
4. Make your change, then run the tests: `npm test` (needs Node.js 18+; no install step needed).
5. Commit with a clear message: `git commit -m "Add currency converter tool"`
6. Push and open a **Pull Request** against `main`. Explain what and why.

## Adding a new tool
Open `js/tools.js` and add an object to the `tools` array:
```js
{
  name: "my_tool",                       // lowercase_with_underscores
  description: "When the AI should use it.",
  parameters: { type: "object", properties: { thing: { type: "string", description: "..." } }, required: ["thing"] },
  run: async ({ thing }, ctx) => ({ result: "..." }),
}
```
Add a test for it in `tests/tools.test.js`. Only use **free APIs that need no key** and allow browser requests (CORS).

## Rules
- **Never commit API keys** or personal data.
- Keep code beginner-readable and commented. This project is used for learning.
- Be kind and respectful in issues and reviews.

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
