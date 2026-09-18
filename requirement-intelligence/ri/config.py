"""Configuration loader — reads .env from requirement-intelligence/ directory."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env from the same directory as this file's grandparent (ri/../.env)
_RI_ROOT = Path(__file__).parent.parent
load_dotenv(_RI_ROOT / ".env", override=False)


def _get(key: str, default: str | None = None) -> str | None:
    return os.environ.get(key, default)


# ── Gemini ────────────────────────────────────────────────────────────────────
GEMINI_API_KEY: str | None = _get("GEMINI_API_KEY")
GEMINI_MODEL: str = _get("GEMINI_MODEL", "gemini-2.5-flash")  # type: ignore[assignment]

# ── Interview ─────────────────────────────────────────────────────────────────
RI_MAX_ROUNDS: int = int(_get("RI_MAX_ROUNDS", "10"))  # type: ignore[arg-type]
RI_MOCK: bool = _get("RI_MOCK", "false").lower() in ("1", "true", "yes")  # type: ignore[union-attr]

# Input guardrails
IDEA_MAX_CHARS: int = 2000
MAX_REQUIREMENTS: int = 50

# ── Output ────────────────────────────────────────────────────────────────────
RI_OUTPUT_DIR: Path = _RI_ROOT / _get("RI_OUTPUT_DIR", "output")  # type: ignore[arg-type]
RI_ROOT: Path = _RI_ROOT


def has_api_key() -> bool:
    return bool(GEMINI_API_KEY and GEMINI_API_KEY != "your-key-here")


def use_mock() -> bool:
    return RI_MOCK or not has_api_key()
