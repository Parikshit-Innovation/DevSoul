"""Record fixture generator: saves real (or offline mock) LLM responses for eval ideas."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from ri.eval.ideas import EVAL_IDEAS
from ri.llm.base import BaseLLM
from ri.llm.prompts import ANSWER_EXTRACT_PROMPT, IDEA_ANALYSIS_PROMPT, QUESTION_GEN_PROMPT
import ri.config as cfg

logger = logging.getLogger(__name__)

FIXTURES_FILE = Path(__file__).resolve().parent.parent.parent / "tests" / "fixtures" / "eval_fixtures.json"


def record_fixtures() -> dict[str, Any]:
    """Record LLM responses for all eval ideas into tests/fixtures/eval_fixtures.json."""
    if cfg.has_api_key():
        from ri.llm.gemini_client import GeminiClient
        llm: BaseLLM = GeminiClient(api_key=cfg.GEMINI_API_KEY, model=cfg.GEMINI_MODEL)
        mode = f"Gemini ({cfg.GEMINI_MODEL})"
    else:
        from ri.llm.mock_client import MockClient
        llm = MockClient()
        mode = "MockLLM"

    print(f"Recording fixtures using {mode}...")
    fixtures: dict[str, Any] = {}

    for idea in EVAL_IDEAS:
        # 1. Idea analysis
        p_analysis = IDEA_ANALYSIS_PROMPT.format(
            idea=idea.idea,
            allowed_topics=", ".join(idea.expected_topics),
        )
        res_analysis = llm.complete(p_analysis, schema={}, task="idea_analysis")
        fixtures[f"{idea.id}_idea_analysis"] = res_analysis

        # 2. Question generation
        p_qgen = QUESTION_GEN_PROMPT.format(
            summary=idea.name,
            project_type=idea.expected_type,
            open_gaps="\n".join(f"- {t}: Tell us about {t}" for t in idea.expected_topics[:3]),
        )
        res_qgen = llm.complete(p_qgen, schema={}, task="question_gen")
        fixtures[f"{idea.id}_question_gen"] = res_qgen

        # 3. Answer extract
        sample_topic = idea.expected_topics[0] if idea.expected_topics else "users"
        p_extract = ANSWER_EXTRACT_PROMPT.format(
            node_id=sample_topic,
            question=f"Who will use {idea.name}?",
            options="Option 1, Option 2, Option 3",
            raw_answer="Option 1",
        )
        res_extract = llm.complete(p_extract, schema={}, task="answer_extract")
        fixtures[f"{idea.id}_answer_extract"] = res_extract

    FIXTURES_FILE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURES_FILE.write_text(json.dumps(fixtures, indent=2), encoding="utf-8")
    print(f"Successfully recorded {len(fixtures)} fixture entries to {FIXTURES_FILE}")
    return fixtures


if __name__ == "__main__":
    record_fixtures()
