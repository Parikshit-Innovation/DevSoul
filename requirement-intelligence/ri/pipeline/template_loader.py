"""Stage 3 – Template Loader (Logic).

Loads base.yaml + <type>.yaml from the templates/ directory.
Merges base, primary, and any secondary templates for multi-type projects.
If confidence is low, injects a project_type_confirmation node as question #1.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)

_TEMPLATES_DIR = Path(__file__).resolve().parent.parent.parent / "templates"


def load(
    project_type: str,
    secondary_types: list[str] | None = None,
    needs_confirmation: bool = False,
) -> dict[str, Any]:
    """Load and merge base + primary + secondary templates.

    Args:
        project_type:       Primary project type.
        secondary_types:    Optional list of secondary project types.
        needs_confirmation: If True, injects a project type confirmation question first.

    Returns:
        {
            "project_type": str,
            "nodes": {node_id: {weight, depends_on, default_options, question, required}},
            "keywords": [str],
        }
    """
    base = _load_file("base")
    primary = _load_file(project_type) or _load_file("generic") or {}

    nodes: dict[str, Any] = {}
    # 1. Base nodes
    nodes.update(base.get("nodes", {}))

    # 2. Primary type nodes
    for node_id, node_data in primary.get("nodes", {}).items():
        nodes[node_id] = node_data

    # 3. Merge secondary type nodes (multi-type project support)
    if secondary_types:
        for sec_type in secondary_types:
            sec_template = _load_file(sec_type)
            for node_id, node_data in sec_template.get("nodes", {}).items():
                if node_id not in nodes:
                    nodes[node_id] = node_data

    # 4. If confidence is low, inject confirm project type as #1 question (weight 20)
    if needs_confirmation:
        candidates = [project_type]
        if secondary_types:
            candidates.extend([t for t in secondary_types if t not in candidates])
        if len(candidates) < 3:
            for fallback_type in ["web_app", "api_service", "mobile_app"]:
                if fallback_type not in candidates:
                    candidates.append(fallback_type)
                if len(candidates) >= 3:
                    break

        nodes["project_type_confirmation"] = {
            "weight": 20,
            "depends_on": [],
            "required": True,
            "default_options": [c.replace("_", " ").title() for c in candidates[:4]],
            "question": "What primary type best describes your project?",
        }

    keywords: list[str] = list(primary.get("keywords", []))

    return {
        "project_type": project_type,
        "nodes": nodes,
        "keywords": keywords,
    }


def list_template_keywords() -> dict[str, list[str]]:
    """Return a {type: [keywords]} dict for all available templates."""
    result: dict[str, list[str]] = {}
    for path in _TEMPLATES_DIR.glob("*.yaml"):
        name = path.stem
        if name in {"base", "rules"}:
            continue
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            kws = data.get("keywords", [])
            if kws:
                result[name] = kws
        except Exception:
            pass
    return result


# ── Private ────────────────────────────────────────────────────────────────────

def _load_file(name: str) -> dict[str, Any]:
    path = _TEMPLATES_DIR / f"{name}.yaml"
    if not path.exists():
        logger.warning("[ri/template_loader] template not found: %s", path)
        return {}
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception as exc:
        logger.error("[ri/template_loader] failed to load %s: %s", path, exc)
        return {}
