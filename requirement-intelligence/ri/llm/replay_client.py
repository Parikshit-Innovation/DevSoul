"""Replay LLM client: replays pre-recorded responses from tests/fixtures/."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from ri.llm.base import BaseLLM
from ri.llm.mock_client import MockClient

logger = logging.getLogger(__name__)

FIXTURES_FILE = Path(__file__).resolve().parent.parent.parent / "tests" / "fixtures" / "eval_fixtures.json"


class ReplayClient(BaseLLM):
    """Replays recorded LLM responses from tests/fixtures/eval_fixtures.json."""

    def __init__(self, fixtures_path: Path | None = None) -> None:
        self.fixtures_path = fixtures_path or FIXTURES_FILE
        self._fixtures: dict[str, Any] = {}
        self._fallback_mock = MockClient()

        if self.fixtures_path.exists():
            try:
                self._fixtures = json.loads(self.fixtures_path.read_text(encoding="utf-8"))
            except Exception as exc:
                logger.warning("[ri/replay_client] failed loading fixtures: %s", exc)

    def complete(
        self,
        prompt: str,
        schema: Any = None,
        task: str = "generic",
    ) -> dict[str, Any] | None:
        # Search for fixture matching task
        for key, val in self._fixtures.items():
            if key.endswith(f"_{task}") and val is not None:
                return val

        # Fallback to deterministic mock if no fixture matches
        return self._fallback_mock.complete(prompt, schema=schema, task=task)
