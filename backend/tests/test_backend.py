"""Backend tests with a FAKE brain (no keys, no internet).  Run:  pytest -q"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from shadow import memory                                   # noqa: E402
from shadow.agent import parse_json_reply, run_agent        # noqa: E402
from shadow.config import DEFAULTS                          # noqa: E402
from shadow.llm import LLMClient, LLMError                  # noqa: E402
from shadow.tools import TOOLS, run_tool                    # noqa: E402


class FakeBrain:
    """Returns pre-written replies, one per call."""
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []
        self.last_used = "fake"

    def chat(self, messages, json_mode=True):
        self.calls.append([dict(m) for m in messages])
        return self.replies.pop(0)


@pytest.fixture(autouse=True)
def store(tmp_path):
    s = memory.MemoryStore(str(tmp_path / "test.db"))
    memory.set_store(s)
    return s


CONFIG = dict(DEFAULTS, gemini_api_key="", groq_api_key="")


def test_agent_uses_tool_then_answers():
    brain = FakeBrain([
        json.dumps({"thought": "need maths", "action": "calculator", "action_input": {"expression": "18*25"}}),
        json.dumps({"thought": "done", "final_answer": "18 times 25 is 450."}),
    ])
    answer, steps = run_agent("what is 18 x 25", brain, CONFIG, on_step=lambda s: None)
    assert answer == "18 times 25 is 450."
    assert [s["type"] for s in steps] == ["thought", "action", "observation", "thought", "answer"]
    # The observation was sent back to the model on the 2nd call
    assert brain.calls[1][-1]["content"] == "Observation: 18*25 = 450"


def test_remember_fact_goes_into_next_prompt(store):
    brain = FakeBrain([
        '{"action": "remember_fact", "action_input": {"fact": "Birthday is 12 March"}}',
        '{"final_answer": "Got it."}',
        '{"final_answer": "Your birthday is 12 March."}',
    ])
    run_agent("remember my birthday is 12 March", brain, CONFIG, on_step=lambda s: None)
    assert store.facts() == ["Birthday is 12 March"]
    run_agent("when is my birthday?", brain, CONFIG, on_step=lambda s: None)
    assert "Birthday is 12 March" in brain.calls[2][0]["content"]       # system prompt has the fact
    assert any(m["content"] == "remember my birthday is 12 March" for m in brain.calls[2])  # history


def test_parse_json_reply_handles_messy_output():
    assert parse_json_reply('```json\n{"final_answer": "hi"}\n```') == {"final_answer": "hi"}
    assert parse_json_reply('Sure! {"action": "get_time_date", "action_input": {}} hope that helps') == \
        {"action": "get_time_date", "action_input": {}}
    assert parse_json_reply("no json here") is None


def test_non_json_reply_is_used_as_answer():
    brain = FakeBrain(["Hello Boss!"])
    answer, _ = run_agent("hi", brain, CONFIG, on_step=lambda s: None)
    assert answer == "Hello Boss!"


def test_missing_action_is_nudged_not_run():
    brain = FakeBrain(['{"thought": "nothing to do", "action": null}', '{"final_answer": "Okay!"}'])
    answer, steps = run_agent("thanks", brain, CONFIG, on_step=lambda s: None)
    assert answer == "Okay!"
    assert not any(s["type"] == "action" for s in steps)
    assert "final_answer" in brain.calls[1][-1]["content"]


def test_step_limit():
    loop = '{"action": "get_time_date", "action_input": {}}'
    brain = FakeBrain([loop] * 10)
    answer, _ = run_agent("loop", brain, dict(CONFIG, agent_max_steps=3), on_step=lambda s: None)
    assert "too many steps" in answer
    assert len(brain.calls) == 3


def test_tools_safe_and_correct():
    assert set(TOOLS) >= {"calculator", "get_weather", "wikipedia", "web_search", "take_note", "remember_fact"}
    assert run_tool("calculator", {"expression": "2^10"}) == "2^10 = 1024"
    assert run_tool("calculator", {"expression": "__import__('os').system('ls')"}).startswith("ERROR")
    assert run_tool("nope", {}).startswith("ERROR: there is no tool")
    assert "CPU usage" in run_tool("system_info", {})
    assert run_tool("take_note", {"text": "buy milk"}) == "Note saved. You have 1 notes."


def test_weather_tool_with_fake_http(monkeypatch):
    class R:
        def __init__(self, data): self.data = data
        def json(self): return self.data

    def fake_get(url, params=None, **kw):
        if "geocoding" in url:
            return R({"results": [{"name": "Mysuru", "latitude": 12.3, "longitude": 76.6}]})
        return R({"current": {"temperature_2m": 27, "relative_humidity_2m": 60, "weather_code": 0, "wind_speed_10m": 5}})
    monkeypatch.setattr("shadow.tools.web_tools.requests.get", fake_get)
    assert run_tool("get_weather", {"city": "Mysuru"}).startswith("Mysuru: 27°C, clear sky")


def test_llm_fallback_gemini_429_then_groq():
    class Resp:
        def __init__(self, code, data): self.status_code, self._d, self.text = code, data, json.dumps(data)
        def json(self): return self._d

    class Session:
        def __init__(self): self.urls = []
        def post(self, url, json=None, headers=None, timeout=None):
            self.urls.append(url)
            if "generativelanguage" in url:
                return Resp(429, {"error": "quota"})
            return Resp(200, {"choices": [{"message": {"content": "{\"final_answer\": \"hi\"}"}}]})

    import shadow.llm as llm
    llm.time.sleep = lambda s: None   # don't really wait in tests
    s = Session()
    client = LLMClient(dict(CONFIG, gemini_api_key="K", groq_api_key="G"), session=s)
    assert client.chat([{"role": "user", "content": "hi"}]) == '{"final_answer": "hi"}'
    assert client.last_used == "groq / llama-3.3-70b-versatile"
    assert sum("generativelanguage" in u for u in s.urls) == 4   # 2 models x (1 try + 1 retry)


def test_llm_no_provider():
    client = LLMClient(dict(CONFIG, provider_order=["gemini"]))
    with pytest.raises(LLMError):
        client.chat([{"role": "user", "content": "hi"}])


def test_fastapi_endpoints(monkeypatch, tmp_path):
    monkeypatch.chdir(Path(__file__).resolve().parent.parent)
    import app as backend_app
    from fastapi.testclient import TestClient
    backend_app.brain = FakeBrain(['{"final_answer": "Hello from the API"}'])
    memory.set_store(memory.MemoryStore(str(tmp_path / "api.db")))
    client = TestClient(backend_app.app)
    assert client.get("/api/health").json()["ok"] is True
    r = client.post("/api/chat", json={"message": "hi"}).json()
    assert r["answer"] == "Hello from the API"
