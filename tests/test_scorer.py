"""Tests for the scoring engine, verdict classification, and catfish combo rule."""

import pytest

from analyzer.models import (
    ConfidenceLevel,
    SignalFlag,
    SignalResult,
    Verdict,
)
from analyzer.scorer import (
    build_result,
    check_catfish_combo,
    classify_verdict,
    compute_confidence,
    compute_final_score,
    get_next_steps,
    get_recommendation,
    get_top_evidence,
)


def _make_signal(num: int, score: int, weight: float, data_available: bool = True) -> SignalResult:
    return SignalResult(
        signal_name=f"Signal {num}",
        signal_number=num,
        weight=weight,
        score=score,
        flag=(
            SignalFlag.CLEAN if score >= 70
            else (SignalFlag.YELLOW if score >= 40 else SignalFlag.RED)
        ),
        observations=[f"Test observation for signal {num}"],
        data_available=data_available,
    )


def _make_full_signals(scores: list[int]) -> list[SignalResult]:
    """Create 9 signals with standard weights and given scores."""
    weights = [0.10, 0.10, 0.10, 0.15, 0.15, 0.15, 0.10, 0.10, 0.05]
    return [_make_signal(i + 1, s, w) for i, (s, w) in enumerate(zip(scores, weights))]


class TestComputeFinalScore:
    def test_all_100s(self):
        signals = _make_full_signals([100] * 9)
        assert compute_final_score(signals) == 100.0

    def test_all_0s(self):
        signals = _make_full_signals([0] * 9)
        assert compute_final_score(signals) == 0.0

    def test_weighted_average(self):
        # Only signal 1 (weight 0.10) scores 100, rest 0
        scores = [100, 0, 0, 0, 0, 0, 0, 0, 0]
        signals = _make_full_signals(scores)
        assert compute_final_score(signals) == 10.0

    def test_high_signal_weights_matter(self):
        """Signals 4,5,6 (weight 0.15 each) should have 45% total impact."""
        scores = [0, 0, 0, 100, 100, 100, 0, 0, 0]
        signals = _make_full_signals(scores)
        assert compute_final_score(signals) == 45.0

    def test_mixed_scores(self):
        scores = [80, 60, 70, 30, 20, 40, 50, 90, 85]
        signals = _make_full_signals(scores)
        expected = (
            80 * 0.10 + 60 * 0.10 + 70 * 0.10 + 30 * 0.15
            + 20 * 0.15 + 40 * 0.15 + 50 * 0.10 + 90 * 0.10 + 85 * 0.05
        )
        assert compute_final_score(signals) == round(expected, 1)


class TestClassifyVerdict:
    @pytest.mark.parametrize("score,expected_verdict", [
        (95, Verdict.VERIFIED_REAL),
        (90, Verdict.VERIFIED_REAL),
        (85, Verdict.LIKELY_REAL),
        (70, Verdict.LIKELY_REAL),
        (65, Verdict.SUSPICIOUS),
        (50, Verdict.SUSPICIOUS),
        (45, Verdict.LIKELY_FAKE),
        (30, Verdict.LIKELY_FAKE),
        (25, Verdict.ALMOST_CERTAINLY_FAKE),
        (0, Verdict.ALMOST_CERTAINLY_FAKE),
    ])
    def test_verdict_tiers(self, score, expected_verdict):
        verdict, _, _ = classify_verdict(score)
        assert verdict == expected_verdict

    def test_returns_label_and_emoji(self):
        _, label, emoji = classify_verdict(95)
        assert label == "Verified Real"
        assert emoji != ""


class TestCatfishCombo:
    def test_catfish_detected(self):
        """Signals 4, 5, 6 all below 30 → catfish auto-flag."""
        signals = _make_full_signals([80, 80, 80, 20, 15, 25, 80, 80, 80])
        assert check_catfish_combo(signals) is True

    def test_catfish_not_triggered_one_above(self):
        """Signal 5 at 30 — not below, so no catfish."""
        signals = _make_full_signals([80, 80, 80, 20, 30, 25, 80, 80, 80])
        assert check_catfish_combo(signals) is False

    def test_catfish_not_triggered_all_high(self):
        signals = _make_full_signals([80] * 9)
        assert check_catfish_combo(signals) is False

    def test_catfish_at_boundary(self):
        """All exactly 29 → should trigger (< 30)."""
        signals = _make_full_signals([50, 50, 50, 29, 29, 29, 50, 50, 50])
        assert check_catfish_combo(signals) is True


class TestComputeConfidence:
    def test_high_confidence(self):
        signals = _make_full_signals([50] * 9)  # All have data
        assert compute_confidence(signals) == ConfidenceLevel.HIGH

    def test_medium_confidence(self):
        signals = _make_full_signals([50] * 9)
        for s in signals[:5]:
            s.data_available = False
        assert compute_confidence(signals) == ConfidenceLevel.MEDIUM

    def test_low_confidence(self):
        signals = _make_full_signals([50] * 9)
        for s in signals[:7]:
            s.data_available = False
        assert compute_confidence(signals) == ConfidenceLevel.LOW


class TestGetRecommendation:
    def test_safe_to_engage(self):
        text, _ = get_recommendation(85, False)
        assert "Safe to engage" in text

    def test_caution(self):
        text, _ = get_recommendation(55, False)
        assert "caution" in text.lower()

    def test_do_not_engage(self):
        text, _ = get_recommendation(25, False)
        assert "Do not engage" in text

    def test_catfish_override(self):
        text, _ = get_recommendation(75, True)
        assert "catfish" in text.lower()


class TestGetTopEvidence:
    def test_returns_max_n(self):
        signals = _make_full_signals([10, 90, 50, 5, 95, 50, 50, 50, 50])
        evidence = get_top_evidence(signals, n=3)
        assert len(evidence) == 3

    def test_extreme_scores_first(self):
        signals = _make_full_signals([50, 50, 50, 0, 50, 100, 50, 50, 50])
        evidence = get_top_evidence(signals, n=2)
        # Signals 4 (score 0, weight 0.15) and 6 (score 100, weight 0.15) are most extreme
        assert any("Signal 4" in e or "Signal 6" in e for e in evidence)


class TestGetNextSteps:
    def test_no_steps_for_high_score(self):
        signals = _make_full_signals([90] * 9)
        steps = get_next_steps(85, signals)
        assert len(steps) == 0

    def test_steps_for_suspicious(self):
        signals = _make_full_signals([30] * 9)
        steps = get_next_steps(30, signals)
        assert len(steps) > 0
        assert any("video call" in s.lower() for s in steps)

    def test_photo_step_when_photos_low(self):
        signals = _make_full_signals([80, 80, 80, 80, 80, 20, 80, 80, 80])
        steps = get_next_steps(60, signals)
        assert any("reverse image" in s.lower() for s in steps)

    def test_max_three_steps(self):
        signals = _make_full_signals([10] * 9)
        steps = get_next_steps(10, signals)
        assert len(steps) <= 3


class TestBuildResult:
    def test_real_profile(self):
        signals = _make_full_signals([90, 85, 80, 90, 85, 90, 80, 85, 90])
        result = build_result("Real Person", signals)
        assert result.verdict in (Verdict.VERIFIED_REAL, Verdict.LIKELY_REAL)
        assert result.final_score >= 80
        assert result.catfish_override is False

    def test_fake_profile(self):
        signals = _make_full_signals([10, 20, 15, 5, 10, 5, 15, 10, 20])
        result = build_result("Fake Person", signals)
        assert result.verdict in (Verdict.ALMOST_CERTAINLY_FAKE, Verdict.CATFISH_PATTERN)
        assert result.final_score < 30

    def test_catfish_override(self):
        """Even if other signals are high, catfish combo forces the verdict."""
        signals = _make_full_signals([90, 90, 90, 10, 10, 10, 90, 90, 90])
        result = build_result("Catfish", signals)
        assert result.catfish_override is True
        assert result.verdict == Verdict.CATFISH_PATTERN
        assert "Catfish" in result.verdict_label

    def test_result_has_all_fields(self):
        signals = _make_full_signals([50] * 9)
        result = build_result("Test", signals)
        assert result.profile_name == "Test"
        assert result.final_score == 50.0
        assert result.verdict is not None
        assert result.verdict_label != ""
        assert result.verdict_emoji != ""
        assert result.confidence is not None
        assert len(result.signals) == 9
        assert len(result.top_evidence) > 0
        assert result.recommendation != ""
