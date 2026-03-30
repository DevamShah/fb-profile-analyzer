"""Main analysis engine — orchestrates all 9 signals."""

from __future__ import annotations

from typing import TYPE_CHECKING

from analyzer.scorer import build_result
from analyzer.signals import (
    score_account_activity,
    score_completeness,
    score_content,
    score_engagement_gender,
    score_interaction,
    score_name_identity,
    score_network,
    score_photos,
    score_post_timing,
)

if TYPE_CHECKING:
    from analyzer.models import AnalysisResult, ProfileData


class AnalysisEngine:
    """Stateless engine that scores a ProfileData and returns an AnalysisResult."""

    def analyze(self, profile: ProfileData) -> AnalysisResult:
        signals = [
            score_completeness(profile.completeness),
            score_account_activity(profile.activity),
            score_network(profile.network),
            score_post_timing(profile.post_timing),
            score_engagement_gender(profile.engagement_gender),
            score_photos(profile.photos),
            score_content(profile.content),
            score_interaction(profile.interaction),
            score_name_identity(profile.name_identity),
        ]
        return build_result(profile.profile_name, signals)
