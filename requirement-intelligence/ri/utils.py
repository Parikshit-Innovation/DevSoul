"""Utility helpers for Requirement Intelligence."""
from __future__ import annotations

import logging
import os
from pathlib import Path
import uuid

logger = logging.getLogger(__name__)


def atomic_write_text(file_path: Path, content: str, encoding: str = "utf-8") -> None:
    """Write text content to file_path atomically using a temporary file.

    Guarantees no partial writes even if the process is terminated mid-write.
    """
    file_path = Path(file_path).resolve()
    file_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = file_path.with_name(f".tmp_{file_path.name}_{uuid.uuid4().hex}")
    try:
        tmp_path.write_text(content, encoding=encoding)
        # os.replace is atomic across same filesystem/drive on POSIX and Windows
        os.replace(tmp_path, file_path)
    except Exception as exc:
        logger.error("[ri/utils] failed atomic write to %s: %s", file_path, exc)
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except Exception:
                pass
        raise
