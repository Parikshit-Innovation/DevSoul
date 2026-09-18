"""Live tests against Gemini API — marked @pytest.mark.live.

Runs only when GEMINI_API_KEY is configured in the environment or .env.
"""
from __future__ import annotations

import pytest
import ri.config as cfg


@pytest.mark.live
def test_gemini_live_health_check():
    if not cfg.has_api_key():
        pytest.skip("GEMINI_API_KEY not set")

    from ri.llm.gemini_client import GeminiClient
    client = GeminiClient(api_key=cfg.GEMINI_API_KEY, model=cfg.GEMINI_MODEL)
    res = client.complete_detailed('Reply with JSON: {"ok": true}', schema={"ok": True}, task="live_check")
    assert res.data is not None
    assert res.data.get("ok") is True
    assert res.latency_ms > 0
    assert res.total_tokens > 0


@pytest.mark.live
def test_gemini_live_idea_analysis():
    if not cfg.has_api_key():
        pytest.skip("GEMINI_API_KEY not set")

    from ri.llm.gemini_client import GeminiClient
    from ri.pipeline import idea_analyzer
    client = GeminiClient(api_key=cfg.GEMINI_API_KEY, model=cfg.GEMINI_MODEL)
    analysis = idea_analyzer.analyze(
        idea="Build a real-time collaborative code editor in the browser with WebSockets.",
        llm=client,
        allowed_topics=["users", "auth", "data_model", "deployment", "scale"],
    )
    assert "name" in analysis and analysis["name"]
    assert "summary" in analysis and analysis["summary"]
    assert isinstance(analysis["seed_requirements"], list)
