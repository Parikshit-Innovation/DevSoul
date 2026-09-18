"""Template Linter Test.

Verifies:
- Unique node IDs
- Existing depends_on targets
- No cyclic dependencies (DAG verification)
- options count between 2 and 4
- keywords present for domain templates
"""
from __future__ import annotations

from pathlib import Path
import pytest
import yaml

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"


def _get_base_nodes() -> dict:
    base_path = TEMPLATES_DIR / "base.yaml"
    assert base_path.exists(), "base.yaml missing"
    data = yaml.safe_load(base_path.read_text(encoding="utf-8")) or {}
    return data.get("nodes", {})


def test_base_template_valid():
    nodes = _get_base_nodes()
    assert len(nodes) >= 5
    for node_id, node in nodes.items():
        opts = node.get("default_options", [])
        assert 2 <= len(opts) <= 4, f"base node {node_id} has {len(opts)} options (must be 2-4)"


def test_domain_templates_lint():
    base_nodes = _get_base_nodes()
    template_files = [
        f for f in TEMPLATES_DIR.glob("*.yaml")
        if f.stem not in {"base", "rules"}
    ]
    assert len(template_files) >= 4

    for tf in template_files:
        data = yaml.safe_load(tf.read_text(encoding="utf-8")) or {}
        nodes = data.get("nodes", {})
        keywords = data.get("keywords", [])

        if tf.stem != "generic":
            assert len(keywords) > 0, f"Template {tf.name} has empty keywords"

        # Check unique IDs within template and no collision with base
        seen_ids = set()
        for node_id, node in nodes.items():
            assert node_id not in seen_ids, f"Duplicate node_id {node_id} in {tf.name}"
            assert node_id not in base_nodes, f"Node {node_id} in {tf.name} collides with base.yaml"
            seen_ids.add(node_id)

            # Check options count 2-4
            opts = node.get("default_options", [])
            assert 2 <= len(opts) <= 4, f"Node {node_id} in {tf.name} has {len(opts)} options (must be 2-4)"

            # Check existing depends_on targets
            deps = node.get("depends_on", [])
            for dep in deps:
                assert (dep in nodes or dep in base_nodes), (
                    f"Node {node_id} in {tf.name} has unresolved dependency {dep!r}"
                )

        # Check no cycles (DAG test) combined with base nodes
        all_nodes = {**base_nodes, **nodes}
        visited = set()
        visiting = set()

        def dfs(nid: str):
            if nid in visiting:
                raise ValueError(f"Cycle detected in {tf.name} at node {nid}")
            if nid in visited:
                return
            visiting.add(nid)
            for child in all_nodes.get(nid, {}).get("depends_on", []):
                if child in all_nodes:
                    dfs(child)
            visiting.remove(nid)
            visited.add(nid)

        for nid in all_nodes:
            dfs(nid)
