"""Weighted scoring engine and verdict classification."""

from __future__ import annotations

from analyzer.models import (
    AnalysisResult,
    ConfidenceLevel,
    SignalResult,
    Verdict,
)

# Verdict tiers
VERDICT_MAP: list[tuple[int, Verdict, str, str]] = [
    (90, Verdict.VERIFIED_REAL, "Verified Real", "\u2705"),
    (70, Verdict.LIKELY_REAL, "Likely Real", "\U0001f7e2"),
    (50, Verdict.SUSPICIOUS, "Suspicious", "\U0001f7e1"),
    (30, Verdict.LIKELY_FAKE, "Likely Fake", "\U0001f7e0"),
    (0, Verdict.ALMOST_CERTAINLY_FAKE, "Almost Certainly Fake", "\U0001f534"),
]

RECOMMENDATION_MAP: list[tuple[int, str, str]] = [
    (
        70,
        "\u2705 Safe to engage \u2014 Profile appears authentic",
        "\u2705",
    ),
    (
        50,
        "\u26a0\ufe0f Proceed with caution \u2014 Some flags present,"
        " verify identity before sharing personal information",
        "\u26a0\ufe0f",
    ),
    (
        0,
        "\U0001f6ab Do not engage \u2014 Strong fake indicators,"
        " likely scam/catfish",
        "\U0001f6ab",
    ),
]


def compute_final_score(signals: list[SignalResult]) -> float:
    """Compute weighted average score from all signal results."""
    total = sum(s.score * s.weight for s in signals)
    return round(total, 1)


def classify_verdict(score: float) -> tuple[Verdict, str, str]:
    """Return (verdict_enum, label, emoji) for a given score."""
    for threshold, verdict, label, emoji in VERDICT_MAP:
        if score >= threshold:
            return verdict, label, emoji
    return Verdict.ALMOST_CERTAINLY_FAKE, "Almost Certainly Fake", "\U0001f534"


def check_catfish_combo(signals: list[SignalResult]) -> bool:
    """Check if signals 4, 5, and 6 all score below 30 — catfish auto-flag."""
    scores_by_num = {s.signal_number: s.score for s in signals}
    return all(scores_by_num.get(n, 100) < 30 for n in (4, 5, 6))


def compute_confidence(signals: list[SignalResult]) -> ConfidenceLevel:
    """Determine confidence based on how many signals had data."""
    evaluable = sum(1 for s in signals if s.data_available)
    if evaluable >= 6:
        return ConfidenceLevel.HIGH
    if evaluable >= 4:
        return ConfidenceLevel.MEDIUM
    return ConfidenceLevel.LOW


def get_recommendation(score: float, catfish: bool) -> tuple[str, str]:
    """Return (recommendation_text, emoji)."""
    if catfish:
        return (
            "\U0001f6ab Do not engage \u2014 Classic catfish pattern"
            " detected, almost certainly a scam",
            "\U0001f6ab",
        )
    for threshold, text, emoji in RECOMMENDATION_MAP:
        if score >= threshold:
            return text, emoji
    return RECOMMENDATION_MAP[-1][1], RECOMMENDATION_MAP[-1][2]


def get_top_evidence(signals: list[SignalResult], n: int = 3) -> list[str]:
    """Return the top N most impactful observations from all signals."""
    # Sort signals by deviation from 50 (most extreme first), weighted
    ranked = sorted(signals, key=lambda s: abs(s.score - 50) * s.weight, reverse=True)
    evidence: list[str] = []
    for sig in ranked:
        for obs in sig.observations:
            if len(evidence) >= n:
                return evidence
            evidence.append(f"[{sig.signal_name}] {obs}")
    return evidence


def get_next_steps(score: float, signals: list[SignalResult]) -> list[str]:
    """Suggest verification steps if score is suspicious or below."""
    if score >= 70:
        return []

    steps: list[str] = []
    scores_by_num = {s.signal_number: s.score for s in signals}

    if scores_by_num.get(6, 100) < 50:
        steps.append("Reverse image search their profile photos using Google Images or TinEye")
    if scores_by_num.get(5, 100) < 50:
        steps.append(
            "Check if any same-gender friends interact with them — "
            "lack of same-gender engagement is the #1 catfish indicator"
        )
    steps.append("Ask them for a live video call — scammers will always find excuses to avoid this")
    if scores_by_num.get(3, 100) < 50:
        steps.append("Ask mutual friends if they know this person in real life")

    return steps[:3]


def build_result(
    profile_name: str,
    signals: list[SignalResult],
) -> AnalysisResult:
    """Assemble the final AnalysisResult from scored signals."""
    final_score = compute_final_score(signals)
    catfish = check_catfish_combo(signals)

    if catfish:
        verdict = Verdict.CATFISH_PATTERN
        verdict_label = "HIGH CONFIDENCE FAKE \u2014 Catfish Pattern Detected"
        verdict_emoji = "\U0001f6a8"
    else:
        verdict, verdict_label, verdict_emoji = classify_verdict(final_score)

    recommendation, rec_emoji = get_recommendation(final_score, catfish)

    return AnalysisResult(
        profile_name=profile_name,
        final_score=final_score,
        verdict=verdict,
        verdict_label=verdict_label,
        verdict_emoji=verdict_emoji,
        catfish_override=catfish,
        confidence=compute_confidence(signals),
        signals=signals,
        top_evidence=get_top_evidence(signals),
        recommendation=recommendation,
        recommendation_emoji=rec_emoji,
        next_steps=get_next_steps(final_score, signals),
    )
