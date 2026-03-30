/**
 * Facebook Profile Collector — async multi-phase data collection.
 *
 * Instead of reading only what's visible on first load, this collector:
 *   Phase 1: Scrape the visible profile header (name, photo, cover, bio)
 *   Phase 2: Click "About" tab → scrape full details (work, edu, location, joined)
 *   Phase 3: Navigate back to Posts → scroll to load 15-20 posts → scrape timing/content
 *   Phase 4: Scrape engagement patterns from loaded posts
 *   Phase 5: Check friends count, photos section
 *
 * Each phase reports progress to the overlay.
 */

/* exported FBCollector */
const FBCollector = (() => {
  "use strict";

  // ── Helpers ──────────────────────────────────────────────────────────

  function $$(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** Scroll down and wait for new content to load. */
  async function scrollDown(times = 5, delay = 1200) {
    for (let i = 0; i < times; i++) {
      window.scrollBy(0, window.innerHeight * 0.8);
      await sleep(delay);
    }
  }

  /** Scroll back to top. */
  function scrollToTop() {
    window.scrollTo(0, 0);
  }

  /** Click a tab by matching its visible text. Returns true if found. */
  async function clickTab(tabText) {
    // Facebook profile tabs are <a> elements in the tab bar
    const links = $$("a");
    for (const link of links) {
      const text = link.textContent.trim().toLowerCase();
      if (text === tabText.toLowerCase()) {
        // Check if it's in the profile tab area (not some random link)
        const href = link.getAttribute("href") || "";
        if (href.includes("about") || href.includes("friends") ||
            href.includes("photos") || href.includes("sk=") ||
            link.closest('[role="tablist"]') || link.closest("nav")) {
          link.click();
          await sleep(2000); // Wait for tab content to load
          return true;
        }
      }
    }
    // Fallback: try matching partial text
    for (const link of links) {
      const text = link.textContent.trim().toLowerCase();
      const href = (link.getAttribute("href") || "").toLowerCase();
      if (href.includes(tabText.toLowerCase()) ||
          (text.includes(tabText.toLowerCase()) && href.includes("facebook.com"))) {
        link.click();
        await sleep(2000);
        return true;
      }
    }
    return false;
  }

  /** Get all visible text spans (fresh, no cache). */
  function allSpans() {
    return $$("span, a").map(el => ({
      el,
      text: (el.textContent || "").trim(),
      lower: (el.textContent || "").trim().toLowerCase(),
    })).filter(o => o.text.length > 0 && o.text.length < 500);
  }

  function findSpans(regex) {
    return allSpans().filter(o => regex.test(o.lower));
  }

  function findContains(...terms) {
    return allSpans().filter(o =>
      terms.some(t => o.lower.includes(t.toLowerCase()))
    );
  }

  function extractNumber(text) {
    const m = text.replace(/,/g, "").match(/(\d+)/);
    return m ? parseInt(m[1]) : null;
  }

  function pageText() {
    return (document.body.innerText || "").toLowerCase();
  }

  // ── Profile Name (from <title>) ──────────────────────────────────────

  const NON_NAMES = new Set([
    "notifications", "messages", "watch", "marketplace", "groups",
    "events", "settings", "friends", "search", "gaming", "feeds",
    "stories", "reels", "bookmarks", "pages", "saved", "menu",
    "facebook", "log in", "sign up", "home", "news feed",
  ]);

  function getProfileName() {
    const title = document.title
      .replace(/\s*[-|(\s]*Facebook.*$/i, "")
      .replace(/^\(\d+\)\s*/, "")
      .trim();
    if (title && title.length < 60 && !NON_NAMES.has(title.toLowerCase())) return title;

    const h1s = $$("h1");
    for (const h of h1s) {
      const t = h.textContent.trim();
      if (t.length > 1 && t.length < 60 && !NON_NAMES.has(t.toLowerCase())) return t;
    }
    return "Unknown";
  }

  // ── Phase 1: Header (visible on load) ────────────────────────────────

  function scrapeHeader() {
    const d = {
      hasProfilePhoto: false, profilePhotoType: "unknown",
      hasCoverPhoto: false,
    };

    // Profile photo
    const pfp = document.querySelector(
      '[aria-label*="profile picture" i], [aria-label*="profile photo" i]'
    );
    const svgImgs = $$("svg image, image[href], image[xlink\\:href]").filter(img => {
      const w = parseInt(img.getAttribute("width") || img.getAttribute("height") || "0");
      return w >= 80;
    });
    if (pfp || svgImgs.length > 0) {
      d.hasProfilePhoto = true;
      d.profilePhotoType = "real";
    }

    // Cover photo
    const coverAria = document.querySelector('[aria-label*="cover photo" i]');
    const coverPagelet = document.querySelector('[data-pagelet*="Cover" i]');
    const topImgs = $$("img").filter(img => {
      const rect = img.getBoundingClientRect();
      return rect.top < 350 && rect.width > 400;
    });
    d.hasCoverPhoto = !!(coverAria || (coverPagelet && coverPagelet.querySelector("img, svg")) || topImgs.length > 0);

    return d;
  }

  // ── Phase 2: About tab (full details) ────────────────────────────────

  async function scrapeAboutTab(onProgress) {
    onProgress("Opening About tab...");

    const d = {
      hasBio: false, bioIsGeneric: true,
      hasWork: false, workIsSpecific: false,
      hasEducation: false, educationIsSpecific: false,
      hasRelationship: false, hasHometown: false,
      hasCurrentCity: false, hasLifeEvents: false,
      accountAgeMonths: null,
    };

    // Click About tab
    const clicked = await clickTab("about");
    if (!clicked) {
      onProgress("About tab not found, scraping visible data...");
      // Fallback: scrape from visible page
      return scrapeVisibleDetails(d);
    }

    onProgress("Reading profile details...");
    await sleep(1500); // Extra wait for content

    // Scroll down in About to load all sections
    await scrollDown(3, 800);
    scrollToTop();
    await sleep(500);

    const pt = pageText();

    // Bio / tagline
    const bioIndicators = findContains(
      "digital creator", "content creator", "public figure",
      "entrepreneur", "artist", "musician", "ciso", "ceo", "cto",
      "founder", "developer", "engineer", "designer", "manager",
      "director", "writer", "coach", "consultant", "blogger",
    );
    const introSection = findContains("intro", "overview", "about");
    if (bioIndicators.length > 0 || introSection.length > 0) {
      d.hasBio = true;
      const genericPhrases = ["living life", "just me", "blessed", "god is good", "vibes only"];
      d.bioIsGeneric = genericPhrases.some(p => pt.includes(p));
    }
    // Also check for any quote or descriptive text
    if (!d.hasBio && pt.length > 200) {
      // If there's substantial text on the About page, there's likely a bio
      d.hasBio = true;
      d.bioIsGeneric = false;
    }

    // Work
    const workSpans = findSpans(/works?\s+at\s/i);
    const workSection = findContains("work", "workplace", "job", "profession", "occupation");
    const roleLabels = findContains(
      "beauty parlour", "digital creator", "content creator",
      "self-employed", "freelancer",
    );
    if (workSpans.length > 0) {
      d.hasWork = true;
      const vague = ["self-employed", "freelancer", "entrepreneur"];
      d.workIsSpecific = !vague.some(v => workSpans[0].lower.includes(v));
    } else if (roleLabels.length > 0 || (workSection.length > 0 && pt.includes("present"))) {
      d.hasWork = true;
      d.workIsSpecific = true;
    }

    // Education
    const eduSpans = findSpans(/(?:studied|went|goes|studies)\s+(?:at|to)\s/i);
    const eduSection = findContains("college", "university", "school", "institute", "education");
    if (eduSpans.length > 0 || eduSection.length > 0) {
      d.hasEducation = true;
      const vagueEdu = ["school of hard knocks", "university of life"];
      d.educationIsSpecific = !vagueEdu.some(v => pt.includes(v));
    }

    // Location
    const livesIn = findSpans(/lives?\s+in\s/i);
    if (livesIn.length > 0 || pt.includes("lives in") || pt.includes("current city")) {
      d.hasCurrentCity = true;
    }

    const fromSpans = findSpans(/^from\s+[A-Z]/);
    if (fromSpans.length > 0 || /from\s+[a-z][a-z\s,]+/i.test(pt)) {
      d.hasHometown = true;
    }

    // Relationship
    const relWords = ["married", "in a relationship", "engaged", "single", "divorced", "widowed", "separated"];
    if (relWords.some(w => pt.includes(w))) {
      d.hasRelationship = true;
    }

    // Joined date
    const joinedSpans = findSpans(/joined/i);
    for (const o of joinedSpans) {
      const m = o.text.match(/(\w+)\s+(\d{4})/i);
      if (m) {
        const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
        const mi = months.findIndex(mn => m[1].toLowerCase().startsWith(mn));
        const yr = parseInt(m[2]);
        if (mi >= 0 && yr > 2004 && yr <= new Date().getFullYear()) {
          d.accountAgeMonths = Math.max(0, Math.floor((Date.now() - new Date(yr, mi)) / (1000 * 60 * 60 * 24 * 30.44)));
          break;
        }
      }
    }
    // Fallback: just a year
    if (d.accountAgeMonths === null) {
      for (const o of joinedSpans) {
        const m = o.text.match(/(\d{4})/);
        if (m && parseInt(m[1]) > 2004 && parseInt(m[1]) <= new Date().getFullYear()) {
          d.accountAgeMonths = (new Date().getFullYear() - parseInt(m[1])) * 12;
          break;
        }
      }
    }

    // Life events
    const lifeEvts = findContains("life event", "got married", "had a baby", "started a new job", "moved to", "birthday");
    const datePatterns = findSpans(/^\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)/i);
    d.hasLifeEvents = lifeEvts.length > 0 || datePatterns.length > 0;

    return d;
  }

  /** Fallback when About tab can't be clicked. */
  function scrapeVisibleDetails(d) {
    const pt = pageText();
    const bioIndicators = findContains("digital creator", "content creator", "ciso", "ceo", "founder", "engineer");
    if (bioIndicators.length > 0) { d.hasBio = true; d.bioIsGeneric = false; }
    if (findSpans(/works?\s+at\s/i).length > 0 || findContains("digital creator").length > 0) {
      d.hasWork = true; d.workIsSpecific = true;
    }
    if (findSpans(/(?:studied|went|goes)\s+(?:at|to)\s/i).length > 0) {
      d.hasEducation = true; d.educationIsSpecific = true;
    }
    if (pt.includes("lives in")) d.hasCurrentCity = true;
    if (/from\s+[a-z]/i.test(pt)) d.hasHometown = true;
    return d;
  }

  // ── Phase 3: Scroll posts ────────────────────────────────────────────

  async function scrapePostsFeed(onProgress) {
    onProgress("Loading posts feed...");

    // Click "All" or "Posts" tab to get back to the feed
    const clickedAll = await clickTab("all");
    if (!clickedAll) await clickTab("posts");
    await sleep(1000);

    onProgress("Scrolling through posts...");
    scrollToTop();
    await sleep(500);

    // Scroll to load more posts (aim for 15-20)
    await scrollDown(8, 1500);

    onProgress("Analyzing posts...");

    const articles = $$('[role="article"]');
    const postData = {
      totalPosts: articles.length,
      timestamps: [],
      sharedCount: 0,
      originalCount: 0,
      hasCheckIns: false,
      hasPersonalUpdates: false,
      hasBirthdayWishes: false,
      hasLifeEvents: false,
      engagementBait: false,
      mostlyMemes: false,
      thirstyCommentCount: 0,
      totalEngagementElements: 0,
      hasCommentThreads: false,
      taggedByOthers: false,
    };

    const thirstyPhrases = [
      "hi beautiful", "hello dear", "you are so pretty", "gorgeous",
      "hi gorgeous", "hey beautiful", "nice pic", "so beautiful",
      "marry me", "hello sweetie", "beautiful lady", "pretty lady",
      "hello angel", "hi dear", "can we be friends", "inbox me",
      "dm me", "i want to know you",
    ];

    for (const article of articles) {
      const text = article.textContent.toLowerCase();

      // Shared vs original
      if (text.includes("shared a") || text.includes("shared an")) {
        postData.sharedCount++;
      } else {
        postData.originalCount++;
      }

      // Check-ins
      if (text.includes("was at ") || text.includes(" is at ") || text.includes("checked in")) {
        postData.hasCheckIns = true;
      }

      // Personal updates
      if (/\b(feeling|i'm |i am |my |today i|so happy|so sad|excited|grateful)\b/.test(text)) {
        postData.hasPersonalUpdates = true;
      }

      // Birthday wishes
      if (text.includes("happy birthday") || text.includes("hbd")) {
        postData.hasBirthdayWishes = true;
      }

      // Life events
      if (text.includes("life event") || text.includes("started a new job") || text.includes("moved to")) {
        postData.hasLifeEvents = true;
      }

      // Engagement bait
      if (text.includes("share if you") || text.includes("type amen") || text.includes("1 like")) {
        postData.engagementBait = true;
      }

      // Thirsty comments
      for (const phrase of thirstyPhrases) {
        if (text.includes(phrase)) { postData.thirstyCommentCount++; break; }
      }
      postData.totalEngagementElements++;

      // Timestamps from links with aria-labels
      const timeLinks = $$('a[aria-label]', article);
      for (const link of timeLinks) {
        const label = link.getAttribute("aria-label") || "";
        const dateMatch = label.match(
          /(\w+\s+\d{1,2},?\s+\d{4}(?:\s+at\s+\d{1,2}:\d{2}\s*[AP]M)?)/i
        );
        if (dateMatch) {
          const parsed = new Date(dateMatch[1].replace(" at ", " "));
          if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 2004) {
            postData.timestamps.push(parsed.getTime());
          }
        }
      }

      // Comment threads (nested articles)
      if ($$('[role="article"]', article).length > 0) {
        postData.hasCommentThreads = true;
      }

      // Tagged
      if (text.includes("was with") || text.includes("— with") || text.includes("is with")) {
        postData.taggedByOthers = true;
      }
    }

    // Also look for relative time stamps
    const relTimes = findSpans(/^\d+\s*[hdmw]\s*$/i);
    const now = Date.now();
    for (const o of relTimes) {
      const hm = o.text.match(/(\d+)\s*h/i);
      const dm = o.text.match(/(\d+)\s*d/i);
      const wm = o.text.match(/(\d+)\s*w/i);
      if (hm) postData.timestamps.push(now - parseInt(hm[1]) * 3600000);
      else if (dm) postData.timestamps.push(now - parseInt(dm[1]) * 86400000);
      else if (wm) postData.timestamps.push(now - parseInt(wm[1]) * 604800000);
    }

    postData.mostlyMemes = articles.length >= 3 && postData.sharedCount / articles.length > 0.7;

    // Also check birthday wishes on wall
    const bdaySpans = findContains("happy birthday", "happy bday", "hbd ");
    if (bdaySpans.length >= 2) postData.hasBirthdayWishes = true;

    // Comment count indicators
    const commentCounts = findSpans(/\d+\s*comments?/i);
    if (commentCounts.length >= 2) postData.hasCommentThreads = true;

    return postData;
  }

  // ── Phase 4: Network ─────────────────────────────────────────────────

  function scrapeNetwork() {
    const d = {
      friendCount: null, mutualFriends: null,
      friendsGenderSkewed: false, friendsOppositeGender: false,
      friendsAppearFake: false,
    };

    // Friend count
    const friendSpans = findSpans(/[\d,]+\s*friends?\b/i);
    for (const o of friendSpans) {
      if (o.lower.includes("mutual")) continue;
      const n = extractNumber(o.text);
      if (n > 0) { d.friendCount = n; break; }
    }

    // Mutual friends
    const mutualSpans = findSpans(/[\d,]+\s*mutual\s*friends?/i);
    for (const o of mutualSpans) {
      const n = extractNumber(o.text);
      if (n !== null) { d.mutualFriends = n; break; }
    }

    // Followers (for creator/public profiles)
    if (d.friendCount === null) {
      const followerSpans = findSpans(/[\d,.]+[kKmM]?\s*followers?\b/i);
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

  // ── Phase 5: Identity ────────────────────────────────────────────────

  function scrapeIdentity() {
    const name = getProfileName();
    const url = window.location.href;
    const path = window.location.pathname;

    const d = {
      nameMatchesEthnicity: true,
      randomNumbers: /\d{2,}/.test(name) || /\.\d{3,}/.test(path),
      unusualFormatting:
        (name.length > 4 && name === name.toUpperCase()) ||
        /[!@#$%^&*]{2,}/.test(name) || /\.{3,}/.test(name) ||
        /_{2,}/.test(name),
      multipleNameChanges: false,
      identityConsistent: true,
      hasVanityUrl: !url.includes("profile.php?id=") &&
        !/\/\d{10,}/.test(url) && !/\.\d{3,}/.test(path),
    };

    // Check @username on page
    const userSpans = findSpans(/^@[\w.]*\d{3,}/);
    if (userSpans.length > 0) d.randomNumbers = true;

    // Former name
    const former = findContains("former name", "previously known as", "also known as");
    d.multipleNameChanges = former.length > 0;

    return d;
  }

  // ── Analyze post timing ──────────────────────────────────────────────

  function analyzePostTiming(timestamps) {
    const d = {
      postsSpreadNaturally: true, bulkPostsWithinHour: false,
      bulkPatternRepeats: false, consistentExactTimes: false,
      silenceThenBurst: false, timezoneMismatch: false,
    };

    if (timestamps.length < 3) return d;

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

    // Consistent posting times
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

    return d;
  }

  // ── Master collect function (async) ──────────────────────────────────

  async function collectProfile(onProgress) {
    const name = getProfileName();
    if (name === "Unknown" || NON_NAMES.has(name.toLowerCase())) {
      return null;
    }

    onProgress("Scanning profile header...", 0);

    // Phase 1: Header
    const header = scrapeHeader();

    // Phase 2: About tab
    onProgress("Reading profile details...", 15);
    const about = await scrapeAboutTab(onProgress);

    // Phase 3: Posts
    onProgress("Analyzing posts...", 40);
    const posts = await scrapePostsFeed(onProgress);

    // Phase 4: Network (read from wherever we are now)
    onProgress("Checking network...", 75);
    scrollToTop();
    await sleep(500);
    const network = scrapeNetwork();

    // Phase 5: Identity
    onProgress("Checking identity...", 90);
    const identity = scrapeIdentity();

    // Assemble into analyzer-compatible format
    onProgress("Computing verdict...", 95);

    const result = {
      profileName: name,
      completeness: {
        hasProfilePhoto: header.hasProfilePhoto,
        profilePhotoType: header.profilePhotoType,
        hasCoverPhoto: header.hasCoverPhoto,
        hasBio: about.hasBio,
        bioIsGeneric: about.bioIsGeneric,
        hasWork: about.hasWork,
        workIsSpecific: about.workIsSpecific,
        hasEducation: about.hasEducation,
        educationIsSpecific: about.educationIsSpecific,
        hasRelationship: about.hasRelationship,
        hasHometown: about.hasHometown,
        hasCurrentCity: about.hasCurrentCity,
        hasLifeEvents: about.hasLifeEvents || posts.hasLifeEvents,
      },
      activity: {
        accountAgeMonths: about.accountAgeMonths,
        totalPosts: posts.totalPosts,
        hadDormantPeriod: false,
        activityRampGradual: true,
      },
      network,
      postTiming: analyzePostTiming(posts.timestamps),
      engagementGender: {
        pctSameGenderLikes: null,
        hasTaggedSameGender: false,
        personalSameGenderComments: false,
        thirstyComments: posts.thirstyCommentCount >= 3 ||
          (posts.totalEngagementElements > 0 && posts.thirstyCommentCount / posts.totalEngagementElements > 0.3),
      },
      photos: {
        photoQualityMixed: true,
        hasCasualPhotos: true,
        allProfessional: false,
        suspectedAI: false,
        showsProgression: posts.totalPosts > 5,
        hasGroupTagged: posts.taggedByOthers,
        reverseSearchMatch: false,
        onlySelfies: false,
      },
      content: {
        hasOriginalPosts: posts.originalCount >= 2,
        hasPersonalUpdates: posts.hasPersonalUpdates,
        hasCheckIns: posts.hasCheckIns,
        hasBirthdayWishes: posts.hasBirthdayWishes,
        hasLifeEvents: about.hasLifeEvents || posts.hasLifeEvents,
        mostlyMemes: posts.mostlyMemes,
        engagementBait: posts.engagementBait,
        languageMatchesLocation: true,
      },
      interaction: {
        twoWayConversations: posts.hasCommentThreads,
        taggedByOthers: posts.taggedByOthers,
        sendsStrangerRequests: false,
        oneDirectional: false,
        manyGroups: false,
        dmPivot: false,
        relationshipSeeking: false,
      },
      identity,
    };

    // Check for DM pivot / relationship seeking in page text
    const pt = pageText();
    if (/\b(inbox me|dm me|whatsapp me|text me|call me)\b/i.test(pt)) {
      result.interaction.dmPivot = true;
    }
    if (/looking for\s+(a\s+)?relationship/i.test(pt) || /seeking\s+partner/i.test(pt)) {
      result.interaction.relationshipSeeking = true;
    }

    // Debug log
    console.group("[FB Analyzer] Collected profile data (deep scan)");
    console.log("Name:", result.profileName);
    console.log("Completeness:", result.completeness);
    console.log("Activity:", result.activity);
    console.log("Network:", result.network);
    console.log("Post Timing:", result.postTiming);
    console.log("Engagement:", result.engagementGender);
    console.log("Photos:", result.photos);
    console.log("Content:", result.content);
    console.log("Interaction:", result.interaction);
    console.log("Identity:", result.identity);
    console.log(`Posts analyzed: ${posts.totalPosts}, Timestamps found: ${posts.timestamps.length}`);
    console.groupEnd();

    return result;
  }

  return { collectProfile, getProfileName, NON_NAMES };
})();
