/**
 * Facebook DOM Scraper v2 — extracts profile signals from the current page.
 *
 * Strategy: Facebook obfuscates CSS class names, so we NEVER rely on classes.
 * Instead we use:
 *   1. aria-label attributes (accessibility, fairly stable)
 *   2. role attributes (semantic, stable)
 *   3. Text content pattern matching (most reliable)
 *   4. data-pagelet attributes (semi-stable)
 *   5. Structural/positional heuristics
 *   6. Full page text scan as fallback
 */

/* exported FBScraper */
const FBScraper = (() => {
  "use strict";

  // ── Core helpers ─────────────────────────────────────────────────────

  /** Query all matching elements. */
  function $$(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  /** Get ALL visible text spans on the page (cached per scan). */
  let _spanCache = null;
  function allSpans() {
    if (!_spanCache) {
      _spanCache = $$("span, a").map(el => ({
        el,
        text: (el.textContent || "").trim(),
        lower: (el.textContent || "").trim().toLowerCase(),
      })).filter(o => o.text.length > 0 && o.text.length < 500);
    }
    return _spanCache;
  }

  /** Find spans whose text matches a pattern. */
  function findSpans(regex) {
    return allSpans().filter(o => regex.test(o.lower));
  }

  /** Find spans that start with exact text. */
  function findStartsWith(...prefixes) {
    return allSpans().filter(o =>
      prefixes.some(p => o.lower.startsWith(p.toLowerCase()))
    );
  }

  /** Find spans containing exact substring. */
  function findContains(...terms) {
    return allSpans().filter(o =>
      terms.some(t => o.lower.includes(t.toLowerCase()))
    );
  }

  /** Extract a number from text like "1,234 friends" */
  function extractNumber(text) {
    const m = text.replace(/,/g, "").match(/(\d+)/);
    return m ? parseInt(m[1]) : null;
  }

  /** Full page text (cached). */
  let _pageText = null;
  function pageText() {
    if (!_pageText) _pageText = (document.body.innerText || "").toLowerCase();
    return _pageText;
  }

  /** Get the profile name from <h1> or page title. */
  function getProfileName() {
    // Facebook profile pages have the name in an h1
    const h1s = $$("h1");
    for (const h of h1s) {
      const t = h.textContent.trim();
      // Skip h1s that are clearly not the name (too long, or generic)
      if (t.length > 0 && t.length < 60 && !t.includes("Facebook")) return t;
    }
    return document.title.replace(/\s*[-|]\s*Facebook.*$/i, "").trim() || "Unknown";
  }

  // ── Profile page detection ───────────────────────────────────────────

  function isProfilePage() {
    const url = window.location.href;
    const path = window.location.pathname;

    // Explicit profile URLs
    if (url.includes("/profile.php")) return true;
    if (url.includes("/people/")) return true;

    // Profile-specific DOM markers
    if (document.querySelector('[data-pagelet="ProfileActions"]')) return true;
    if (document.querySelector('[data-pagelet="ProfileTilesFeed"]')) return true;
    if (document.querySelector('[aria-label*="profile picture" i]')) return true;
    if (document.querySelector('[aria-label*="Cover photo" i]')) return true;

    // Check for "Add Friend" or "Message" or "Following" buttons (profile actions)
    const profileActions = findContains("add friend", "message", "following", "follow");
    const hasProfileButtons = profileActions.some(o => {
      const tag = o.el.tagName.toLowerCase();
      return tag === "span" && o.el.closest('[role="button"], button');
    });
    if (hasProfileButtons) return true;

    // Single-segment path that's not a known non-profile route
    const segments = path.split("/").filter(Boolean);
    const nonProfileRoutes = [
      "watch", "groups", "events", "marketplace", "gaming",
      "search", "notifications", "messages", "settings",
      "stories", "reels", "feeds", "bookmarks", "pages",
    ];
    if (segments.length === 1 && !nonProfileRoutes.includes(segments[0])) return true;

    return false;
  }

  // ── Signal 1: Profile Completeness ───────────────────────────────────

  function scrapeCompleteness() {
    const d = {
      hasProfilePhoto: false, profilePhotoType: "unknown",
      hasCoverPhoto: false, hasBio: false, bioIsGeneric: true,
      hasWork: false, workIsSpecific: false,
      hasEducation: false, educationIsSpecific: false,
      hasRelationship: false, hasHometown: false,
      hasCurrentCity: false, hasLifeEvents: false,
    };

    // Profile photo — look for large circular image or aria-label
    const pfpByAria = document.querySelector(
      '[aria-label*="profile picture" i], [aria-label*="Profile photo" i]'
    );
    const svgImages = $$("svg image, image[href], image[xlink\\:href]");
    const largeSvgImg = svgImages.find(img => {
      const w = parseInt(img.getAttribute("width") || img.getAttribute("height") || "0");
      return w >= 100;
    });

    if (pfpByAria || largeSvgImg) {
      d.hasProfilePhoto = true;
      d.profilePhotoType = "real";
    }

    // Cover photo
    const coverByAria = document.querySelector(
      '[aria-label*="cover photo" i], [aria-label*="Cover photo" i]'
    );
    const coverByPagelet = document.querySelector('[data-pagelet*="Cover" i]');
    d.hasCoverPhoto = !!(coverByAria || (coverByPagelet && coverByPagelet.querySelector("img")));

    // Work — "Works at X", "Worked at X"
    const workSpans = findSpans(/works?\s+at\s/i);
    if (workSpans.length > 0) {
      d.hasWork = true;
      const workText = workSpans[0].lower;
      const vagueJobs = ["self-employed", "freelancer", "entrepreneur", "ceo", "boss", "own business"];
      d.workIsSpecific = !vagueJobs.some(v => workText.includes(v));
    }

    // Education — "Studied at X", "Went to X", "Goes to X"
    const eduSpans = findSpans(/(?:studied|went|goes)\s+(?:at|to)\s/i);
    if (eduSpans.length > 0) {
      d.hasEducation = true;
      const eduText = eduSpans[0].lower;
      const vagueEdu = ["school of hard knocks", "university of life", "school of life", "life"];
      d.educationIsSpecific = !vagueEdu.some(v => eduText.includes(v));
    }

    // Current city — "Lives in X"
    const livesIn = findSpans(/lives\s+in\s/i);
    d.hasCurrentCity = livesIn.length > 0;

    // Hometown — "From X"
    const fromSpans = findStartsWith("from ");
    // Filter out false positives (too long = probably not the intro item)
    d.hasHometown = fromSpans.some(o => o.text.length < 50);

    // Relationship — look for status keywords in intro area
    const relKeywords = findContains("married", "in a relationship", "engaged", "single", "divorced", "widowed");
    d.hasRelationship = relKeywords.some(o => o.text.length < 60);

    // Bio / Intro text — look for quoted text or short descriptive spans near intro
    const introLabel = findContains("intro");
    if (introLabel.length > 0) {
      d.hasBio = true;
      // Check the nearby area for generic vs specific content
      const pt = pageText();
      const genericPhrases = ["living life", "just me", "blessed", "god is good",
        "vibes only", "king", "queen", "no bio", "living my best"];
      d.bioIsGeneric = genericPhrases.some(p => pt.includes(p));
    }

    // Life events — "Joined Facebook", year milestones
    const lifeEvents = findContains("joined facebook", "life event", "got married", "had a baby", "moved to");
    d.hasLifeEvents = lifeEvents.length > 0;

    return d;
  }

  // ── Signal 2: Account Age / Activity ─────────────────────────────────

  function scrapeActivity() {
    const d = {
      accountAgeMonths: null, totalPosts: null,
      hadDormantPeriod: false, activityRampGradual: true,
    };

    // "Joined [Month] [Year]" or "Joined in [Year]"
    const joinedSpans = findSpans(/joined\s+(?:facebook\s+)?(?:in\s+)?(?:on\s+)?\w+\s+\d{4}/i);
    for (const o of joinedSpans) {
      const m = o.text.match(/(\w+)\s+(\d{4})/i);
      if (m) {
        const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
        const mi = months.findIndex(mn => m[1].toLowerCase().startsWith(mn));
        const yr = parseInt(m[2]);
        if (mi >= 0 && yr > 2000 && yr <= new Date().getFullYear()) {
          const joined = new Date(yr, mi);
          d.accountAgeMonths = Math.max(0, Math.floor((Date.now() - joined) / (1000 * 60 * 60 * 24 * 30.44)));
          break;
        }
      }
    }

    // Also try just finding a year near "Joined"
    if (d.accountAgeMonths === null) {
      const joinedSimple = findContains("joined");
      for (const o of joinedSimple) {
        const m = o.text.match(/(\d{4})/);
        if (m) {
          const yr = parseInt(m[1]);
          if (yr > 2004 && yr <= new Date().getFullYear()) {
            d.accountAgeMonths = (new Date().getFullYear() - yr) * 12;
            break;
          }
        }
      }
    }

    // Count visible posts / articles
    const articles = $$('[role="article"]');
    d.totalPosts = articles.length > 0 ? articles.length : null;

    return d;
  }

  // ── Signal 3: Network ────────────────────────────────────────────────

  function scrapeNetwork() {
    const d = {
      friendCount: null, mutualFriends: null,
      friendsGenderSkewed: false, friendsOppositeGender: false,
      friendsAppearFake: false,
    };

    // "X friends" — look in tabs, headers, or any link/span
    const friendSpans = findSpans(/[\d,]+\s*friends?\b/i);
    for (const o of friendSpans) {
      // Avoid "X mutual friends" for this field
      if (o.lower.includes("mutual")) continue;
      const n = extractNumber(o.text);
      if (n !== null && n > 0) {
        d.friendCount = n;
        break;
      }
    }

    // "X mutual friends"
    const mutualSpans = findSpans(/[\d,]+\s*mutual\s*friends?/i);
    for (const o of mutualSpans) {
      const n = extractNumber(o.text);
      if (n !== null) {
        d.mutualFriends = n;
        break;
      }
    }

    // Also check for "X followers" if no friends found (public figure)
    if (d.friendCount === null) {
      const followerSpans = findSpans(/[\d,]+[kKmM]?\s*followers?\b/i);
      for (const o of followerSpans) {
        let text = o.text.toLowerCase().replace(/,/g, "");
        const mK = text.match(/([\d.]+)\s*k/);
        const mM = text.match(/([\d.]+)\s*m/);
        if (mM) { d.friendCount = Math.round(parseFloat(mM[1]) * 1000000); break; }
        if (mK) { d.friendCount = Math.round(parseFloat(mK[1]) * 1000); break; }
        const n = extractNumber(text);
        if (n) { d.friendCount = n; break; }
      }
    }

    return d;
  }

  // ── Signal 4: Post Timing ────────────────────────────────────────────

  function scrapePostTiming() {
    const d = {
      postsSpreadNaturally: true, bulkPostsWithinHour: false,
      bulkPatternRepeats: false, consistentExactTimes: false,
      silenceThenBurst: false, timezoneMismatch: false,
    };

    // Collect timestamps from posts
    // Facebook uses <a> elements with aria-label containing dates for post timestamps
    const timestamps = [];

    // Method 1: aria-label on timestamp links (most reliable in modern FB)
    const timeLinks = $$('a[href*="/posts/"], a[href*="/photos/"], a[href*="story_fbid"], a[aria-label]');
    for (const link of timeLinks) {
      const label = link.getAttribute("aria-label") || "";
      // Patterns: "March 15, 2024 at 3:45 PM", "January 1, 2023", etc.
      const dateMatch = label.match(
        /(\w+\s+\d{1,2},?\s+\d{4}(?:\s+at\s+\d{1,2}:\d{2}\s*[AP]M)?)/i
      );
      if (dateMatch) {
        const parsed = new Date(dateMatch[1].replace(" at ", " "));
        if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 2004) {
          timestamps.push(parsed.getTime());
        }
      }
    }

    // Method 2: <abbr> with data-utime (old FB, still sometimes present)
    for (const el of $$("abbr[data-utime]")) {
      timestamps.push(parseInt(el.getAttribute("data-utime")) * 1000);
    }

    // Method 3: Tooltip titles on timestamp elements
    const titleEls = $$('[role="article"] a[title], [role="article"] span[title]');
    for (const el of titleEls) {
      const t = el.getAttribute("title") || "";
      const parsed = new Date(t);
      if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 2004) {
        timestamps.push(parsed.getTime());
      }
    }

    // Method 4: Look for relative time patterns and approximate
    if (timestamps.length < 3) {
      const relTimeSpans = findSpans(/^\d+\s*[hdm]\s*$/i);  // "3h", "45m", "2d"
      const now = Date.now();
      for (const o of relTimeSpans) {
        const hm = o.text.match(/(\d+)\s*h/i);
        const dm = o.text.match(/(\d+)\s*d/i);
        const mm = o.text.match(/(\d+)\s*m/i);
        if (hm) timestamps.push(now - parseInt(hm[1]) * 3600000);
        else if (dm) timestamps.push(now - parseInt(dm[1]) * 86400000);
        else if (mm) timestamps.push(now - parseInt(mm[1]) * 60000);
      }
    }

    // Analyze timestamp patterns
    if (timestamps.length >= 3) {
      const sorted = [...new Set(timestamps)].sort((a, b) => a - b);

      // Bulk posting: 3+ within 1 hour
      for (let i = 0; i <= sorted.length - 3; i++) {
        if (sorted[i + 2] - sorted[i] < 3600000) {
          d.bulkPostsWithinHour = true;
          d.postsSpreadNaturally = false;
          break;
        }
      }

      // Silence then burst
      if (sorted.length >= 4) {
        const gaps = [];
        for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i] - sorted[i - 1]);
        const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        if (gaps.some(g => g > avgGap * 5) && gaps.some(g => g < avgGap * 0.1)) {
          d.silenceThenBurst = true;
          d.postsSpreadNaturally = false;
        }
      }

      // Consistent posting times (automation)
      if (sorted.length >= 5) {
        const hours = sorted.map(t => new Date(t).getHours());
        const counts = {};
        hours.forEach(h => { counts[h] = (counts[h] || 0) + 1; });
        const maxCount = Math.max(...Object.values(counts));
        if (maxCount >= hours.length * 0.7) {
          d.consistentExactTimes = true;
          d.postsSpreadNaturally = false;
        }
      }
    }

    return d;
  }

  // ── Signal 5: Engagement Gender ──────────────────────────────────────

  function scrapeEngagementGender() {
    const d = {
      pctSameGenderLikes: null,
      hasTaggedSameGender: false,
      personalSameGenderComments: false,
      thirstyComments: false,
    };

    // Scan ALL text for thirsty comment patterns
    const thirstyPhrases = [
      "hi beautiful", "hello dear", "you are so pretty", "gorgeous queen",
      "hi gorgeous", "hey beautiful", "nice pic dear", "so beautiful",
      "marry me", "hello sweetie", "you're beautiful", "you're so pretty",
      "beautiful lady", "pretty lady", "hello angel", "hi dear",
      "beautiful woman", "can we be friends", "i want to know you",
      "can i be your friend", "inbox me", "dm me dear",
    ];

    const articles = $$('[role="article"]');
    let thirstyCount = 0;
    let totalCommentLikeElements = 0;

    for (const article of articles) {
      const text = article.textContent.toLowerCase();
      for (const phrase of thirstyPhrases) {
        if (text.includes(phrase)) { thirstyCount++; break; }
      }
      totalCommentLikeElements++;
    }

    d.thirstyComments = thirstyCount >= 3 || (totalCommentLikeElements > 0 && thirstyCount / totalCommentLikeElements > 0.3);

    // Check for tagged photos section ("Photos of [Name]")
    const name = getProfileName().split(" ")[0].toLowerCase();
    const taggedPhotos = findContains("photos of " + name, "tagged photos");
    d.hasTaggedSameGender = taggedPhotos.length > 0;

    return d;
  }

  // ── Signal 6: Photos ─────────────────────────────────────────────────

  function scrapePhotos() {
    const d = {
      photoQualityMixed: true, hasCasualPhotos: true,
      allProfessional: false, suspectedAI: false,
      showsProgression: true, hasGroupTagged: false,
      reverseSearchMatch: false, onlySelfies: false,
    };

    // Count all visible photos on page
    const allImgs = $$("img").filter(img => {
      const w = img.naturalWidth || parseInt(img.getAttribute("width") || "0");
      const h = img.naturalHeight || parseInt(img.getAttribute("height") || "0");
      return (w > 100 || h > 100); // Skip tiny icons
    });

    if (allImgs.length < 3) {
      d.photoQualityMixed = false;
      d.hasCasualPhotos = false;
      d.showsProgression = false;
    }

    // "Photos of [Name]" or "Tagged Photos" section
    const name = getProfileName().split(" ")[0].toLowerCase();
    const tagged = findContains("photos of " + name, "tagged photos", "photos of you");
    d.hasGroupTagged = tagged.length > 0;

    // Look for album variety (mobile uploads = casual photos)
    const albums = findContains("mobile uploads", "timeline photos", "cover photos", "profile pictures");
    if (albums.length >= 2) {
      d.hasCasualPhotos = true;
      d.photoQualityMixed = true;
    } else if (allImgs.length > 5 && albums.length === 0) {
      d.hasCasualPhotos = false;
    }

    // Check visible photos section link for count
    const photoLink = findSpans(/\d+\s*photos?/i);
    const photoCount = photoLink.length > 0 ? extractNumber(photoLink[0].text) : null;
    if (photoCount !== null && photoCount > 20) {
      d.showsProgression = true; // Many photos over time = progression
    }

    return d;
  }

  // ── Signal 7: Content ────────────────────────────────────────────────

  function scrapeContent() {
    const d = {
      hasOriginalPosts: false, hasPersonalUpdates: false,
      hasCheckIns: false, hasBirthdayWishes: false,
      hasLifeEvents: false, mostlyMemes: false,
      engagementBait: false, languageMatchesLocation: true,
    };

    const articles = $$('[role="article"]');
    let shared = 0, original = 0;

    for (const a of articles) {
      const t = a.textContent.toLowerCase();

      // Shared vs original
      if (t.includes("shared a") || t.includes("shared an") || t.includes("shared a memory")) {
        shared++;
      } else {
        original++;
      }

      // Check-ins
      if (t.includes("was at ") || t.includes(" is at ") || t.includes("checked in") || t.includes("is in ")) {
        d.hasCheckIns = true;
      }

      // Personal updates
      if (/\b(feeling|i'm |i am |my |today i|so happy|so sad|excited|grateful)\b/.test(t)) {
        d.hasPersonalUpdates = true;
      }
    }

    d.hasOriginalPosts = original >= 2;
    d.mostlyMemes = articles.length >= 3 && shared / articles.length > 0.7;

    // Birthday wishes anywhere on the page
    const bday = findContains("happy birthday", "happy bday", "hbd ");
    d.hasBirthdayWishes = bday.length >= 2;

    // Life events
    const events = findContains("life event", "got married", "had a baby", "started a new job", "moved to");
    d.hasLifeEvents = events.length > 0;

    // Engagement bait detection
    const bait = findContains("share if you agree", "like if you", "type amen", "1 like = 1", "share this");
    d.engagementBait = bait.length >= 2;

    return d;
  }

  // ── Signal 8: Interaction ────────────────────────────────────────────

  function scrapeInteraction() {
    const d = {
      twoWayConversations: false, taggedByOthers: false,
      sendsStrangerRequests: false, oneDirectional: false,
      manyGroups: false, dmPivot: false, relationshipSeeking: false,
    };

    // Nested articles = comment replies = two-way conversations
    const nestedArticles = $$('[role="article"] [role="article"]');
    d.twoWayConversations = nestedArticles.length >= 2;

    // Tagged by others
    const name = getProfileName().split(" ")[0].toLowerCase();
    const tagged = findContains("was with " + name, "tagged " + name, "— with " + name);
    // Also check for generic "with" patterns
    const withPatterns = findContains("was with", "is with", "— with");
    d.taggedByOthers = tagged.length > 0 || withPatterns.length >= 3;

    // Relationship seeking
    const pt = pageText();
    if (/looking for\s+(a\s+)?(serious\s+)?relationship/i.test(pt) ||
        /seeking\s+(a\s+)?(life\s+)?partner/i.test(pt) ||
        /looking for\s+(my\s+)?soulmate/i.test(pt)) {
      d.relationshipSeeking = true;
    }

    // DM pivot
    if (/\b(inbox me|dm me|whatsapp me|text me|call me)\b/i.test(pt)) {
      d.dmPivot = true;
    }

    return d;
  }

  // ── Signal 9: Identity ───────────────────────────────────────────────

  function scrapeIdentity() {
    const d = {
      nameMatchesEthnicity: true,
      randomNumbers: false, unusualFormatting: false,
      multipleNameChanges: false, identityConsistent: true,
      hasVanityUrl: true,
    };

    const name = getProfileName();

    // Random numbers in name
    d.randomNumbers = /\d{2,}/.test(name);

    // Unusual formatting: ALL CAPS (but not short names), excessive symbols
    d.unusualFormatting =
      (name.length > 4 && name === name.toUpperCase()) ||
      /[!@#$%^&*]{2,}/.test(name) ||
      /\.{3,}/.test(name) ||
      /_{2,}/.test(name) ||
      /\bx{3,}\b/i.test(name);

    // Vanity URL vs numeric ID
    const url = window.location.href;
    d.hasVanityUrl = !url.includes("profile.php?id=") && !/\/\d{10,}/.test(url);

    // Former name / name changes
    const former = findContains("former name", "previously known as", "also known as");
    d.multipleNameChanges = former.length > 0;

    return d;
  }

  // ── Master scrape ────────────────────────────────────────────────────

  function scrapeProfile() {
    // Reset caches
    _spanCache = null;
    _pageText = null;

    if (!isProfilePage()) return null;

    const data = {
      profileName: getProfileName(),
      completeness: scrapeCompleteness(),
      activity: scrapeActivity(),
      network: scrapeNetwork(),
      postTiming: scrapePostTiming(),
      engagementGender: scrapeEngagementGender(),
      photos: scrapePhotos(),
      content: scrapeContent(),
      interaction: scrapeInteraction(),
      identity: scrapeIdentity(),
    };

    // Debug: log what we scraped so user can verify in console
    console.group("[FB Analyzer] Scraped profile data");
    console.log("Name:", data.profileName);
    console.log("Completeness:", data.completeness);
    console.log("Activity:", data.activity);
    console.log("Network:", data.network);
    console.log("Post Timing:", data.postTiming);
    console.log("Engagement:", data.engagementGender);
    console.log("Photos:", data.photos);
    console.log("Content:", data.content);
    console.log("Interaction:", data.interaction);
    console.log("Identity:", data.identity);
    console.groupEnd();

    return data;
  }

  return { scrapeProfile, isProfilePage };
})();
