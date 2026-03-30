"""Comprehensive tests for all 9 signal scoring functions."""


from analyzer.models import (
    AccountActivity,
    ContentPattern,
    EngagementGender,
    InteractionBehavior,
    NameIdentity,
    NetworkInfo,
    PhotoAnalysis,
    PhotoQuality,
    PostTiming,
    ProfileCompleteness,
    SignalFlag,
)
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

# ── Signal 1: Profile Completeness ───────────────────────────────────────────


class TestScoreCompleteness:
    def test_fully_complete_profile(self):
        data = ProfileCompleteness(
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
        )
        result = score_completeness(data)
        assert result.score == 100
        assert result.flag == SignalFlag.CLEAN

    def test_empty_profile(self):
        data = ProfileCompleteness()
        result = score_completeness(data)
        assert result.score == 0
        assert result.flag == SignalFlag.RED

    def test_minimal_profile_with_photo(self):
        data = ProfileCompleteness(has_profile_photo=True, profile_photo_type="real")
        result = score_completeness(data)
        assert result.score == 20
        assert result.flag == SignalFlag.RED

    def test_stock_photo_gets_partial_credit(self):
        data = ProfileCompleteness(has_profile_photo=True, profile_photo_type="stock")
        result = score_completeness(data)
        assert result.score == 5
        assert any("stock" in o.lower() for o in result.observations)

    def test_ai_generated_photo(self):
        data = ProfileCompleteness(has_profile_photo=True, profile_photo_type="ai_generated")
        result = score_completeness(data)
        assert result.score == 0
        assert any("ai_generated" in o for o in result.observations)

    def test_generic_bio_partial(self):
        data = ProfileCompleteness(
            has_profile_photo=True,
            profile_photo_type="real",
            has_bio=True,
            bio_is_generic=True,
        )
        result = score_completeness(data)
        assert result.score == 25  # 20 (photo) + 5 (generic bio)
        assert any("generic" in o.lower() for o in result.observations)

    def test_vague_work(self):
        data = ProfileCompleteness(has_work_history=True, work_is_specific=False)
        result = score_completeness(data)
        assert any("vague" in o.lower() for o in result.observations)

    def test_signal_metadata(self):
        result = score_completeness(ProfileCompleteness())
        assert result.signal_number == 1
        assert result.weight == 0.10
        assert result.signal_name == "Profile Completeness"


# ── Signal 2: Account Age vs Activity ────────────────────────────────────────


class TestScoreAccountActivity:
    def test_established_account_natural(self):
        data = AccountActivity(
            account_age_months=48,
            total_posts_visible=200,
            activity_ramp_gradual=True,
        )
        result = score_account_activity(data)
        assert result.score >= 70
        assert result.flag == SignalFlag.CLEAN

    def test_new_account_spammy(self):
        data = AccountActivity(
            account_age_months=2,
            total_posts_visible=500,
            activity_ramp_gradual=False,
        )
        result = score_account_activity(data)
        assert result.score < 30
        assert result.flag == SignalFlag.RED

    def test_dormant_period(self):
        data = AccountActivity(had_dormant_period=True)
        result = score_account_activity(data)
        assert result.score <= 40

    def test_old_account_recent_first_post(self):
        """Old account but first visible post is very recent — history wipe."""
        data = AccountActivity(
            account_age_months=60,
            first_post_recency_days=30,
        )
        result = score_account_activity(data)
        assert result.score < 60
        assert any("history wipe" in o.lower() for o in result.observations)

    def test_no_data_available(self):
        data = AccountActivity()
        result = score_account_activity(data)
        assert result.data_available is False

    def test_abrupt_activity_start(self):
        data = AccountActivity(account_age_months=12, activity_ramp_gradual=False)
        result = score_account_activity(data)
        assert any("abruptly" in o.lower() for o in result.observations)

    def test_score_clamped_to_100(self):
        data = AccountActivity(account_age_months=120, activity_ramp_gradual=True)
        result = score_account_activity(data)
        assert result.score <= 100

    def test_score_clamped_to_0(self):
        data = AccountActivity(
            account_age_months=1,
            total_posts_visible=999,
            had_dormant_period=True,
            activity_ramp_gradual=False,
        )
        result = score_account_activity(data)
        assert result.score >= 0


# ── Signal 3: Friend Count & Network ─────────────────────────────────────────


class TestScoreNetwork:
    def test_healthy_network(self):
        data = NetworkInfo(
            friend_count=450,
            mutual_friend_count=15,
        )
        result = score_network(data)
        assert result.score >= 70
        assert result.flag == SignalFlag.CLEAN

    def test_very_low_friends(self):
        data = NetworkInfo(friend_count=10, mutual_friend_count=0)
        result = score_network(data)
        assert result.score < 40

    def test_maxed_friends(self):
        data = NetworkInfo(friend_count=5000)
        result = score_network(data)
        assert any("cap" in o.lower() for o in result.observations)

    def test_fake_friends(self):
        data = NetworkInfo(friends_appear_fake=True)
        result = score_network(data)
        assert result.score < 50

    def test_opposite_gender_dominant(self):
        data = NetworkInfo(
            friends_single_gender_dominant=True,
            dominant_gender_opposite_to_profile=True,
        )
        result = score_network(data)
        assert any("catfish" in o.lower() for o in result.observations)

    def test_no_data(self):
        data = NetworkInfo()
        result = score_network(data)
        assert result.data_available is False


# ── Signal 4: Post Timing (HIGH SIGNAL) ──────────────────────────────────────


class TestScorePostTiming:
    def test_natural_timing(self):
        data = PostTiming(posts_spread_naturally=True)
        result = score_post_timing(data)
        assert result.score >= 70
        assert result.flag == SignalFlag.CLEAN

    def test_bulk_posting_pattern(self):
        data = PostTiming(
            bulk_posts_within_hour=True,
            bulk_pattern_repeats=True,
            posts_spread_naturally=False,
        )
        result = score_post_timing(data)
        assert result.score < 30
        assert result.flag == SignalFlag.RED

    def test_automation_signature(self):
        data = PostTiming(
            consistent_exact_times=True,
            posts_spread_naturally=False,
        )
        result = score_post_timing(data)
        assert result.score < 50
        assert any("automation" in o.lower() for o in result.observations)

    def test_silence_then_burst(self):
        data = PostTiming(long_silence_then_burst=True, posts_spread_naturally=False)
        result = score_post_timing(data)
        assert result.score < 50

    def test_all_red_flags(self):
        data = PostTiming(
            bulk_posts_within_hour=True,
            bulk_pattern_repeats=True,
            consistent_exact_times=True,
            long_silence_then_burst=True,
            timezone_mismatch=True,
            posts_spread_naturally=False,
        )
        result = score_post_timing(data)
        assert result.score == 0  # Clamped at 0

    def test_weight_is_15_percent(self):
        result = score_post_timing(PostTiming())
        assert result.weight == 0.15


# ── Signal 5: Engagement Gender (CATFISH DETECTOR) ───────────────────────────


class TestScoreEngagementGender:
    def test_healthy_engagement(self):
        data = EngagementGender(
            pct_same_gender_likes=0.50,
            pct_same_gender_comments=0.45,
            has_tagged_photos_with_same_gender=True,
            has_personal_comments_from_same_gender=True,
        )
        result = score_engagement_gender(data)
        assert result.score >= 70
        assert result.flag == SignalFlag.CLEAN

    def test_classic_catfish_pattern(self):
        data = EngagementGender(
            pct_same_gender_likes=0.02,
            pct_same_gender_comments=0.01,
            has_tagged_photos_with_same_gender=False,
            has_personal_comments_from_same_gender=False,
            comments_are_generic_thirsty=True,
        )
        result = score_engagement_gender(data)
        assert result.score < 20
        assert result.flag == SignalFlag.RED

    def test_slightly_skewed(self):
        data = EngagementGender(
            pct_same_gender_likes=0.25,
            has_tagged_photos_with_same_gender=True,
        )
        result = score_engagement_gender(data)
        assert 40 <= result.score <= 85

    def test_thirsty_comments_penalty(self):
        data = EngagementGender(comments_are_generic_thirsty=True)
        result = score_engagement_gender(data)
        assert any("thirsty" in o.lower() for o in result.observations)

    def test_no_data(self):
        data = EngagementGender()
        result = score_engagement_gender(data)
        assert result.data_available is False

    def test_zero_same_gender(self):
        data = EngagementGender(pct_same_gender_likes=0.0)
        result = score_engagement_gender(data)
        assert result.score < 30


# ── Signal 6: Photo Authenticity (HIGH SIGNAL) ───────────────────────────────


class TestScorePhotos:
    def test_authentic_photos(self):
        data = PhotoAnalysis(
            photo_quality=PhotoQuality.MIXED,
            has_casual_candid_photos=True,
            shows_progression_over_time=True,
            consistent_real_environment=True,
            has_group_photos_tagged_by_others=True,
        )
        result = score_photos(data)
        assert result.score >= 80
        assert result.flag == SignalFlag.CLEAN

    def test_all_professional(self):
        data = PhotoAnalysis(
            all_professional_quality=True,
            has_casual_candid_photos=False,
            shows_progression_over_time=False,
            has_group_photos_tagged_by_others=False,
            only_selfies=True,
        )
        result = score_photos(data)
        assert result.score < 40

    def test_ai_generated(self):
        data = PhotoAnalysis(
            suspected_ai_generated=True,
            photo_quality=PhotoQuality.AI_GENERATED,
        )
        result = score_photos(data)
        assert result.score < 30

    def test_reverse_search_match(self):
        data = PhotoAnalysis(reverse_search_matches_elsewhere=True)
        result = score_photos(data)
        assert any("stolen" in o.lower() for o in result.observations)

    def test_only_selfies_penalty(self):
        data = PhotoAnalysis(only_selfies=True)
        result = score_photos(data)
        assert any("selfies" in o.lower() for o in result.observations)


# ── Signal 7: Content Pattern ────────────────────────────────────────────────


class TestScoreContent:
    def test_rich_content(self):
        data = ContentPattern(
            has_original_text_posts=True,
            has_personal_updates=True,
            has_check_ins=True,
            has_birthday_wishes_from_friends=True,
            has_life_event_posts=True,
        )
        result = score_content(data)
        assert result.score >= 80
        assert result.flag == SignalFlag.CLEAN

    def test_only_memes(self):
        data = ContentPattern(
            mostly_shared_memes_quotes=True,
            content_feels_engagement_bait=True,
        )
        result = score_content(data)
        assert result.score < 30

    def test_language_mismatch(self):
        data = ContentPattern(language_matches_location=False)
        result = score_content(data)
        assert any("language" in o.lower() for o in result.observations)

    def test_birthday_wishes_strong_signal(self):
        data = ContentPattern(has_birthday_wishes_from_friends=True)
        result = score_content(data)
        assert result.score >= 60


# ── Signal 8: Interaction Behavior ───────────────────────────────────────────


class TestScoreInteraction:
    def test_healthy_interaction(self):
        data = InteractionBehavior(
            has_two_way_conversations=True,
            tagged_in_others_content=True,
        )
        result = score_interaction(data)
        assert result.score >= 70
        assert result.flag == SignalFlag.CLEAN

    def test_predatory_pattern(self):
        data = InteractionBehavior(
            sends_requests_to_strangers=True,
            one_directional_engagement=True,
            member_of_many_groups=True,
            moves_to_dms_quickly=True,
            posts_relationship_seeking=True,
            has_two_way_conversations=False,
        )
        result = score_interaction(data)
        assert result.score < 20
        assert result.flag == SignalFlag.RED

    def test_moves_to_dms(self):
        data = InteractionBehavior(moves_to_dms_quickly=True)
        result = score_interaction(data)
        assert any("DMs" in o or "external" in o for o in result.observations)


# ── Signal 9: Name & Identity ────────────────────────────────────────────────


class TestScoreNameIdentity:
    def test_consistent_identity(self):
        data = NameIdentity(
            name_matches_apparent_ethnicity=True,
            identity_markers_consistent=True,
            has_vanity_url=True,
        )
        result = score_name_identity(data)
        assert result.score >= 70
        assert result.flag == SignalFlag.CLEAN

    def test_fabricated_identity(self):
        data = NameIdentity(
            name_matches_apparent_ethnicity=False,
            has_random_numbers_in_name=True,
            unusual_formatting=True,
            multiple_name_changes=True,
            identity_markers_consistent=False,
            has_vanity_url=False,
        )
        result = score_name_identity(data)
        assert result.score == 0  # Clamped
        assert result.flag == SignalFlag.RED

    def test_random_numbers_penalty(self):
        data = NameIdentity(has_random_numbers_in_name=True)
        result = score_name_identity(data)
        assert result.score < 70
