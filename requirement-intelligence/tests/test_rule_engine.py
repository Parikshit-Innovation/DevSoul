"""Tests for Stage 9b – Derived Requirements Rule Engine."""
from __future__ import annotations

import pytest
from ri.pipeline import rule_engine


def test_rule_engine_loads_rules():
    rules = rule_engine.load_rules()
    assert len(rules) >= 10, f"Expected at least 10 rules, found {len(rules)}"
    rule_ids = {r["id"] for r in rules}
    assert "rule_payment_security" in rule_ids
    assert "rule_auth_brute_force" in rule_ids
    assert "rule_high_scale_caching" in rule_ids
    assert "rule_database_backups" in rule_ids
    assert "rule_api_rate_limiting" in rule_ids


def test_rule_engine_generates_derived_requirements():
    answered = {
        "payments": "Online payments (Stripe / Razorpay)",
        "auth": "Email / password",
        "scale": "Large (100k+ users)",
        "data_model": "Relational database (PostgreSQL / MySQL)",
        "rate_limiting": "Basic per API key",
    }
    derived = rule_engine.evaluate_rules(
        answered_topics=answered,
        project_id="test-project-1234",
        start_counter=10,
    )
    assert len(derived) >= 5
    titles = [d.title for d in derived]
    assert any("PCI-DSS" in t or "Payment gateway" in t for t in titles)
    assert any("brute-force" in t.lower() or "argon2" in t.lower() for t in titles)
    assert any("caching" in t.lower() or "redis" in t.lower() for t in titles)
    assert any("backups" in t.lower() for t in titles)

    for req in derived:
        assert req.type in {"feature", "bug", "refactor", "chore", "security", "documentation"}
        assert req.priority in {"critical", "high", "medium", "low"}
        assert req.project_id == "test-project-1234"
        assert req.id.startswith("REQ-")
