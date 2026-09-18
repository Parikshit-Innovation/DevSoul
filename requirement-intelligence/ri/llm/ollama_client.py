"""Ollama client for local fallback."""
from __future__ import annotations

import json
import logging
import time
from typing import Any

import requests

from ri.llm.base import BaseLLM
from ri.llm.gemini_client import CompletionResult

logger = logging.getLogger(__name__)

class OllamaClient(BaseLLM):
    def __init__(self, model: str, base_url: str = "http://localhost:11434") -> None:
        self._model = model
        self._base_url = base_url.rstrip("/")

        # Track usage across the session
        self.total_calls = 0
        self.cumulative_prompt_tokens = 0
        self.cumulative_completion_tokens = 0

    def complete(
        self,
        prompt: str,
        schema: Any = None,
        task: str = "generic",
    ) -> dict[str, Any] | None:
        res = self.complete_detailed(prompt, schema=schema, task=task)
        return res.data

    def complete_detailed(
        self,
        prompt: str,
        schema: Any = None,
        task: str = "generic",
    ) -> CompletionResult:
        self.total_calls += 1
        t_start = time.perf_counter()

        payload = {
            "model": self._model,
            "prompt": prompt,
            "format": "json",
            "stream": False,
        }

        try:
            response = requests.post(
                f"{self._base_url}/api/generate",
                json=payload,
                timeout=120
            )
            response.raise_for_status()
            data = response.json()
            
            raw_text = data.get("response", "")
            
            logger.warning("[ri/ollama] RAW RESPONSE: %s", raw_text)
            
            prompt_tokens = data.get("prompt_eval_count", 0)
            completion_tokens = data.get("eval_count", 0)
            total_tokens = prompt_tokens + completion_tokens

            self.cumulative_prompt_tokens += prompt_tokens
            self.cumulative_completion_tokens += completion_tokens
            
            if not raw_text:
                logger.warning("[ri/ollama] empty response for task=%s", task)
                return CompletionResult(data=None, latency_ms=round((time.perf_counter() - t_start) * 1000, 1), model=self._model)

            parsed = json.loads(raw_text)
            
            return CompletionResult(
                data=parsed,
                latency_ms=round((time.perf_counter() - t_start) * 1000, 1),
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                model=self._model,
            )
            
        except requests.exceptions.RequestException as exc:
            logger.error("[ri/ollama] Network error for task=%s: %s", task, exc)
            return CompletionResult(data=None, latency_ms=round((time.perf_counter() - t_start) * 1000, 1), model=self._model)
        except json.JSONDecodeError as exc:
            logger.error("[ri/ollama] JSON parsing error for task=%s: %s", task, exc)
            return CompletionResult(data=None, latency_ms=round((time.perf_counter() - t_start) * 1000, 1), model=self._model)
        except Exception as exc:
            logger.error("[ri/ollama] Unexpected error for task=%s: %s", task, exc)
            return CompletionResult(data=None, latency_ms=round((time.perf_counter() - t_start) * 1000, 1), model=self._model)

    def print_stats(self) -> None:
        logger.info(
            "[ri/ollama] calls=%d tokens_in=%d tokens_out=%d",
            self.total_calls,
            self.cumulative_prompt_tokens,
            self.cumulative_completion_tokens,
        )
