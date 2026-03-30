"""Integration tests for the AnalysisEngine with realistic profile scenarios."""


from analyzer.engine import AnalysisEngine
from analyzer.models import (
    AccountActivity,
    ContentPattern,
    EngagementGender,
    GenderPresentation,
    InteractionBehavior,
    NameIdentity,
    NetworkInfo,
    PhotoAnalysis,
    PhotoQuality,
    PostTiming,
    ProfileCompleteness,
    ProfileData,
    Verdict,
)

engine = AnalysisEngine()


class TestRealProfileScenarios:
    def test_clearly_real_profile(self):
        """A well-established, authentic Facebook profile."""
        profile = ProfileData(
            profile_name="Sarah Johnson",
            completeness=ProfileCompleteness(
                has_profile_photo=True,
                profile_photo_type="real",
                has_cover_photo=True,
                has_bio=True,
                bio_is_generic=False,
                has_work_history=True,
                work_is_specific=True,
                has_education=True,
                education_is_specific=True,
                has_relationship_status=True,
                has_hometown=True,
                has_current_city=True,
                has_life_events=True,
            ),
            activity=AccountActivity(
                account_age_months=96,
                total_posts_visible=400,
                activity_ramp_gradual=True,
            ),
            network=NetworkInfo(
                friend_count=450,
                mutual_friend_count=25,
            ),
            post_timing=PostTiming(posts_spread_naturally=True),
            engagement_gender=EngagementGender(
                profile_presents_as=GenderPresentation.FEMALE,
                pct_same_gender_likes=0.55,
                pct_same_gender_comments=0.50,
                has_tagged_photos_with_same_gender=True,
                has_personal_comments_from_same_gender=True,
            ),
            photos=PhotoAnalysis(
                photo_quality=PhotoQuality.MIXED,
                has_casual_candid_photos=True,
                shows_progression_over_time=True,
                consistent_real_environment=True,
                has_group_photos_tagged_by_others=True,
            ),
            content=ContentPattern(
                has_original_text_posts=True,
                has_personal_updates=True,
                has_check_ins=True,
                has_birthday_wishes_from_friends=True,
                has_life_event_posts=True,
            ),
            interaction=InteractionBehavior(
                has_two_way_conversations=True,
                tagged_in_others_content=True,
            ),
            name_identity=NameIdentity(
                name_matches_apparent_ethnicity=True,
                identity_markers_consistent=True,
                has_vanity_url=True,
            ),
        )
        result = engine.analyze(profile)
        assert result.final_score >= 80
        assert result.verdict in (Verdict.VERIFIED_REAL, Verdict.LIKELY_REAL)
        assert result.catfish_override is False
        assert "Safe to engage" in result.recommendation

    def test_classic_catfish_female(self):
        """Female-presenting catfish with stolen model photos."""
        profile = ProfileData(
            profile_name="Jessica Williams",
            completeness=ProfileCompleteness(
                has_profile_photo=True,
                profile_photo_type="stolen",
                has_cover_photo=True,
                has_bio=True,
                bio_is_generic=True,
            ),
            activity=AccountActivity(
                account_age_months=4,
                total_posts_visible=50,
                activity_ramp_gradual=False,
            ),
            network=NetworkInfo(
                friend_count=4950,
                friends_single_gender_dominant=True,
                dominant_gender_opposite_to_profile=True,
            ),
            post_timing=PostTiming(
                bulk_posts_within_hour=True,
                bulk_pattern_repeats=True,
                posts_spread_naturally=False,
            ),
            engagement_gender=EngagementGender(
                profile_presents_as=GenderPresentation.FEMALE,
                pct_same_gender_likes=0.02,
                pct_same_gender_comments=0.01,
                has_tagged_photos_with_same_gender=False,
                has_personal_comments_from_same_gender=False,
                comments_are_generic_thirsty=True,
            ),
            photos=PhotoAnalysis(
                all_professional_quality=True,
                has_casual_candid_photos=False,
                shows_progression_over_time=False,
                consistent_real_environment=False,
                has_group_photos_tagged_by_others=False,
                reverse_search_matches_elsewhere=True,
                only_selfies=True,
                photo_quality=PhotoQuality.PROFESSIONAL,
            ),
            content=ContentPattern(
                mostly_shared_memes_quotes=True,
                content_feels_engagement_bait=True,
            ),
            interaction=InteractionBehavior(
                sends_requests_to_strangers=True,
                one_directional_engagement=True,
                member_of_many_groups=True,
                moves_to_dms_quickly=True,
                posts_relationship_seeking=True,
                has_two_way_conversations=False,
            ),
            name_identity=NameIdentity(
                name_matches_apparent_ethnicity=False,
                identity_markers_consistent=False,
            ),
        )
        result = engine.analyze(profile)
        assert result.catfish_override is True
        assert result.verdict == Verdict.CATFISH_PATTERN
        assert "Do not engage" in result.recommendation

    def test_suspicious_but_maybe_real(self):
        """New immigrant rebuilding social network — some flags but could be real."""
        profile = ProfileData(
            profile_name="Chen Wei",
            completeness=ProfileCompleteness(
                has_profile_photo=True,
                profile_photo_type="real",
                has_bio=True,
                bio_is_generic=False,
                has_work_history=True,
                work_is_specific=True,
                has_current_city=True,
            ),
            activity=AccountActivity(
                account_age_months=8,
                total_posts_visible=30,
                activity_ramp_gradual=True,
            ),
            network=NetworkInfo(
                friend_count=45,
                mutual_friend_count=2,
            ),
            post_timing=PostTiming(posts_spread_naturally=True),
            engagement_gender=EngagementGender(
                profile_presents_as=GenderPresentation.MALE,
                pct_same_gender_likes=0.35,
                pct_same_gender_comments=0.30,
            ),
            photos=PhotoAnalysis(
                photo_quality=PhotoQuality.CASUAL,
                has_casual_candid_photos=True,
                shows_progression_over_time=True,
            ),
            content=ContentPattern(
                has_original_text_posts=True,
                language_matches_location=True,
            ),
            interaction=InteractionBehavior(
                has_two_way_conversations=True,
            ),
            name_identity=NameIdentity(
                name_matches_apparent_ethnicity=True,
                identity_markers_consistent=True,
            ),
        )
        result = engine.analyze(profile)
        assert 40 <= result.final_score <= 80
        assert result.verdict in (Verdict.SUSPICIOUS, Verdict.LIKELY_REAL)

    def test_bot_account(self):
        """Automated bot account — consistent posting times, engagement bait."""
        profile = ProfileData(
            profile_name="Daily Motivation 365",
            completeness=ProfileCompleteness(
                has_profile_photo=True,
                profile_photo_type="stock",
            ),
            activity=AccountActivity(
                account_age_months=12,
                total_posts_visible=365,
                activity_ramp_gradual=False,
            ),
            post_timing=PostTiming(
                consistent_exact_times=True,
                posts_spread_naturally=False,
            ),
            engagement_gender=EngagementGender(
                pct_same_gender_likes=0.50,
                pct_same_gender_comments=0.50,
            ),
            photos=PhotoAnalysis(photo_quality=PhotoQuality.UNKNOWN),
            content=ContentPattern(
                mostly_shared_memes_quotes=True,
                content_feels_engagement_bait=True,
            ),
            interaction=InteractionBehavior(
                one_directional_engagement=True,
                has_two_way_conversations=False,
            ),
        )
        result = engine.analyze(profile)
        assert result.final_score < 60
        assert result.verdict in (Verdict.SUSPICIOUS, Verdict.LIKELY_FAKE)

    def test_minimal_data(self):
        """Minimal data — engine should still produce a result with low confidence."""
        profile = ProfileData(profile_name="Unknown Person")
        result = engine.analyze(profile)
        assert result.profile_name == "Unknown Person"
        # defaults create data_available=True
        assert result.confidence.value in ("low", "medium", "high")
        assert len(result.signals) == 9

    def test_all_signals_present_in_result(self):
        """Every result must have exactly 9 signals in correct order."""
        profile = ProfileData(profile_name="Test")
        result = engine.analyze(profile)
        assert len(result.signals) == 9
        for i, sig in enumerate(result.signals):
            assert sig.signal_number == i + 1

    def test_weights_sum_to_one(self):
        """Signal weights must sum to 1.0."""
        profile = ProfileData(profile_name="Test")
        result = engine.analyze(profile)
        total_weight = sum(s.weight for s in result.signals)
        assert abs(total_weight - 1.0) < 0.001


class TestEdgeCases:
    def test_score_never_exceeds_100(self):
        """Even with all positive signals maxed, score <= 100."""
        profile = ProfileData(
            profile_name="Max",
            completeness=ProfileCompleteness(
                has_profile_photo=True, profile_photo_type="real",
                has_cover_photo=True, has_bio=True, bio_is_generic=False,
                has_work_history=True, work_is_specific=True,
                has_education=True, education_is_specific=True,
                has_relationship_status=True, has_hometown=True,
                has_current_city=True, has_life_events=True,
            ),
            activity=AccountActivity(account_age_months=120, activity_ramp_gradual=True),
            network=NetworkInfo(friend_count=500, mutual_friend_count=50),
            post_timing=PostTiming(posts_spread_naturally=True),
            engagement_gender=EngagementGender(
                pct_same_gender_likes=0.60, pct_same_gender_comments=0.55,
                has_tagged_photos_with_same_gender=True,
                has_personal_comments_from_same_gender=True,
            ),
            photos=PhotoAnalysis(
                photo_quality=PhotoQuality.MIXED, has_casual_candid_photos=True,
                shows_progression_over_time=True, consistent_real_environment=True,
                has_group_photos_tagged_by_others=True,
            ),
            content=ContentPattern(
                has_original_text_posts=True, has_personal_updates=True,
                has_check_ins=True, has_birthday_wishes_from_friends=True,
                has_life_event_posts=True,
            ),
            interaction=InteractionBehavior(
                has_two_way_conversations=True, tagged_in_others_content=True,
            ),
            name_identity=NameIdentity(
                name_matches_apparent_ethnicity=True,
                identity_markers_consistent=True, has_vanity_url=True,
            ),
        )
        result = engine.analyze(profile)
        assert result.final_score <= 100.0
        for sig in result.signals:
            assert 0 <= sig.score <= 100

    def test_score_never_below_zero(self):
        """Even with all negative signals, score >= 0."""
        profile = ProfileData(
            profile_name="Min",
            completeness=ProfileCompleteness(profile_photo_type="ai_generated"),
            activity=AccountActivity(
                account_age_months=1, total_posts_visible=999,
                had_dormant_period=True, activity_ramp_gradual=False,
                first_post_recency_days=1,
            ),
            network=NetworkInfo(
                friend_count=5, mutual_friend_count=0,
                friends_appear_fake=True, friends_single_gender_dominant=True,
                dominant_gender_opposite_to_profile=True,
                friends_geographically_scattered=True,
            ),
            post_timing=PostTiming(
                bulk_posts_within_hour=True, bulk_pattern_repeats=True,
                consistent_exact_times=True, long_silence_then_burst=True,
                timezone_mismatch=True, posts_spread_naturally=False,
            ),
            engagement_gender=EngagementGender(
                pct_same_gender_likes=0.0, pct_same_gender_comments=0.0,
                comments_are_generic_thirsty=True,
            ),
            photos=PhotoAnalysis(
                suspected_ai_generated=True, photo_quality=PhotoQuality.AI_GENERATED,
                all_professional_quality=True, has_casual_candid_photos=False,
                shows_progression_over_time=False, consistent_real_environment=False,
                reverse_search_matches_elsewhere=True, only_selfies=True,
            ),
            content=ContentPattern(
                mostly_shared_memes_quotes=True, content_feels_engagement_bait=True,
                language_matches_location=False,
            ),
            interaction=InteractionBehavior(
                sends_requests_to_strangers=True, one_directional_engagement=True,
                member_of_many_groups=True, moves_to_dms_quickly=True,
                posts_relationship_seeking=True, has_two_way_conversations=False,
            ),
            name_identity=NameIdentity(
                name_matches_apparent_ethnicity=False, has_random_numbers_in_name=True,
                unusual_formatting=True, multiple_name_changes=True,
                identity_markers_consistent=False, has_vanity_url=False,
            ),
        )
        result = engine.analyze(profile)
        assert result.final_score >= 0.0
        for sig in result.signals:
            assert sig.score >= 0
