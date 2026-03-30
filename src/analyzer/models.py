"""Pydantic models for profile data and analysis results."""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field

# ── Input Models ──────────────────────────────────────────────────────────────


class GenderPresentation(str, Enum):
    FEMALE = "female"
    MALE = "male"
    OTHER = "other"


class PhotoQuality(str, Enum):
    PROFESSIONAL = "professional"
    MIXED = "mixed"
    CASUAL = "casual"
    AI_GENERATED = "ai_generated"
    UNKNOWN = "unknown"


class ProfileCompleteness(BaseModel):
    """Signal 1 inputs."""

    has_profile_photo: bool = False
    profile_photo_type: str = "unknown"  # real, stock, ai_generated, stolen, unknown
    has_cover_photo: bool = False
    has_bio: bool = False
    bio_is_generic: bool = True  # "Living life" vs specific details
    has_work_history: bool = False
    work_is_specific: bool = False  # Real company names vs "Self-Employed"
    has_education: bool = False
    education_is_specific: bool = False
    has_relationship_status: bool = False
    has_hometown: bool = False
    has_current_city: bool = False
    has_life_events: bool = False


class AccountActivity(BaseModel):
    """Signal 2 inputs."""

    account_age_months: int | None = None
    total_posts_visible: int | None = None
    first_post_recency_days: int | None = None  # How many days ago was the first visible post
    had_dormant_period: bool = False  # Long silence then sudden burst
    activity_ramp_gradual: bool = True


class NetworkInfo(BaseModel):
    """Signal 3 inputs."""

    friend_count: int | None = None
    mutual_friend_count: int | None = None
    friends_single_gender_dominant: bool = False  # >80% one gender
    dominant_gender_opposite_to_profile: bool = False
    friends_geographically_scattered: bool = False
    friends_appear_fake: bool = False
    friend_list_hidden: bool = False


class PostTiming(BaseModel):
    """Signal 4 inputs."""

    bulk_posts_within_hour: bool = False  # 3+ posts in < 1 hour
    bulk_pattern_repeats: bool = False  # Happens on multiple days
    consistent_exact_times: bool = False  # Posts at same time daily (automation)
    long_silence_then_burst: bool = False
    timezone_mismatch: bool = False
    posts_spread_naturally: bool = True


class EngagementGender(BaseModel):
    """Signal 5 inputs."""

    profile_presents_as: GenderPresentation = GenderPresentation.FEMALE
    pct_same_gender_likes: float | None = None  # 0.0–1.0
    pct_same_gender_comments: float | None = None
    has_tagged_photos_with_same_gender: bool = False
    has_personal_comments_from_same_gender: bool = False  # Inside jokes, birthday wishes
    comments_are_generic_thirsty: bool = False  # "hi beautiful", "hello dear"


class PhotoAnalysis(BaseModel):
    """Signal 6 inputs."""

    all_professional_quality: bool = False
    has_casual_candid_photos: bool = True
    shows_progression_over_time: bool = True
    consistent_real_environment: bool = True  # Same home, office, etc.
    has_group_photos_tagged_by_others: bool = False
    suspected_ai_generated: bool = False
    reverse_search_matches_elsewhere: bool = False
    only_selfies: bool = False
    photo_quality: PhotoQuality = PhotoQuality.MIXED


class ContentPattern(BaseModel):
    """Signal 7 inputs."""

    has_original_text_posts: bool = False
    has_personal_updates: bool = False  # Day, feelings, opinions
    has_check_ins: bool = False
    has_birthday_wishes_from_friends: bool = False
    has_life_event_posts: bool = False
    mostly_shared_memes_quotes: bool = False
    language_matches_location: bool = True
    content_feels_engagement_bait: bool = False


class InteractionBehavior(BaseModel):
    """Signal 8 inputs."""

    sends_requests_to_strangers: bool = False
    one_directional_engagement: bool = False  # Comments but gets no replies
    member_of_many_groups: bool = False  # Buy/sell, dating, religious
    moves_to_dms_quickly: bool = False
    posts_relationship_seeking: bool = False  # "Looking for serious relationship"
    has_two_way_conversations: bool = True
    tagged_in_others_content: bool = False


class NameIdentity(BaseModel):
    """Signal 9 inputs."""

    name_matches_apparent_ethnicity: bool = True
    has_random_numbers_in_name: bool = False
    unusual_formatting: bool = False  # ALL CAPS, excessive punctuation
    multiple_name_changes: bool = False
    identity_markers_consistent: bool = True  # Location, language, appearance align
    has_vanity_url: bool = True  # vs random number URL


class ProfileData(BaseModel):
    """Complete profile data for analysis."""

    profile_name: str = "Unknown"
    profile_url: str | None = None

    completeness: ProfileCompleteness = Field(default_factory=ProfileCompleteness)
    activity: AccountActivity = Field(default_factory=AccountActivity)
    network: NetworkInfo = Field(default_factory=NetworkInfo)
    post_timing: PostTiming = Field(default_factory=PostTiming)
    engagement_gender: EngagementGender = Field(default_factory=EngagementGender)
    photos: PhotoAnalysis = Field(default_factory=PhotoAnalysis)
    content: ContentPattern = Field(default_factory=ContentPattern)
    interaction: InteractionBehavior = Field(default_factory=InteractionBehavior)
    name_identity: NameIdentity = Field(default_factory=NameIdentity)


# ── Output Models ─────────────────────────────────────────────────────────────


class SignalFlag(str, Enum):
    CLEAN = "clean"
    YELLOW = "yellow"
    RED = "red"


class Verdict(str, Enum):
    VERIFIED_REAL = "verified_real"
    LIKELY_REAL = "likely_real"
    SUSPICIOUS = "suspicious"
    LIKELY_FAKE = "likely_fake"
    ALMOST_CERTAINLY_FAKE = "almost_certainly_fake"
    CATFISH_PATTERN = "catfish_pattern"


class ConfidenceLevel(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class SignalResult(BaseModel):
    """Result for a single signal evaluation."""

    signal_name: str
    signal_number: int
    weight: float
    score: int = Field(ge=0, le=100)
    flag: SignalFlag
    observations: list[str]
    data_available: bool = True


class AnalysisResult(BaseModel):
    """Complete analysis output."""

    profile_name: str
    final_score: float
    verdict: Verdict
    verdict_label: str
    verdict_emoji: str
    catfish_override: bool = False
    confidence: ConfidenceLevel
    signals: list[SignalResult]
    top_evidence: list[str]
    recommendation: str
    recommendation_emoji: str
    next_steps: list[str]
