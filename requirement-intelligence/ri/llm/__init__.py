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
    from ri.llm.ollama_client import OllamaClient
    from ri.llm.base import ExhaustedError
    import logging

    logger = logging.getLogger(__name__)

    class FallbackClient(BaseLLM):
        def __init__(self, primary: BaseLLM, fallback: BaseLLM):
            self.primary = primary
            self.fallback = fallback
            self.circuit_broken = False

        def complete(self, prompt: str, schema: dict | type | None = None, task: str = "generic") -> dict | None:
            res = self.complete_detailed(prompt, schema=schema, task=task)
            return res.data if res else None

        def complete_detailed(self, prompt: str, schema: dict | type | None = None, task: str = "generic"):
            if self.circuit_broken:
                if hasattr(self.fallback, "complete_detailed"):
                    return self.fallback.complete_detailed(prompt, schema=schema, task=task)
                else:
                    return getattr(self.fallback, "complete")(prompt, schema=schema, task=task)

            try:
                # Try primary first
                if hasattr(self.primary, "complete_detailed"):
                    return self.primary.complete_detailed(prompt, schema=schema, task=task)
                else:
                    return getattr(self.primary, "complete")(prompt, schema=schema, task=task)
            except ExhaustedError as exc:
                logger.warning("[ri/fallback] Primary LLM exhausted (%s). Breaking circuit and permanently falling back to Ollama.", exc)
                self.circuit_broken = True
                if hasattr(self.fallback, "complete_detailed"):
                    return self.fallback.complete_detailed(prompt, schema=schema, task=task)
                else:
                    return getattr(self.fallback, "complete")(prompt, schema=schema, task=task)

    if not cfg.GEMINI_API_KEY:
        raise RuntimeError(
            "GEMINI_API_KEY is not set. Copy .env.example to .env and add your key, "
            "or set RI_MOCK=true to use the offline mock."
        )
    
    primary = GeminiClient(api_key=cfg.GEMINI_API_KEY, model=cfg.GEMINI_MODEL)
    fallback = OllamaClient(model=cfg.OLLAMA_MODEL)
    
    return FallbackClient(primary, fallback)
