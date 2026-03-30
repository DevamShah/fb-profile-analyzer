"""Individual signal scoring functions — one per signal."""

from __future__ import annotations

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
    SignalResult,
)


def _flag(score: int) -> SignalFlag:
    if score >= 70:
        return SignalFlag.CLEAN
    if score >= 40:
        return SignalFlag.YELLOW
    return SignalFlag.RED


def _clamp(score: int) -> int:
    return max(0, min(score, 100))


def _build_result(
    name: str, number: int, weight: float, score: int,
    obs: list[str], default_obs: str, **kwargs: object,
) -> SignalResult:
    if not obs:
        obs.append(default_obs)
    clamped = _clamp(score) if score != min(score, 100) else min(score, 100)
    return SignalResult(
        signal_name=name, signal_number=number, weight=weight,
        score=clamped, flag=_flag(clamped), observations=obs, **kwargs,  # type: ignore[arg-type]
    )


# ── Signal 1: Profile Completeness (10%) ─────────────────────────────────────


def _score_profile_photo(data: ProfileCompleteness) -> tuple[int, list[str]]:
    obs: list[str] = []
    if data.has_profile_photo:
        if data.profile_photo_type in ("real", "mixed", "unknown"):
            return 20, obs
        if data.profile_photo_type == "stock":
            obs.append("Profile photo appears to be stock imagery")
            return 5, obs
        if data.profile_photo_type in ("ai_generated", "stolen"):
            obs.append(f"Profile photo flagged as {data.profile_photo_type}")
            return 0, obs
    else:
        obs.append("No profile photo present")
    return 0, obs


def _score_bio_work_edu(data: ProfileCompleteness) -> tuple[int, list[str]]:
    score = 0
    obs: list[str] = []
    if data.has_bio and not data.bio_is_generic:
        score += 10
    elif data.has_bio:
        score += 5
        obs.append("Bio is generic/vague")
    else:
        obs.append("No bio section filled")
    if data.has_work_history and data.work_is_specific:
        score += 15
    elif data.has_work_history:
        score += 7
        obs.append("Work history is vague (e.g., 'Self-Employed')")
    else:
        obs.append("No work history listed")
    if data.has_education and data.education_is_specific:
        score += 15
    elif data.has_education:
        score += 7
        obs.append("Education is vague")
    return score, obs


def score_completeness(data: ProfileCompleteness) -> SignalResult:
    score = 0
    obs: list[str] = []
    photo_pts, photo_obs = _score_profile_photo(data)
    score += photo_pts
    obs.extend(photo_obs)
    score += 10 if data.has_cover_photo else (obs.append("No cover photo") or 0)  # type: ignore[arg-type]
    bwe_pts, bwe_obs = _score_bio_work_edu(data)
    score += bwe_pts
    obs.extend(bwe_obs)
    score += 5 if data.has_relationship_status else 0
    if data.has_hometown and data.has_current_city:
        score += 10
    elif data.has_hometown or data.has_current_city:
        score += 5
    score += 15 if data.has_life_events else 0
    if not obs:
        obs.append("Profile is well-filled with specific, verifiable details")
    return SignalResult(
        signal_name="Profile Completeness", signal_number=1, weight=0.10,
        score=min(score, 100), flag=_flag(score), observations=obs,
    )


# ── Signal 2: Account Age vs Activity (10%) ──────────────────────────────────


def _score_age_checks(data: AccountActivity) -> tuple[int, list[str], bool]:
    score = 0
    obs: list[str] = []
    has_data = False
    if data.account_age_months is not None:
        has_data = True
        if data.account_age_months < 6:
            score -= 20
            obs.append(f"Account is young ({data.account_age_months} months)")
            if data.total_posts_visible is not None and data.total_posts_visible > 100:
                score -= 25
                obs.append("Abnormally high post count for a new account")
        elif data.account_age_months >= 24:
            score += 10
            obs.append(f"Account is {data.account_age_months} months old — established")
    if data.total_posts_visible is not None:
        has_data = True
    return score, obs, has_data


def _score_activity_patterns(data: AccountActivity) -> tuple[int, list[str], bool]:
    score = 0
    obs: list[str] = []
    has_data = False
    if data.had_dormant_period:
        has_data = True
        score -= 30
        obs.append("Account had long dormant period followed by sudden activity burst")
    if data.first_post_recency_days is not None:
        has_data = True
        if (data.account_age_months and data.account_age_months > 24
                and data.first_post_recency_days < 90):
            score -= 25
            obs.append(
                "Old account but first visible post is"
                " very recent — possible history wipe"
            )
    if not data.activity_ramp_gradual:
        has_data = True
        score -= 20
        obs.append("Activity started abruptly with no gradual ramp-up")
    return score, obs, has_data


def score_account_activity(data: AccountActivity) -> SignalResult:
    score = 70
    obs: list[str] = []
    age_pts, age_obs, hd1 = _score_age_checks(data)
    pat_pts, pat_obs, hd2 = _score_activity_patterns(data)
    score += age_pts + pat_pts
    obs.extend(age_obs)
    obs.extend(pat_obs)
    if not obs:
        obs.append("Account age and activity show natural organic progression")
    return SignalResult(
        signal_name="Account Age vs Activity Pattern", signal_number=2,
        weight=0.10, score=_clamp(score), flag=_flag(_clamp(score)),
        observations=obs, data_available=hd1 or hd2,
    )


# ── Signal 3: Friend Count & Network Quality (10%) ───────────────────────────


def _score_friend_count(data: NetworkInfo) -> tuple[int, list[str], bool]:
    score = 0
    obs: list[str] = []
    has_data = False
    if data.friend_count is not None:
        has_data = True
        if 100 <= data.friend_count <= 2000:
            score += 20
            obs.append(f"Friend count ({data.friend_count}) is in natural range")
        elif data.friend_count < 30:
            score -= 20
            obs.append(f"Very low friend count ({data.friend_count})")
        elif data.friend_count >= 4900:
            score -= 15
            obs.append(f"Friend count ({data.friend_count}) near Facebook cap — suspicious")
        elif data.friend_count > 2000:
            score += 5
    if data.mutual_friend_count is not None:
        has_data = True
        if data.mutual_friend_count > 5:
            score += 15
            obs.append(f"{data.mutual_friend_count} mutual friends — good sign")
        elif data.mutual_friend_count == 0:
            score -= 15
            obs.append("Zero mutual friends")
    return score, obs, has_data


def _score_friend_quality(data: NetworkInfo) -> tuple[int, list[str], bool]:
    score = 0
    obs: list[str] = []
    has_data = False
    if data.friends_single_gender_dominant:
        has_data = True
        score -= 15
        if data.dominant_gender_opposite_to_profile:
            score -= 10
            obs.append("Friends list heavily dominated by opposite gender — catfish indicator")
        else:
            obs.append("Friends list heavily skewed to one gender")
    if data.friends_geographically_scattered:
        has_data = True
        score -= 10
        obs.append("Friends from scattered, unrelated geographies")
    if data.friends_appear_fake:
        has_data = True
        score -= 25
        obs.append("Many friends also appear to be fake/low-quality profiles")
    if data.friend_list_hidden:
        has_data = True
        score -= 5
        obs.append("Friend list is hidden")
    return score, obs, has_data


def score_network(data: NetworkInfo) -> SignalResult:
    score = 60
    obs: list[str] = []
    fc_pts, fc_obs, hd1 = _score_friend_count(data)
    fq_pts, fq_obs, hd2 = _score_friend_quality(data)
    score += fc_pts + fq_pts
    obs.extend(fc_obs)
    obs.extend(fq_obs)
    if not obs:
        obs.append("Network appears natural and coherent")
    return SignalResult(
        signal_name="Friend Count & Network Quality", signal_number=3,
        weight=0.10, score=_clamp(score), flag=_flag(_clamp(score)),
        observations=obs, data_available=hd1 or hd2,
    )


# ── Signal 4: Post Timing Clustering (15%) — HIGH SIGNAL ─────────────────────


def score_post_timing(data: PostTiming) -> SignalResult:
    score = 80
    obs: list[str] = []

    if data.posts_spread_naturally:
        obs.append("Posts appear spread naturally across different times")
    else:
        score -= 15

    if data.bulk_posts_within_hour:
        score -= 25
        obs.append("Multiple posts published within a very short window (< 1 hour)")
        if data.bulk_pattern_repeats:
            score -= 20
            obs.append("Bulk-posting pattern repeats across multiple days")

    if data.consistent_exact_times:
        score -= 25
        obs.append("Posts consistently appear at exact same time — automation signature")

    if data.long_silence_then_burst:
        score -= 20
        obs.append("Long silence periods followed by sudden posting bursts")

    if data.timezone_mismatch:
        score -= 15
        obs.append("Posting times inconsistent with claimed timezone/location")

    if not obs:
        obs.append("Post timing shows natural human-like irregularity")

    return SignalResult(
        signal_name="Post Timing Clustering", signal_number=4,
        weight=0.15, score=_clamp(score), flag=_flag(_clamp(score)),
        observations=obs,
    )


# ── Signal 5: Engagement Gender Mismatch (15%) — HIGH SIGNAL / CATFISH ───────


def _score_gender_likes(data: EngagementGender) -> tuple[int, list[str], bool]:
    score = 0
    obs: list[str] = []
    has_data = False
    if data.pct_same_gender_likes is not None:
        has_data = True
        pct = data.pct_same_gender_likes
        if pct >= 0.40:
            score += 30
            obs.append(f"Healthy same-gender like ratio ({pct:.0%})")
        elif pct >= 0.15:
            score += 10
            obs.append(f"Slightly skewed gender engagement ({pct:.0%} same-gender likes)")
        elif pct >= 0.05:
            score -= 15
            obs.append(f"Heavily opposite-gender skewed likes ({pct:.0%} same-gender)")
        else:
            score -= 35
            obs.append(f"Virtually zero same-gender engagement on likes ({pct:.0%})")
    if data.pct_same_gender_comments is not None:
        has_data = True
        pct = data.pct_same_gender_comments
        if pct >= 0.40:
            score += 10
        elif pct < 0.10:
            score -= 15
            obs.append("Comments almost exclusively from opposite gender")
    return score, obs, has_data


def _score_gender_social(data: EngagementGender, has_data: bool) -> tuple[int, list[str], bool]:
    score = 0
    obs: list[str] = []
    if data.has_tagged_photos_with_same_gender:
        has_data = True
        score += 15
        obs.append("Has tagged photos with same-gender friends — strong authenticity signal")
    elif has_data:
        score -= 10
        obs.append("No tagged photos with same-gender friends")
    if data.has_personal_comments_from_same_gender:
        has_data = True
        score += 10
        obs.append("Personal/familiar comments from same-gender friends present")
    if data.comments_are_generic_thirsty:
        has_data = True
        score -= 20
        obs.append(
            "Comments are generic/thirsty ('hi beautiful',"
            " 'hello dear') — catfish magnet pattern"
        )
    return score, obs, has_data


def score_engagement_gender(data: EngagementGender) -> SignalResult:
    score = 50
    obs: list[str] = []
    lk_pts, lk_obs, hd = _score_gender_likes(data)
    sc_pts, sc_obs, hd = _score_gender_social(data, hd)
    score += lk_pts + sc_pts
    obs.extend(lk_obs)
    obs.extend(sc_obs)
    if not obs:
        obs.append("Insufficient engagement data to evaluate gender patterns")
    return SignalResult(
        signal_name="Engagement Gender Mismatch", signal_number=5,
        weight=0.15, score=_clamp(score), flag=_flag(_clamp(score)),
        observations=obs, data_available=hd,
    )


# ── Signal 6: Photo Authenticity (15%) — HIGH SIGNAL ─────────────────────────


def _score_photo_quality(data: PhotoAnalysis) -> tuple[int, list[str]]:
    score = 0
    obs: list[str] = []
    if data.photo_quality == PhotoQuality.MIXED and data.has_casual_candid_photos:
        score += 20
        obs.append("Mix of quality levels including casual/candid photos")
    elif data.photo_quality == PhotoQuality.PROFESSIONAL or data.all_professional_quality:
        score -= 20
        obs.append("All photos are professional/studio quality — no casual shots")
    elif data.photo_quality == PhotoQuality.AI_GENERATED or data.suspected_ai_generated:
        score -= 40
        obs.append("Photos appear to be AI-generated")
    if data.shows_progression_over_time:
        score += 10
        obs.append("Photos show natural progression over time (age, style changes)")
    else:
        score -= 15
        obs.append("No visible progression — same appearance across all photos")
    return score, obs


def _score_photo_social(data: PhotoAnalysis) -> tuple[int, list[str]]:
    score = 0
    obs: list[str] = []
    if data.consistent_real_environment:
        score += 5
    else:
        score -= 10
        obs.append("No consistent real-world environment across photos")
    if data.has_group_photos_tagged_by_others:
        score += 15
        obs.append("Has group photos tagged by other people — strong authenticity signal")
    else:
        score -= 10
        obs.append("No group photos tagged by others")
    if data.reverse_search_matches_elsewhere:
        score -= 35
        obs.append(
            "Reverse image search found matches on other"
            " profiles/sites — likely stolen photos"
        )
    if data.only_selfies:
        score -= 10
        obs.append("Only selfies — no photos taken by others, no event photos")
    return score, obs


def score_photos(data: PhotoAnalysis) -> SignalResult:
    score = 60
    obs: list[str] = []
    pq_pts, pq_obs = _score_photo_quality(data)
    ps_pts, ps_obs = _score_photo_social(data)
    score += pq_pts + ps_pts
    obs.extend(pq_obs)
    obs.extend(ps_obs)
    if not obs:
        obs.append("Photo collection appears authentic")
    return SignalResult(
        signal_name="Photo Authenticity", signal_number=6,
        weight=0.15, score=_clamp(score), flag=_flag(_clamp(score)),
        observations=obs,
    )


# ── Signal 7: Content Pattern (10%) ──────────────────────────────────────────


def _score_content_positive(data: ContentPattern) -> tuple[int, list[str]]:
    score = 0
    obs: list[str] = []
    if data.has_original_text_posts:
        score += 15
        obs.append("Posts original text content")
    if data.has_personal_updates:
        score += 10
        obs.append("Shares personal updates about daily life")
    if data.has_check_ins:
        score += 10
        obs.append("Has location check-ins at real places")
    if data.has_birthday_wishes_from_friends:
        score += 15
        obs.append("Friends post birthday wishes on their timeline — strong real indicator")
    if data.has_life_event_posts:
        score += 10
    return score, obs


def _score_content_negative(data: ContentPattern) -> tuple[int, list[str]]:
    score = 0
    obs: list[str] = []
    if data.mostly_shared_memes_quotes:
        score -= 20
        obs.append("Content is mostly shared memes, quotes, and viral videos — no original posts")
    if not data.language_matches_location:
        score -= 15
        obs.append("Language of posts inconsistent with claimed location")
    if data.content_feels_engagement_bait:
        score -= 20
        obs.append("Content appears designed to attract engagement rather than share with friends")
    return score, obs


def score_content(data: ContentPattern) -> SignalResult:
    score = 50
    obs: list[str] = []
    pos_pts, pos_obs = _score_content_positive(data)
    neg_pts, neg_obs = _score_content_negative(data)
    score += pos_pts + neg_pts
    obs.extend(pos_obs)
    obs.extend(neg_obs)
    if not obs:
        obs.append("Content pattern shows normal mix of personal and shared content")
    return SignalResult(
        signal_name="Content Pattern Analysis", signal_number=7,
        weight=0.10, score=_clamp(score), flag=_flag(_clamp(score)),
        observations=obs,
    )


# ── Signal 8: Interaction Behavior (10%) ──────────────────────────────────────


def _score_interaction_positive(data: InteractionBehavior) -> tuple[int, list[str]]:
    score = 0
    obs: list[str] = []
    if data.has_two_way_conversations:
        score += 15
        obs.append("Has natural two-way conversations in post comments")
    if data.tagged_in_others_content:
        score += 15
        obs.append("Tagged in other people's content")
    return score, obs


def _score_interaction_negative(data: InteractionBehavior) -> tuple[int, list[str]]:
    score = 0
    obs: list[str] = []
    if data.sends_requests_to_strangers:
        score -= 20
        obs.append("Sends friend requests to strangers aggressively")
    if data.one_directional_engagement:
        score -= 15
        obs.append("Engagement is one-directional — comments outward but gets no genuine replies")
    if data.member_of_many_groups:
        score -= 10
        obs.append(
            "Member of many public groups (buy/sell,"
            " dating, etc.) — common for scam profiles"
        )
    if data.moves_to_dms_quickly:
        score -= 20
        obs.append("Quickly moves conversations to DMs or external platforms (WhatsApp/Telegram)")
    if data.posts_relationship_seeking:
        score -= 15
        obs.append("Posts public relationship-seeking content")
    return score, obs


def score_interaction(data: InteractionBehavior) -> SignalResult:
    score = 65
    obs: list[str] = []
    pos_pts, pos_obs = _score_interaction_positive(data)
    neg_pts, neg_obs = _score_interaction_negative(data)
    score += pos_pts + neg_pts
    obs.extend(pos_obs)
    obs.extend(neg_obs)
    if not obs:
        obs.append("Interaction behavior appears normal")
    return SignalResult(
        signal_name="Interaction Behavior", signal_number=8,
        weight=0.10, score=_clamp(score), flag=_flag(_clamp(score)),
        observations=obs,
    )


# ── Signal 9: Name & Identity Consistency (5%) ───────────────────────────────


def _score_name_checks(data: NameIdentity) -> tuple[int, list[str]]:
    score = 0
    obs: list[str] = []
    if data.name_matches_apparent_ethnicity:
        score += 10
        obs.append("Name is consistent with apparent ethnic/cultural background")
    else:
        score -= 25
        obs.append("Name doesn't match apparent ethnicity of person in photos")
    if data.has_random_numbers_in_name:
        score -= 20
        obs.append("Name contains random numbers or characters")
    if data.unusual_formatting:
        score -= 15
        obs.append("Display name has unusual formatting (ALL CAPS, excessive punctuation)")
    if data.multiple_name_changes:
        score -= 15
        obs.append("Profile shows multiple name changes")
    if not data.identity_markers_consistent:
        score -= 20
        obs.append("Location, language, name, and appearance don't form a coherent identity")
    if not data.has_vanity_url:
        score -= 10
        obs.append("Profile URL uses random numbers instead of a vanity URL")
    return score, obs


def score_name_identity(data: NameIdentity) -> SignalResult:
    score = 75
    obs: list[str] = []
    chk_pts, chk_obs = _score_name_checks(data)
    score += chk_pts
    obs.extend(chk_obs)
    if not obs:
        obs.append("Name and identity markers are consistent")
    return SignalResult(
        signal_name="Name & Identity Consistency", signal_number=9,
        weight=0.05, score=_clamp(score), flag=_flag(_clamp(score)),
        observations=obs,
    )
