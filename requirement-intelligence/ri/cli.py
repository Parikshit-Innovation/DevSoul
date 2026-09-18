"""CLI — three sub-commands: check | demo | run.

Usage:
    python -m ri check
    python -m ri demo
    python -m ri run "Build an online marketplace for college students."
    python -m ri run "..." --out ../project-brain/.devos --mock
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

logging.basicConfig(level=logging.WARNING, format="[%(name)s] %(levelname)s: %(message)s")


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    parser = argparse.ArgumentParser(
        prog="ri",
        description="Requirement Intelligence -- turn ideas into structured specs",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # check
    sub.add_parser("check", help="Ping Gemini API and report status")

    # demo
    sub.add_parser("demo", help="Offline mock interview (no API key needed)")

    # run
    run_p = sub.add_parser("run", help="Run a real interview session")
    run_p.add_argument("idea", help="Project idea (quoted string)")
    run_p.add_argument("--out", default="output", help="Output directory (default: output/)")
    run_p.add_argument("--mock", action="store_true", help="Force offline mock mode")

    args = parser.parse_args()

    if args.command == "check":
        _cmd_check()
    elif args.command == "demo":
        _cmd_demo()
    elif args.command == "run":
        _cmd_run(args.idea, out=args.out, mock=args.mock)


# ── Commands ───────────────────────────────────────────────────────────────────

def _cmd_check() -> None:
    """Ping Gemini and report status."""
    import ri.config as cfg

    print("Requirement Intelligence - connection check\n")
    print(f"  Model   : {cfg.GEMINI_MODEL}")
    print(f"  API key : {'SET [OK]' if cfg.has_api_key() else 'NOT SET [X]'}")
    print(f"  Mock    : {cfg.use_mock()}")

    if cfg.use_mock():
        print("\n[!] No API key - set GEMINI_API_KEY in .env to use Gemini.")
        return

    try:
        from ri.llm.gemini_client import GeminiClient
        client = GeminiClient(api_key=cfg.GEMINI_API_KEY, model=cfg.GEMINI_MODEL)  # type: ignore[arg-type]
        res = client.complete_detailed(
            prompt='Reply with the JSON object {"ok": true}',
            schema={"ok": True},
            task="health_check",
        )
        if res.data:
            print(f"\nGemini replied: {res.data} [OK]")
            print(f"  Latency     : {res.latency_ms} ms")
            print(f"  Token usage : prompt={res.prompt_tokens}, completion={res.completion_tokens}, total={res.total_tokens}")
        else:
            print(f"\n[X] Gemini returned empty response in {res.latency_ms} ms.")
    except Exception as exc:
        print(f"\n[X] Gemini error: {exc}")
        sys.exit(1)


def _cmd_demo() -> None:
    """Offline mock interview — no API key needed."""
    from ri.session import Session

    idea = (
        "Build an online marketplace for college students. "
        "Only verified college students should be allowed to sell products."
    )
    out_dir = Path("output") / "demo"

    print("=" * 60)
    print("REQUIREMENT INTELLIGENCE — DEMO (offline mock)")
    print("=" * 60)
    print(f"\nIdea: {idea}\n")

    session = Session(idea=idea, mock=True, out_dir=out_dir)
    print(f"Project type detected : {session.project_type}")
    print(f"Project name          : {session.name}\n")

    import ri.config as cfg
    max_rounds = cfg.RI_MAX_ROUNDS

    for _ in range(max_rounds):
        round_data = session.next_round()

        if round_data.status == "complete":
            print("\n[OK] Interview complete!")
            break

        print(f"--- Round {round_data.round} (progress: {round_data.progress.answered}/{round_data.progress.total}) ---")
        if round_data.fallbacks_used:
            print(f"  [!] AI degraded ({round_data.fallbacks_used} fallback(s) used this round)")

        # In mock mode: auto-answer with the first option
        answers = []
        for q in round_data.questions:
            answer = q.options[0] if q.options else "Yes"
            print(f"  Q [{q.node_id}]: {q.question}")
            print(f"  A: {answer} (auto)\n")
            from ri.schemas import AnswerItem
            answers.append(AnswerItem(node_id=q.node_id, answer=answer))

        session.apply_answers(answers)

        if session.is_complete():
            session.finalise()
            break

    summary = session.snapshot()
    print(f"\nCompleteness : {summary['completeness']}%")
    print(f"Open gaps    : {summary['open_gaps'] or 'none'}")
    print(f"Fallbacks    : {summary['fallbacks_total']}")
    print(f"\nOutput written to: {out_dir}/")
    print("  - requirements.yaml")
    print("  - project.yaml")
    print("  - session.json")


def _cmd_run(idea: str, out: str = "output", mock: bool = False) -> None:
    """Run a real interactive interview."""
    from ri.session import Session
    from ri.schemas import AnswerItem
    import ri.config as cfg

    out_dir = Path(out)
    session = Session(idea=idea, mock=mock, out_dir=out_dir)

    print("\n" + "=" * 60)
    print("REQUIREMENT INTELLIGENCE")
    print("=" * 60)
    print(f"Project : {session.name}  ({session.project_type})")
    print(f"Mode    : {'mock (offline)' if mock else 'Gemini'}")
    print("\nType an option number, free text, or press Enter to skip.")
    print("Type 'done' at any prompt to finish the interview early.\n")

    for _ in range(cfg.RI_MAX_ROUNDS):
        round_data = session.next_round()

        if round_data.status == "complete":
            print("\n[OK] Interview complete!")
            break

        print(f"--- Round {round_data.round} ({round_data.progress.answered}/{round_data.progress.total} topics answered) ---")
        if round_data.fallbacks_used:
            print(f"  [!] AI degraded - using template defaults for {round_data.fallbacks_used} question(s)")
        print()

        answers = []
        done = False
        for q in round_data.questions:
            print(f"[{q.node_id}] {q.question}")
            for i, opt in enumerate(q.options, 1):
                print(f"  {i}. {opt}")
            raw = input("> ").strip()

            if raw.lower() == "done":
                done = True
                break

            # Convert numeric option selection to text
            if raw.isdigit():
                idx = int(raw) - 1
                if 0 <= idx < len(q.options):
                    raw = q.options[idx]

            answers.append(AnswerItem(node_id=q.node_id, answer=raw))
            print()

        if answers:
            session.apply_answers(answers)

        if done or session.is_complete():
            session.finalise()
            break
    else:
        print(f"\n[!] Reached max rounds ({cfg.RI_MAX_ROUNDS}). Finalising with current answers.")
        session.finalise()

    summary = session.snapshot()
    print(f"\nCompleteness : {summary['completeness']}%")
    if summary["open_gaps"]:
        print(f"Open gaps    : {', '.join(summary['open_gaps'])}")
    print(f"\nOutput written to: {out_dir}/")
    print("  requirements.yaml  → send to Project Brain")
    print("  project.yaml       → project metadata + decisions")
    print("  session.json       → session state (server reload safety)")
