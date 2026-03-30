"""API endpoint tests using httpx TestClient."""

from fastapi.testclient import TestClient

from analyzer.api import app

client = TestClient(app)


class TestHealthEndpoint:
    def test_health_returns_ok(self):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["version"] == "1.0.0"


class TestAnalyzeEndpoint:
    def test_minimal_payload(self):
        resp = client.post("/api/analyze", json={"profile_name": "Test"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["profile_name"] == "Test"
        assert "final_score" in data
        assert "verdict" in data
        assert "signals" in data
        assert len(data["signals"]) == 9

    def test_full_real_profile(self):
        payload = {
            "profile_name": "Jane Doe",
            "completeness": {
                "has_profile_photo": True,
                "profile_photo_type": "real",
                "has_cover_photo": True,
                "has_bio": True,
                "bio_is_generic": False,
                "has_work_history": True,
                "work_is_specific": True,
                "has_education": True,
                "education_is_specific": True,
                "has_relationship_status": True,
                "has_hometown": True,
                "has_current_city": True,
                "has_life_events": True,
            },
            "activity": {
                "account_age_months": 84,
                "total_posts_visible": 300,
                "activity_ramp_gradual": True,
            },
            "network": {
                "friend_count": 600,
                "mutual_friend_count": 20,
            },
            "post_timing": {"posts_spread_naturally": True},
            "engagement_gender": {
                "pct_same_gender_likes": 0.50,
                "pct_same_gender_comments": 0.45,
                "has_tagged_photos_with_same_gender": True,
                "has_personal_comments_from_same_gender": True,
            },
            "photos": {
                "photo_quality": "mixed",
                "has_casual_candid_photos": True,
                "shows_progression_over_time": True,
                "consistent_real_environment": True,
                "has_group_photos_tagged_by_others": True,
            },
            "content": {
                "has_original_text_posts": True,
                "has_personal_updates": True,
                "has_check_ins": True,
                "has_birthday_wishes_from_friends": True,
            },
            "interaction": {
                "has_two_way_conversations": True,
                "tagged_in_others_content": True,
            },
            "name_identity": {
                "name_matches_apparent_ethnicity": True,
                "identity_markers_consistent": True,
                "has_vanity_url": True,
            },
        }
        resp = client.post("/api/analyze", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["final_score"] >= 80
        assert data["verdict"] in ("verified_real", "likely_real")

    def test_catfish_payload(self):
        payload = {
            "profile_name": "Fake Person",
            "post_timing": {
                "bulk_posts_within_hour": True,
                "bulk_pattern_repeats": True,
                "consistent_exact_times": True,
                "long_silence_then_burst": True,
                "timezone_mismatch": True,
                "posts_spread_naturally": False,
            },
            "engagement_gender": {
                "pct_same_gender_likes": 0.01,
                "pct_same_gender_comments": 0.0,
                "comments_are_generic_thirsty": True,
            },
            "photos": {
                "all_professional_quality": True,
                "has_casual_candid_photos": False,
                "shows_progression_over_time": False,
                "consistent_real_environment": False,
                "suspected_ai_generated": True,
                "photo_quality": "ai_generated",
                "reverse_search_matches_elsewhere": True,
                "only_selfies": True,
            },
        }
        resp = client.post("/api/analyze", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["catfish_override"] is True
        assert data["verdict"] == "catfish_pattern"

    def test_empty_json_still_works(self):
        resp = client.post("/api/analyze", json={})
        assert resp.status_code == 200
        data = resp.json()
        assert data["profile_name"] == "Unknown"
        assert len(data["signals"]) == 9

    def test_invalid_payload_returns_422(self):
        resp = client.post(
            "/api/analyze",
            json={"completeness": {"has_profile_photo": "not_a_bool"}},
        )
        assert resp.status_code == 422

    def test_partial_signals_handled(self):
        """Only provide some signal sections."""
        resp = client.post("/api/analyze", json={
            "profile_name": "Partial",
            "network": {"friend_count": 200},
        })
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["signals"]) == 9

    def test_response_structure(self):
        resp = client.post("/api/analyze", json={"profile_name": "Structure"})
        data = resp.json()

        # Top-level fields
        required_fields = [
            "profile_name", "final_score", "verdict", "verdict_label",
            "verdict_emoji", "catfish_override", "confidence", "signals",
            "top_evidence", "recommendation", "recommendation_emoji", "next_steps",
        ]
        for field in required_fields:
            assert field in data, f"Missing field: {field}"

        # Signal structure
        sig = data["signals"][0]
        sig_fields = [
            "signal_name", "signal_number", "weight",
            "score", "flag", "observations", "data_available",
        ]
        for field in sig_fields:
            assert field in sig, f"Missing signal field: {field}"

    def test_score_boundaries(self):
        """Score must be between 0 and 100."""
        resp = client.post("/api/analyze", json={})
        data = resp.json()
        assert 0 <= data["final_score"] <= 100
        for sig in data["signals"]:
            assert 0 <= sig["score"] <= 100


class TestConcurrentRequests:
    def test_multiple_analyses(self):
        """Engine is stateless — multiple calls should work independently."""
        payloads = [
            {"profile_name": "User A", "network": {"friend_count": 500}},
            {"profile_name": "User B", "network": {"friend_count": 10}},
            {"profile_name": "User C", "network": {"friend_count": 5000}},
        ]
        results = []
        for p in payloads:
            resp = client.post("/api/analyze", json=p)
            assert resp.status_code == 200
            results.append(resp.json())

        assert results[0]["profile_name"] == "User A"
        assert results[1]["profile_name"] == "User B"
        assert results[2]["profile_name"] == "User C"
        # User B (very low friends) should score lower on network than User A
        sig3_a = next(s for s in results[0]["signals"] if s["signal_number"] == 3)
        sig3_b = next(s for s in results[1]["signals"] if s["signal_number"] == 3)
        assert sig3_a["score"] > sig3_b["score"]
