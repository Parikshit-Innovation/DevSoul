"""Gemini LLM client using google-genai SDK with structured output and retry."""
from __future__ import annotations

from dataclasses import dataclass
import json
import logging
import random
import time
from typing import Any

import google.genai as genai
import google.genai.errors as genai_errors
from google.genai import types as genai_types

from ri.llm.base import BaseLLM, ExhaustedError

logger = logging.getLogger(__name__)

_MAX_ATTEMPTS = 3
_RETRY_CODES = {429, 500, 503}
_NO_RETRY_CODES = {400, 401, 403}
_BASE_BACKOFF = [1.0, 2.0, 4.0]


class AuthenticationError(RuntimeError):
    """Raised when Gemini API authentication fails (HTTP 401 or 403)."""


@dataclass
class CompletionResult:
    data: dict[str, Any] | None
    latency_ms: float
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    model: str = ""


class GeminiClient(BaseLLM):
    """Wraps google-genai to call Gemini with structured JSON output."""

    def __init__(self, api_key: str, model: str = "gemini-2.5-flash", timeout: float = 30.0) -> None:
        self._client = genai.Client(api_key=api_key)
        self._model = model
        self._timeout = timeout
        self.total_calls = 0
        self.total_retries = 0
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
        """Call Gemini with latency and token usage tracking."""
        config_kwargs: dict[str, Any] = {
            "response_mime_type": "application/json",
        }
        if schema is not None:
            # google-genai accepts Pydantic class or dict as response_schema
            if isinstance(schema, type) or hasattr(schema, "model_json_schema"):
                config_kwargs["response_schema"] = schema
            elif isinstance(schema, dict) and schema:
                config_kwargs["response_schema"] = schema

        config = genai_types.GenerateContentConfig(**config_kwargs)

        t_start = time.perf_counter()
        self.total_calls += 1

        for attempt in range(_MAX_ATTEMPTS):
            try:
                # Use chat.send_message instead of models.generate_content to avoid 
                # the Automatic Function Calling (AFC) SDK warning.
                chat = self._client.chats.create(model=self._model)
                response = chat.send_message(
                    message=prompt,
                    config=config,
                )
                latency_ms = round((time.perf_counter() - t_start) * 1000, 1)

                prompt_tokens = 0
                completion_tokens = 0
                total_tokens = 0
                usage = getattr(response, "usage_metadata", None)
                if usage:
                    prompt_tokens = getattr(usage, "prompt_token_count", 0) or 0
                    completion_tokens = getattr(usage, "candidates_token_count", 0) or 0
                    total_tokens = getattr(usage, "total_token_count", 0) or (prompt_tokens + completion_tokens)

                self.cumulative_prompt_tokens += prompt_tokens
                self.cumulative_completion_tokens += completion_tokens

                raw = response.text
                if not raw:
                    logger.warning("[ri/gemini] empty response on attempt %d for task=%s", attempt + 1, task)
                    continue

                parsed = json.loads(raw)
                return CompletionResult(
                    data=parsed,
                    latency_ms=latency_ms,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    total_tokens=total_tokens,
                    model=self._model,
                )

            except genai_errors.ClientError as exc:
                code = getattr(exc, "status_code", None) or getattr(exc, "code", None)
                if code in _NO_RETRY_CODES:
                    logger.error(
                        "[ri/gemini] auth/bad-request error (code=%s) for task=%s: %s",
                        code, task, exc,
                    )
                    if code in {401, 403}:
                        raise AuthenticationError(
                            f"Gemini API authentication failed (code {code}). Verify GEMINI_API_KEY."
                        ) from exc
                    return CompletionResult(data=None, latency_ms=round((time.perf_counter() - t_start) * 1000, 1), model=self._model)

                self.total_retries += 1
                logger.warning(
                    "[ri/gemini] retryable error (code=%s) attempt %d/%d for task=%s",
                    code, attempt + 1, _MAX_ATTEMPTS, task,
                )

            except Exception as exc:
                self.total_retries += 1
                logger.warning(
                    "[ri/gemini] unexpected error attempt %d/%d for task=%s: %s",
                    attempt + 1, _MAX_ATTEMPTS, task, exc,
                )

            if attempt < _MAX_ATTEMPTS - 1:
                # Exponential backoff with random jitter
                jitter = random.uniform(0.1, 0.5)
                delay = _BASE_BACKOFF[attempt] + jitter
                time.sleep(delay)

        latency_ms = round((time.perf_counter() - t_start) * 1000, 1)
        logger.error("[ri/gemini] all %d attempts failed for task=%s", _MAX_ATTEMPTS, task)
        raise ExhaustedError(f"Gemini exhausted all {_MAX_ATTEMPTS} attempts for task {task}")
