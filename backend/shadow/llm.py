"""llm.py - the BRAIN connection.

An LLM (Large Language Model) is a program that reads text and writes text.
We do not run Gemini or Llama ourselves; we SEND our messages to them over
the internet (or to Ollama on our own laptop) and get their reply back.

All three providers follow the same idea:
    we send  -> a list of messages  [{"role": "user", "content": "hi"}, ...]
    we get   -> one reply as text

Each provider wants a slightly different JSON format, so we write one small
function per provider and hide the differences behind ONE method:

        brain = LLMClient(config)
        reply_text = brain.chat(messages)

If a provider fails (no key, no internet, free limit reached) chat() moves on
to the next model / provider automatically. This is called a "fallback chain".

We use plain HTTP requests (the `requests` library) instead of each company's
SDK so you can SEE exactly what is sent - great for understanding and viva.
"""

import time

import requests


class LLMError(Exception):
    """Raised when a provider cannot give us an answer."""


class RetryableError(LLMError):
    """A temporary error (429 / 503) that is worth retrying once."""


class LLMClient:
    def __init__(self, config, session=None):
        self.config = config
        # A Session re-uses the internet connection (faster). Tests pass a fake one.
        self.http = session or requests.Session()
        self.last_used = None          # e.g. "gemini / gemini-2.5-flash" (shown in the UI)

    # ------------------------------------------------------------------ public
    def chat(self, messages, json_mode=True):
        """Send messages to the first working provider and return its text reply.

        messages : list of {"role": "system"|"user"|"assistant", "content": str}
        json_mode: ask the model to reply with pure JSON (the agent needs this)
        """
        errors = []
        for provider in self.config["provider_order"]:
            if not self._is_configured(provider):
                errors.append(f"{provider}: not set up (no API key)")
                continue
            for model in self.config.get(f"{provider}_models", []):
                try:
                    text = self._call_with_retry(provider, model, messages, json_mode)
                    self.last_used = f"{provider} / {model}"
                    return text
                except LLMError as e:
                    errors.append(f"{provider}/{model}: {e}")
        # Every provider failed: raise ONE error that lists every reason.
        raise LLMError("No AI provider answered. " + " | ".join(errors))

    # ----------------------------------------------------------------- helpers
    def _is_configured(self, provider):
        """Gemini and Groq need a key. Ollama needs no key (it runs locally)."""
        if provider == "gemini":
            return bool(self.config.get("gemini_api_key"))
        if provider == "groq":
            return bool(self.config.get("groq_api_key"))
        return provider == "ollama"

    def _call_with_retry(self, provider, model, messages, json_mode):
        """Call a provider; if it says "too many requests" (429) or "busy" (503),
        wait a moment and try ONE more time before giving up on this model."""
        call = {"gemini": self._gemini, "groq": self._groq, "ollama": self._ollama}[provider]
        for attempt in range(2):
            try:
                return call(model, messages, json_mode)
            except RetryableError as e:
                if attempt == 0:
                    time.sleep(2)            # simple back-off before retrying
                    continue
                raise LLMError(str(e))

    def _post(self, url, payload, headers):
        """Send a POST request and turn network problems into clear errors."""
        try:
            r = self.http.post(url, json=payload, headers=headers,
                               timeout=self.config["request_timeout"])
        except requests.exceptions.ConnectionError:
            raise LLMError("cannot connect (no internet, or the server is not running)")
        except requests.exceptions.Timeout:
            raise LLMError("timed out")
        if r.status_code in (429, 500, 503):
            # 429 = free-tier limit / too fast, 5xx = server busy -> worth one retry
            raise RetryableError(f"HTTP {r.status_code}: {r.text[:200]}")
        if r.status_code != 200:
            raise LLMError(f"HTTP {r.status_code}: {r.text[:200]}")
        return r.json()

    # ---------------------------------------------------------------- Gemini
    def _gemini(self, model, messages, json_mode):
        """Google Gemini REST API (free key from aistudio.google.com).

        Gemini's format differences:
          * the system prompt goes in a separate "systemInstruction" field
          * the assistant's role is called "model" instead of "assistant"
          * text goes inside  "parts": [{"text": ...}]
        """
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        system_text = "\n".join(m["content"] for m in messages if m["role"] == "system")
        contents = []
        for m in messages:
            if m["role"] == "system":
                continue
            role = "model" if m["role"] == "assistant" else "user"
            contents.append({"role": role, "parts": [{"text": m["content"]}]})

        gen_config = {
            "temperature": self.config["temperature"],
            "maxOutputTokens": self.config["max_output_tokens"],
        }
        if json_mode:
            gen_config["responseMimeType"] = "application/json"

        payload = {"contents": contents, "generationConfig": gen_config}
        if system_text:
            payload["systemInstruction"] = {"parts": [{"text": system_text}]}

        # The key travels in a header, read from .env - never typed in the code.
        headers = {"x-goog-api-key": self.config["gemini_api_key"]}
        data = self._post(url, payload, headers)

        # Dig the text out of the reply. It can be empty if the answer was
        # blocked for safety or cut off, so we check carefully.
        candidates = data.get("candidates") or []
        if not candidates:
            reason = data.get("promptFeedback", {}).get("blockReason", "empty reply")
            raise LLMError(f"Gemini gave no answer ({reason})")
        parts = candidates[0].get("content", {}).get("parts", [])
        text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
        if not text.strip():
            raise LLMError(f"Gemini reply was empty (finishReason={candidates[0].get('finishReason')})")
        return text

    # ------------------------------------------------------------------ Groq
    def _groq(self, model, messages, json_mode):
        """Groq API (free key from console.groq.com). It copies OpenAI's format,
        so the messages list can be sent almost exactly as it is."""
        url = "https://api.groq.com/openai/v1/chat/completions"
        payload = {
            "model": model,
            "messages": messages,
            "temperature": self.config["temperature"],
            "max_tokens": self.config["max_output_tokens"],
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        headers = {"Authorization": f"Bearer {self.config['groq_api_key']}"}
        data = self._post(url, payload, headers)
        try:
            return data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError):
            raise LLMError("Groq reply had an unexpected format")

    # ---------------------------------------------------------------- Ollama
    def _ollama(self, model, messages, json_mode):
        """Ollama runs a model on YOUR computer (no key, works offline).
        Install from ollama.com, then:  ollama pull qwen2.5:3b"""
        url = self.config["ollama_url"].rstrip("/") + "/api/chat"
        payload = {
            "model": model,
            "messages": messages,
            "stream": False,                 # give us the whole reply at once
            "options": {"temperature": self.config["temperature"]},
        }
        if json_mode:
            payload["format"] = "json"       # forces valid JSON output
        data = self._post(url, payload, headers={})
        if "error" in data:
            raise LLMError(f"Ollama: {data['error']}")
        return data.get("message", {}).get("content", "")
