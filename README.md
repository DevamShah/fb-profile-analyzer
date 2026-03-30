# Facebook Profile Authenticity Analyzer

Chrome extension + API that detects fake Facebook profiles using 9-signal weighted scoring. Visit any Facebook profile and get an instant authenticity verdict — no manual data entry.

## Chrome Extension (Primary)

The extension automatically scrapes Facebook profile pages and shows a verdict overlay directly on the page.

### Install

1. Clone this repo
2. Open Chrome → `chrome://extensions`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" → select the `extension/` folder
5. Navigate to any Facebook profile — the analyzer runs automatically

### How It Works

- Detects when you're on a Facebook profile page
- Scrapes visible profile data from the DOM (name, photos, friends, posts, engagement, etc.)
- Runs the 9-signal scoring engine entirely in-browser (no server, no data sent anywhere)
- Shows a floating verdict panel with score, signal breakdown, and recommendations
- Works on public profiles (no login) and full profiles (logged in via your session)
- Click the shield button or use the popup to re-scan

### What It Scrapes

| Signal | What It Reads |
|--------|---------------|
| Profile Completeness | Photo, cover, bio, work, education, location, life events |
| Account Age | "Joined" date, post count |
| Network | Friend count, mutual friends |
| Post Timing | Post timestamps — detects bulk posting, automation, silence/burst |
| Engagement Gender | Comment patterns, thirsty comment detection |
| Photo Authenticity | Photo sections, tagged photos, album types |
| Content Pattern | Original vs shared posts, check-ins, birthday wishes |
| Interaction | Comment threads, tagged content, relationship-seeking |
| Identity | Name formatting, URL type, name changes |

## REST API (Standalone)

For programmatic use or custom integrations.

```bash
# Install
pip install -e ".[dev]"

# Run tests (105 tests, 97% coverage)
pytest -v --cov=analyzer

# Start server
uvicorn analyzer.api:app --reload

# Or with Docker
docker compose up
```

### POST /api/analyze

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

## Signal Weights

| # | Signal | Weight | Why |
|---|--------|--------|-----|
| 1 | Profile Completeness | 10% | Easy to fake |
| 2 | Account Age vs Activity | 10% | Useful but gameable |
| 3 | Friend Count & Network | 10% | Moderate signal |
| 4 | **Post Timing Clustering** | **15%** | Hard to fake naturally |
| 5 | **Engagement Gender Mismatch** | **15%** | #1 catfish detector |
| 6 | **Photo Authenticity** | **15%** | Core catfish mechanism |
| 7 | Content Pattern | 10% | Moderate signal |
| 8 | Interaction Behavior | 10% | Behavioral patterns |
| 9 | Name & Identity | 5% | Weak alone |

## Catfish Combo Auto-Flag

If signals 4 (Post Timing) + 5 (Gender Engagement) + 6 (Photos) ALL score below 30, the verdict is automatically overridden to **CATFISH PATTERN DETECTED** regardless of other signals. This combination catches 80%+ of romance scam profiles.

## Verdict Tiers

| Score | Verdict |
|-------|---------|
| 90-100 | Verified Real |
| 70-89 | Likely Real |
| 50-69 | Suspicious |
| 30-49 | Likely Fake |
| 0-29 | Almost Certainly Fake |

## Privacy

- **No data leaves your browser** — the extension runs entirely locally
- **No tracking, no analytics, no accounts**
- **The API is stateless** — input is processed and discarded, nothing is stored
- Open source — audit the code yourself

## License

MIT
