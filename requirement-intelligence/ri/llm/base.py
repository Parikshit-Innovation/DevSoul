"""Abstract base class for all LLM clients."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

class ExhaustedError(Exception):
    """Raised when an LLM client exhausts all retry attempts."""
    pass



class BaseLLM(ABC):
    """Every LLM client must implement complete().

    Args:
        prompt: The full prompt text.
        schema: A dict describing the expected JSON shape (used for structured output).
        task:   A short identifier for the calling pipeline stage.
                Values: "idea_analysis" | "question_gen" | "answer_extract"
                The mock client dispatches on this to return stage-specific canned data.

    Returns:
        A dict matching `schema`, or None if the call failed (caller must fallback).
    """

    @abstractmethod
    def complete(
        self,
        prompt: str,
        schema: dict[str, Any],
        task: str = "generic",
    ) -> dict[str, Any] | None:
        ...
