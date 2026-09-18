"""Offline mock LLM — deterministic, task-keyed responses for testing."""
from __future__ import annotations

import re
from typing import Any

from ri.llm.base import BaseLLM


class MockClient(BaseLLM):
    """Returns deterministic canned responses for each pipeline task.

    The `task` argument keys the response so every pipeline stage gets
    the right shape without needing a real API key.
    """

    def complete(
        self,
        prompt: str,
        schema: Any = None,
        task: str = "generic",
    ) -> dict[str, Any] | None:
        if task == "answer_extract":
            m_node = re.search(r"Question topic:\s*([^\n]+)", prompt)
            m_ans = (
                re.search(r"<user_answer>\s*(.*?)\s*</user_answer>", prompt, re.DOTALL)
                or re.search(r"Developer's answer:\s*([^\n]+)", prompt)
            )
            node_id = m_node.group(1).strip() if m_node else "users"
            val = m_ans.group(1).strip() if m_ans else "Option 1"
            confidence = 0.4 if any(w in val.lower() for w in ["not sure", "other", "unclear"]) else 0.95
            return {
                "node_id": node_id,
                "value": val,
                "confidence": confidence,
            }

        if task == "idea_analysis":
            m_idea = (
                re.search(r"<user_idea>\s*(.*?)\s*</user_idea>", prompt, re.DOTALL)
                or re.search(r"---\s*\n(.*?)\n---", prompt, re.DOTALL)
            )
            idea_text = m_idea.group(1).strip() if m_idea else "Software Project"
            words = [w for w in re.sub(r"[^\w\s]", "", idea_text).split() if w.lower() not in {"build", "a", "an", "the", "for", "with"}]
            name = " ".join(w.capitalize() for w in words[:4]) or "DevSoul Project"

            seeds = []
            text_lower = idea_text.lower()
            if "verified" in text_lower or ".edu" in text_lower:
                seeds.append({
                    "title": "Verified student access",
                    "description": "Only verified university students are authorized to use the platform.",
                    "type": "security",
                    "priority": "high",
                    "topic": "verification",
                })
            if "stripe" in text_lower or "online payment" in text_lower:
                seeds.append({
                    "title": "Online payment processing",
                    "description": "Payments are processed securely online via payment gateway.",
                    "type": "feature",
                    "priority": "high",
                    "topic": "payments",
                })
            if "multi-tenant" in text_lower or "workspace isolation" in text_lower:
                seeds.append({
                    "title": "Multi-tenant workspace isolation",
                    "description": "Each organization has an isolated workspace environment.",
                    "type": "security",
                    "priority": "high",
                    "topic": "multi_tenancy",
                })
            if "sqlite" in text_lower or "offline" in text_lower:
                seeds.append({
                    "title": "Local offline SQLite storage",
                    "description": "Data is stored locally on device for offline operation.",
                    "type": "feature",
                    "priority": "high",
                    "topic": "offline_storage",
                })
            if "crud" in text_lower or "endpoints" in text_lower:
                seeds.append({
                    "title": "REST API resource endpoints",
                    "description": "Provides core CRUD endpoints for resource operations.",
                    "type": "feature",
                    "priority": "high",
                    "topic": "endpoints",
                })
            if "rate limit" in text_lower:
                seeds.append({
                    "title": "API rate limiting",
                    "description": "Protects endpoints against abusive traffic volumes.",
                    "type": "security",
                    "priority": "high",
                    "topic": "rate_limiting",
                })

            return {
                "name": name,
                "summary": idea_text[:180],
                "seed_requirements": seeds,
            }

        if task == "question_gen":
            # Extract requested open gaps from prompt
            gap_lines = re.findall(r"-\s*([a-zA-Z0-9_]+):\s*([^\n\(\)]+)(?:\s*\((?:options:\s*)?([^\)]+)\))?", prompt)
            if gap_lines:
                questions = []
                for nid, q_text, opts_text in gap_lines[:3]:
                    opts = [o.strip() for o in opts_text.split(",") if o.strip()] if opts_text else ["Option A", "Option B", "Option C"]
                    questions.append({
                        "node_id": nid,
                        "question": q_text.strip() or f"How will {nid} be handled?",
                        "options": opts,
                        "allow_free_text": True,
                    })
                return {"questions": questions}

            return {
                "questions": [
                    {
                        "node_id": "users",
                        "question": "Who will use the system?",
                        "options": ["Single role", "Two roles", "Multiple roles"],
                        "allow_free_text": True,
                    }
                ]
            }

        return {"mock": True, "task": task}
