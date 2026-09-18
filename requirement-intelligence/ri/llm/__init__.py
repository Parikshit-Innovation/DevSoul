"""LLM factory — returns the right client based on config."""
from __future__ import annotations

import ri.config as cfg
from ri.llm.base import BaseLLM


def get_llm(mock: bool | None = None) -> BaseLLM:
    """Return a GeminiClient or MockClient.

    Args:
        mock: Override; if None, uses config.use_mock().
    """
    use_mock = mock if mock is not None else cfg.use_mock()

    if use_mock:
        from ri.llm.mock_client import MockClient
        return MockClient()

    from ri.llm.gemini_client import GeminiClient
    if not cfg.GEMINI_API_KEY:
        raise RuntimeError(
            "GEMINI_API_KEY is not set. Copy .env.example to .env and add your key, "
            "or set RI_MOCK=true to use the offline mock."
        )
    return GeminiClient(api_key=cfg.GEMINI_API_KEY, model=cfg.GEMINI_MODEL)
