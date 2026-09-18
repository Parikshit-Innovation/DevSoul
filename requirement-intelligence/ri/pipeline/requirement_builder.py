"""Stage 9 – Requirement Builder (Logic).

Converts the answered requirement graph + seed requirements into a final
Requirement list that strictly conforms to shared/schemas/requirements.schema.yaml.

IMPORTANT: topic and source are NOT in the output Requirement objects.
           They live in project.yaml under _ri.decisions[topic].
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from ri.pipeline.requirement_graph import RequirementGraph
from ri.schemas import Requirement, SeedRequirement

logger = logging.getLogger(__name__)

# Map graph node_id → default type for the requirement it produces
_NODE_TYPE_MAP: dict[str, str] = {
    "auth": "security",
    "verification": "security",
    "payments": "feature",
    "users": "feature",
    "scale": "chore",
    "deployment": "chore",
    "data_model": "feature",
    "endpoints": "feature",
    "rate_limiting": "security",
    "pages": "feature",
    "routing": "feature",
    "seller_type": "feature",
    "buyer_type": "feature",
}

_NODE_PRIORITY_MAP: dict[str, str] = {
    "auth": "high",
    "verification": "high",
    "payments": "high",
    "users": "high",
    "scale": "medium",
    "deployment": "medium",
    "data_model": "medium",
    "endpoints": "high",
    "rate_limiting": "medium",
    "pages": "medium",
    "routing": "medium",
    "seller_type": "medium",
    "buyer_type": "medium",
}


def build(
    graph: RequirementGraph,
    seeds: list[SeedRequirement],
    project_id: str,
    max_requirements: int = 50,
) -> list[Requirement]:
    """Build the final Requirement list.

    Args:
        graph:            The answered requirement graph.
        seeds:            Seed requirements from idea_analyzer.
        project_id:       UUID to stamp on every requirement.
        max_requirements: Safety cap.

    Returns:
        List[Requirement] — no topic/source fields, all schema-compliant.
    """
    now = datetime.now(timezone.utc).isoformat()
    requirements: list[Requirement] = []
    counter = 1

    # 1. Promote seed requirements (already extracted from idea)
    seed_topics = set()
    for seed in seeds:
        req = Requirement(
            id=f"REQ-{counter:03d}",
            project_id=project_id,
            title=seed.title[:256],
            description=seed.description,
            type=seed.type,
            priority=seed.priority,
            status="draft",
            created_at=now,
        )
        req._trace_info = {
            "topic": seed.topic or "general",
            "source": "idea",
            "round": 0,
            "question_asked": None,
            "raw_answer": seed.description,
            "confidence": 1.0,
            "model": "gemini",
        }
        requirements.append(req)
        counter += 1
        if seed.topic:
            seed_topics.add(seed.topic)

    # 2. Build requirements from answered graph nodes (skip if seed already covers it)
    for node_id, node_dict in graph.to_dict().items():
        if not node_dict.get("answered"):
            continue
        if node_id in seed_topics:
            continue  # already covered by a seed

        value = node_dict.get("value", "")
        if not value:
            continue

        title = _title_from_node(node_id, value)
        description = _description_from_node(node_id, value)
        req_type = _NODE_TYPE_MAP.get(node_id, "feature")
        priority = _NODE_PRIORITY_MAP.get(node_id, "medium")

        req = Requirement(
            id=f"REQ-{counter:03d}",
            project_id=project_id,
            title=title[:256],
            description=description,
            type=req_type,
            priority=priority,
            status="draft",
            created_at=now,
        )
        req._trace_info = {
            "topic": node_id,
            "source": node_dict.get("source") or "answer",
            "round": node_dict.get("round", 1),
            "question_asked": node_dict.get("question_asked") or node_dict.get("question", ""),
            "raw_answer": node_dict.get("raw_answer") or value,
            "confidence": node_dict.get("confidence", 0.95),
            "model": node_dict.get("model") or "gemini",
        }
        requirements.append(req)
        counter += 1

        if counter > max_requirements:
            logger.warning("[ri/requirement_builder] reached max_requirements cap (%d)", max_requirements)
            break

    # 3. Evaluate derived requirements rule engine (security, compliance, performance)
    from ri.pipeline import rule_engine
    answered_map = {
        nid: nd.get("value", "")
        for nid, nd in graph.to_dict().items()
        if nd.get("answered") and nd.get("value")
    }
    existing_titles = {r.title for r in requirements}
    derived_reqs = rule_engine.evaluate_rules(
        answered_topics=answered_map,
        project_id=project_id,
        start_counter=counter,
        existing_titles=existing_titles,
    )
    for d_req in derived_reqs:
        if counter > max_requirements:
            break
        requirements.append(d_req)
        counter += 1

    return requirements


# ── Private helpers ────────────────────────────────────────────────────────────

def _title_from_node(node_id: str, value: str) -> str:
    templates = {
        "users": f"User roles: {value}",
        "auth": f"Authentication: {value}",
        "scale": f"Scale target: {value}",
        "deployment": f"Deployment: {value}",
        "data_model": f"Data storage: {value}",
        "verification": f"Seller verification: {value}",
        "payments": f"Payment method: {value}",
        "seller_type": f"Seller access: {value}",
        "buyer_type": f"Buyer access: {value}",
        "endpoints": f"API endpoints: {value}",
        "rate_limiting": f"Rate limiting: {value}",
        "pages": f"Application pages: {value}",
        "routing": f"Routing: {value}",
    }
    return templates.get(node_id, f"{node_id.replace('_', ' ').title()}: {value}")


def _description_from_node(node_id: str, value: str) -> str:
    templates = {
        "users": f"The system will serve the following user group(s): {value}.",
        "auth": f"Users will authenticate using: {value}.",
        "scale": f"The system must support a scale of: {value}.",
        "deployment": f"The application will be deployed to: {value}.",
        "data_model": f"The primary data storage will use: {value}.",
        "verification": f"Sellers will be verified through: {value}.",
        "payments": f"Payments will be handled via: {value}.",
        "seller_type": f"The following users are allowed to sell: {value}.",
        "buyer_type": f"The following users are allowed to buy: {value}.",
        "endpoints": f"The API will expose: {value}.",
        "rate_limiting": f"Rate limiting policy: {value}.",
        "pages": f"The application includes these pages: {value}.",
        "routing": f"Routing approach: {value}.",
    }
    return templates.get(node_id, f"Decision for {node_id}: {value}.")
