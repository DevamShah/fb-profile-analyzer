# Facebook Profile Authenticity Analyzer

9-signal weighted scoring engine for detecting fake Facebook profiles. Analyzes profile data across completeness, account age, network quality, post timing, engagement gender patterns, photo authenticity, content patterns, interaction behavior, and identity consistency.

## Features

- **9 weighted signals** with individual sub-scores (0-100)
- **Catfish combo auto-flag** — if post timing, gender engagement, and photo authenticity all score below 30, overrides to catfish verdict regardless of other signals
- **5 verdict tiers** — Verified Real, Likely Real, Suspicious, Likely Fake, Almost Certainly Fake
- **REST API** (FastAPI) + **Web UI** for interactive analysis
- **Confidence levels** based on data availability
- **Actionable recommendations** with next-step suggestions

## Quick Start

```bash
# Install
pip install -e ".[dev]"

# Run tests
pytest -v --cov=analyzer

# Start server
uvicorn analyzer.api:app --reload

# Or with Docker
docker compose up
```

Open http://localhost:8000 for the web UI, or POST to `/api/analyze`.

## API

### POST /api/analyze

Send profile data, get back a full authenticity assessment.

```bash
curl -X POST http://localhost:8000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "profile_name": "Test User",
    "network": {"friend_count": 4950, "mutual_friend_count": 0},
    "post_timing": {"bulk_posts_within_hour": true, "posts_spread_naturally": false},
    "engagement_gender": {"pct_same_gender_likes": 0.02, "comments_are_generic_thirsty": true},
    "photos": {"all_professional_quality": true, "suspected_ai_generated": true}
  }'
```

### GET /api/health

Returns `{"status": "ok", "version": "1.0.0"}`.

## Signal Weights

| # | Signal | Weight |
|---|--------|--------|
| 1 | Profile Completeness | 10% |
| 2 | Account Age vs Activity | 10% |
| 3 | Friend Count & Network | 10% |
| 4 | Post Timing Clustering | **15%** |
| 5 | Engagement Gender Mismatch | **15%** |
| 6 | Photo Authenticity | **15%** |
| 7 | Content Pattern | 10% |
| 8 | Interaction Behavior | 10% |
| 9 | Name & Identity | 5% |

## License

MIT
