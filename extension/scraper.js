/**
 * Facebook DOM Scraper — extracts profile signals from the current page.
 * Works on public profiles (no login) and full profiles (logged in).
 * Resilient to Facebook's obfuscated class names — uses semantic selectors,
 * aria labels, text content, and structural patterns.
 */

/* exported FBScraper */
const FBScraper = (() => {
  "use strict";

  // ── Utility helpers ──────────────────────────────────────────────────

  function qsa(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function textIncludes(el, ...terms) {
    const t = (el.textContent || "").toLowerCase();
    return terms.some(term => t.includes(term.toLowerCase()));
  }

  function findByText(selector, ...terms) {
    return qsa(selector).filter(el => textIncludes(el, ...terms));
  }

  function getProfileName() {
    // Try h1 first (profile pages), then page title
    const h1 = document.querySelector("h1");
    if (h1 && h1.textContent.trim()) return h1.textContent.trim();
    const title = document.title.replace(/ \| Facebook$/, "").replace(/ - Facebook$/, "");
    return title || "Unknown";
  }

  // ── Detection: are we on a profile page? ─────────────────────────────

  function isProfilePage() {
    const url = window.location.href;
    // Profile URLs: /username, /profile.php?id=, /people/Name/id
    if (url.includes("/profile.php")) return true;
    if (url.includes("/people/")) return true;
    // Check for profile-specific elements
    if (document.querySelector('[data-pagelet="ProfileActions"]')) return true;
    if (document.querySelector('[aria-label="Profile picture"]')) return true;
    // Generic: has an h1 and profile-like structure
    const path = window.location.pathname;
    if (path.split("/").filter(Boolean).length === 1 && !["watch", "groups", "events", "marketplace", "gaming", "search"].includes(path.split("/")[1])) return true;
    return false;
  }

  // ── Signal 1: Profile Completeness ───────────────────────────────────

  function scrapeCompleteness() {
    const data = {
      hasProfilePhoto: false,
      profilePhotoType: "unknown",
      hasCoverPhoto: false,
      hasBio: false,
      bioIsGeneric: true,
      hasWork: false,
      workIsSpecific: false,
      hasEducation: false,
      educationIsSpecific: false,
      hasRelationship: false,
      hasHometown: false,
      hasCurrentCity: false,
      hasLifeEvents: false,
    };

    // Profile photo
    const pfp = document.querySelector('[aria-label="Profile picture"] image, [data-pagelet="ProfileActions"] image, svg[aria-label] image');
    if (pfp) {
      data.hasProfilePhoto = true;
      const src = pfp.getAttribute("xlink:href") || pfp.getAttribute("href") || "";
      // Default/placeholder photos are typically very small or from static CDN paths
      if (src.includes("default") || src.includes("silhouette")) data.profilePhotoType = "stock";
      else data.profilePhotoType = "real";
    }

    // Cover photo
    const cover = document.querySelector('[data-pagelet="ProfileCoverPhoto"] img, [aria-label="Cover photo"] img');
    data.hasCoverPhoto = !!cover;

    // Intro / Bio section — look for the intro sidebar
    const introSection = findByText("span, div", "intro");
    const bioElements = qsa('[data-pagelet="ProfileTilesFeed_0"] span, [data-pagelet="ProfileTilesFeed"] span');
    if (bioElements.length > 0) {
      data.hasBio = true;
      const bioText = bioElements.map(e => e.textContent).join(" ").toLowerCase();
      const genericPhrases = ["living life", "just me", "it's complicated", "god is good", "blessed", "king", "queen"];
      data.bioIsGeneric = genericPhrases.some(p => bioText.includes(p)) || bioText.length < 20;
    }

    // Work, Education, Location — from intro/details section
    const allText = document.body.textContent || "";
    const introItems = qsa('[data-pagelet*="Profile"] li, [data-pagelet*="Tile"] li, [role="list"] li');

    for (const item of introItems) {
      const text = item.textContent.toLowerCase();
      if (text.includes("works at") || text.includes("worked at")) {
        data.hasWork = true;
        data.workIsSpecific = !["self-employed", "freelancer", "entrepreneur", "ceo"].some(g => text.includes(g));
      }
      if (text.includes("studied at") || text.includes("goes to") || text.includes("went to")) {
        data.hasEducation = true;
        data.educationIsSpecific = !["school of hard knocks", "university of life", "school of life"].some(g => text.includes(g));
      }
      if (text.includes("lives in") || text.includes("currently in")) data.hasCurrentCity = true;
      if (text.includes("from ")) data.hasHometown = true;
      if (text.includes("married") || text.includes("in a relationship") || text.includes("single") || text.includes("engaged")) data.hasRelationship = true;
    }

    // Also check visible spans for work/education
    const spans = qsa("span");
    for (const sp of spans) {
      const t = sp.textContent.toLowerCase();
      if (t.startsWith("works at ")) data.hasWork = true;
      if (t.startsWith("studied at ") || t.startsWith("went to ")) data.hasEducation = true;
      if (t.startsWith("lives in ")) data.hasCurrentCity = true;
      if (t.startsWith("from ")) data.hasHometown = true;
    }

    // Life events — look for any milestone indicators
    const lifeEventIndicators = findByText("span", "life event", "joined facebook", "moved to", "got married");
    data.hasLifeEvents = lifeEventIndicators.length > 0;

    return data;
  }

  // ── Signal 2: Account Activity ───────────────────────────────────────

  function scrapeActivity() {
    const data = {
      accountAgeMonths: null,
      totalPosts: null,
      hadDormantPeriod: false,
      activityRampGradual: true,
    };

    // Look for "Joined" date
    const joinedElements = findByText("span, div", "joined");
    for (const el of joinedElements) {
      const match = el.textContent.match(/joined\s+(?:in\s+)?(\w+)\s+(\d{4})/i);
      if (match) {
        const monthNames = ["january","february","march","april","may","june","july","august","september","october","november","december"];
        const monthIdx = monthNames.indexOf(match[1].toLowerCase());
        const year = parseInt(match[2]);
        if (monthIdx >= 0 && year > 2000) {
          const joined = new Date(year, monthIdx);
          const now = new Date();
          data.accountAgeMonths = Math.floor((now - joined) / (1000 * 60 * 60 * 24 * 30));
        }
      }
    }

    // Count visible posts
    const posts = qsa('[data-pagelet*="Feed"] [role="article"], [role="feed"] [role="article"]');
    data.totalPosts = posts.length > 0 ? posts.length : null;

    return data;
  }

  // ── Signal 3: Network ────────────────────────────────────────────────

  function scrapeNetwork() {
    const data = {
      friendCount: null,
      mutualFriends: null,
      friendsGenderSkewed: false,
      friendsOppositeGender: false,
      friendsAppearFake: false,
    };

    // Friend count — look for "X friends" text
    const friendElements = findByText("a, span", "friends");
    for (const el of friendElements) {
      const match = el.textContent.match(/([\d,]+)\s*friends/i);
      if (match) {
        data.friendCount = parseInt(match[1].replace(/,/g, ""));
        break;
      }
    }

    // Mutual friends
    const mutualElements = findByText("a, span", "mutual friend");
    for (const el of mutualElements) {
      const match = el.textContent.match(/([\d,]+)\s*mutual/i);
      if (match) {
        data.mutualFriends = parseInt(match[1].replace(/,/g, ""));
        break;
      }
    }

    return data;
  }

  // ── Signal 4: Post Timing ────────────────────────────────────────────

  function scrapePostTiming() {
    const data = {
      postsSpreadNaturally: true,
      bulkPostsWithinHour: false,
      bulkPatternRepeats: false,
      consistentExactTimes: false,
      silenceThenBurst: false,
      timezoneMismatch: false,
    };

    // Collect post timestamps
    const timestamps = [];
    const timeElements = qsa('[role="article"] a[href*="/posts/"] span, [role="article"] abbr, [role="article"] [data-utime]');

    for (const el of timeElements) {
      // Try to extract datetime from various FB timestamp formats
      const utime = el.getAttribute("data-utime");
      if (utime) {
        timestamps.push(parseInt(utime) * 1000);
        continue;
      }
      const title = el.getAttribute("title") || el.getAttribute("aria-label");
      if (title) {
        const d = new Date(title);
        if (!isNaN(d.getTime())) timestamps.push(d.getTime());
      }
    }

    if (timestamps.length >= 3) {
      timestamps.sort((a, b) => a - b);

      // Check for bulk posting (3+ posts within 1 hour)
      for (let i = 0; i < timestamps.length - 2; i++) {
        if (timestamps[i + 2] - timestamps[i] < 3600000) {
          data.bulkPostsWithinHour = true;
          data.postsSpreadNaturally = false;
          break;
        }
      }

      // Check for long gaps then bursts
      const gaps = [];
      for (let i = 1; i < timestamps.length; i++) {
        gaps.push(timestamps[i] - timestamps[i - 1]);
      }
      const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const hasLongGap = gaps.some(g => g > avgGap * 5);
      const hasShortBurst = gaps.some(g => g < avgGap * 0.1);
      if (hasLongGap && hasShortBurst) {
        data.silenceThenBurst = true;
        data.postsSpreadNaturally = false;
      }

      // Check for consistent times (same hour of day)
      const hours = timestamps.map(t => new Date(t).getHours());
      const hourCounts = {};
      hours.forEach(h => { hourCounts[h] = (hourCounts[h] || 0) + 1; });
      const maxHourCount = Math.max(...Object.values(hourCounts));
      if (maxHourCount >= hours.length * 0.7 && hours.length >= 5) {
        data.consistentExactTimes = true;
        data.postsSpreadNaturally = false;
      }
    }

    return data;
  }

  // ── Signal 5: Engagement Gender ──────────────────────────────────────

  function scrapeEngagementGender() {
    const data = {
      pctSameGenderLikes: null,
      hasTaggedSameGender: false,
      personalSameGenderComments: false,
      thirstyComments: false,
    };

    // Detect profile gender from pronouns or name patterns
    // This is approximate — we check intro section for pronouns
    const introText = (document.body.textContent || "").toLowerCase();
    const isFemalePresenting = /\b(she\/her|mom|wife|girlfriend|actress|waitress|mrs)\b/.test(introText);
    const isMalePresenting = /\b(he\/him|dad|husband|boyfriend|actor|mr\.)\b/.test(introText);

    // Check comments for thirsty patterns
    const comments = qsa('[role="article"] [dir="auto"]');
    const thirstyPhrases = ["hi beautiful", "hello dear", "you are so pretty", "gorgeous", "hi gorgeous", "hey beautiful", "nice pic", "so beautiful", "marry me", "hello sweetie"];
    let thirstyCount = 0;

    for (const comment of comments) {
      const text = comment.textContent.toLowerCase().trim();
      if (thirstyPhrases.some(p => text.includes(p))) thirstyCount++;
    }

    data.thirstyComments = thirstyCount >= 3;

    return data;
  }

  // ── Signal 6: Photos ─────────────────────────────────────────────────

  function scrapePhotos() {
    const data = {
      photoQualityMixed: true,
      hasCasualPhotos: true,
      allProfessional: false,
      suspectedAI: false,
      showsProgression: true,
      hasGroupTagged: false,
      reverseSearchMatch: false,
      onlySelfies: false,
    };

    // Check photo section
    const photos = qsa('[data-pagelet*="Photo"] img, [data-pagelet*="photo"] img, a[href*="/photo"] img');
    const photoCount = photos.length;

    if (photoCount === 0) {
      data.photoQualityMixed = false;
      data.hasCasualPhotos = false;
    }

    // Check for "Photos of [Name]" section (tagged by others)
    const taggedSection = findByText("a, span", "photos of", "tagged photos");
    data.hasGroupTagged = taggedSection.length > 0;

    // Check for "Albums" with various types
    const albumElements = findByText("span, a", "mobile uploads", "timeline photos", "cover photos");
    if (albumElements.length === 0 && photoCount > 0) {
      // Only curated photos, no casual uploads
      data.hasCasualPhotos = false;
    }

    return data;
  }

  // ── Signal 7: Content ────────────────────────────────────────────────

  function scrapeContent() {
    const data = {
      hasOriginalPosts: false,
      hasPersonalUpdates: false,
      hasCheckIns: false,
      hasBirthdayWishes: false,
      hasLifeEvents: false,
      mostlyMemes: false,
      engagementBait: false,
      languageMatchesLocation: true,
    };

    const articles = qsa('[role="article"]');
    let sharedCount = 0;
    let originalCount = 0;

    for (const article of articles) {
      const text = article.textContent.toLowerCase();

      // Shared content detection
      if (text.includes("shared a") || text.includes("shared an") || article.querySelector('[data-ad-preview]')) {
        sharedCount++;
      } else {
        originalCount++;
      }

      // Check-ins
      if (text.includes("was at") || text.includes("is at") || text.includes("checked in")) {
        data.hasCheckIns = true;
      }

      // Personal updates
      if (text.includes("feeling") || text.includes("i'm") || text.includes("my ") || text.includes("today i")) {
        data.hasPersonalUpdates = true;
      }
    }

    data.hasOriginalPosts = originalCount > 2;
    data.mostlyMemes = articles.length > 0 && sharedCount > articles.length * 0.7;

    // Birthday wishes
    const birthdayElements = findByText("span, div", "happy birthday", "hbd", "bday");
    data.hasBirthdayWishes = birthdayElements.length >= 2;

    return data;
  }

  // ── Signal 8: Interaction ────────────────────────────────────────────

  function scrapeInteraction() {
    const data = {
      twoWayConversations: false,
      taggedByOthers: false,
      sendsStrangerRequests: false,
      oneDirectional: false,
      manyGroups: false,
      dmPivot: false,
      relationshipSeeking: false,
    };

    // Two-way conversations — check if post comments have replies
    const commentThreads = qsa('[role="article"] [role="article"]');
    data.twoWayConversations = commentThreads.length >= 2;

    // Tagged by others — reuse from photos
    const taggedElements = findByText("a, span", "tagged", "was with", "with ");
    data.taggedByOthers = taggedElements.length >= 2;

    // Relationship seeking
    const allText = document.body.textContent.toLowerCase();
    if (allText.includes("looking for") && (allText.includes("relationship") || allText.includes("partner") || allText.includes("soulmate"))) {
      data.relationshipSeeking = true;
    }

    return data;
  }

  // ── Signal 9: Identity ───────────────────────────────────────────────

  function scrapeIdentity() {
    const data = {
      nameMatchesEthnicity: true, // Default positive — hard to auto-detect
      randomNumbers: false,
      unusualFormatting: false,
      multipleNameChanges: false,
      identityConsistent: true,
      hasVanityUrl: true,
    };

    const name = getProfileName();

    // Random numbers in name
    data.randomNumbers = /\d{2,}/.test(name);

    // Unusual formatting
    data.unusualFormatting = name === name.toUpperCase() || /[!@#$%^&*]{2,}/.test(name) || /\.{3,}/.test(name);

    // Vanity URL check
    const url = window.location.href;
    data.hasVanityUrl = !url.includes("profile.php?id=") && !/\/\d{10,}/.test(url);

    // Former name / name changes
    const formerName = findByText("span", "former name", "previously known");
    data.multipleNameChanges = formerName.length > 0;

    return data;
  }

  // ── Master scrape function ───────────────────────────────────────────

  function scrapeProfile() {
    if (!isProfilePage()) return null;

    return {
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
  }

  return { scrapeProfile, isProfilePage };
})();
