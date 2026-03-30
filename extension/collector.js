/**
 * Facebook Profile Collector v3 — deep async multi-phase data collection.
 *
 * Phase 1: Header (name, photo, cover, follower count)
 * Phase 2: About tab (work, edu, location, joined date, relationship)
 * Phase 3: Posts feed (scroll, timestamps, content analysis, engagement names)
 * Phase 4: Friends tab (scroll, collect names → gender ratio)
 * Phase 5: Identity checks
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

  async function scrollDown(times = 5, delay = 1200) {
    for (let i = 0; i < times; i++) {
      window.scrollBy(0, window.innerHeight * 0.8);
      await sleep(delay);
    }
  }

  function scrollToTop() {
    window.scrollTo(0, 0);
  }

  async function clickTab(tabText) {
    const links = $$("a");
    for (const link of links) {
      const text = link.textContent.trim().toLowerCase();
      const href = (link.getAttribute("href") || "").toLowerCase();
      if (text === tabText.toLowerCase() &&
          (href.includes("about") || href.includes("friends") ||
           href.includes("photos") || href.includes("sk=") ||
           href.includes("facebook.com") ||
           link.closest('[role="tablist"]') || link.closest("nav"))) {
        link.click();
        await sleep(2500);
        return true;
      }
    }
    // Fallback: partial match
    for (const link of links) {
      const href = (link.getAttribute("href") || "").toLowerCase();
      if (href.includes("/" + tabText.toLowerCase()) || href.includes("sk=" + tabText.toLowerCase())) {
        link.click();
        await sleep(2500);
        return true;
      }
    }
    return false;
  }

  function allSpans() {
    return $$("span, a").map(el => ({
      el, text: (el.textContent || "").trim(),
      lower: (el.textContent || "").trim().toLowerCase(),
    })).filter(o => o.text.length > 0 && o.text.length < 500);
  }

  function findSpans(regex) { return allSpans().filter(o => regex.test(o.lower)); }
  function findContains(...terms) {
    return allSpans().filter(o => terms.some(t => o.lower.includes(t.toLowerCase())));
  }
  function extractNumber(text) {
    const m = text.replace(/,/g, "").match(/(\d+)/);
    return m ? parseInt(m[1]) : null;
  }
  function pageText() { return (document.body.innerText || "").toLowerCase(); }

  // ── Profile Name ─────────────────────────────────────────────────────

  const NON_NAMES = new Set([
    "notifications","messages","watch","marketplace","groups","events",
    "settings","friends","search","gaming","feeds","stories","reels",
    "bookmarks","pages","saved","menu","facebook","log in","sign up","home",
  ]);

  function getProfileName() {
    const title = document.title
      .replace(/\s*[-|(\s]*Facebook.*$/i, "")
      .replace(/^\(\d+\)\s*/, "").trim();
    if (title && title.length < 60 && !NON_NAMES.has(title.toLowerCase())) return title;
    const h1s = $$("h1");
    for (const h of h1s) {
      const t = h.textContent.trim();
      if (t.length > 1 && t.length < 60 && !NON_NAMES.has(t.toLowerCase())) return t;
    }
    return "Unknown";
  }

  // ── Phase 1: Header ──────────────────────────────────────────────────

  function scrapeHeader() {
    const d = { hasProfilePhoto: false, profilePhotoType: "unknown", hasCoverPhoto: false };

    const pfp = document.querySelector('[aria-label*="profile picture" i], [aria-label*="profile photo" i]');
    const svgImgs = $$("svg image, image[href], image[xlink\\:href]").filter(img =>
      parseInt(img.getAttribute("width") || img.getAttribute("height") || "0") >= 80
    );
    if (pfp || svgImgs.length > 0) { d.hasProfilePhoto = true; d.profilePhotoType = "real"; }

    const coverAria = document.querySelector('[aria-label*="cover photo" i]');
    const coverPagelet = document.querySelector('[data-pagelet*="Cover" i]');
    const topImgs = $$("img").filter(img => {
      const r = img.getBoundingClientRect();
      return r.top < 350 && r.width > 400;
    });
    d.hasCoverPhoto = !!(coverAria || (coverPagelet && coverPagelet.querySelector("img, svg")) || topImgs.length > 0);

    return d;
  }

  // ── Phase 2: About ───────────────────────────────────────────────────

  async function scrapeAbout(onProgress) {
    onProgress("Opening About tab...", 10);
    const d = {
      hasBio: false, bioIsGeneric: true,
      hasWork: false, workIsSpecific: false,
      hasEducation: false, educationIsSpecific: false,
      hasRelationship: false, hasHometown: false,
      hasCurrentCity: false, hasLifeEvents: false,
      accountAgeMonths: null,
    };

    const clicked = await clickTab("about");
    if (clicked) {
      await scrollDown(3, 800);
      scrollToTop();
      await sleep(500);
    }

    onProgress("Reading details...", 20);
    const pt = pageText();

    // Bio
    const bioHits = findContains(
      "digital creator","content creator","public figure","entrepreneur",
      "ciso","ceo","cto","founder","developer","engineer","designer",
      "manager","director","writer","coach","consultant","blogger",
      "artist","musician","photographer","beauty parlour",
    );
    if (bioHits.length > 0 || findContains("intro","overview","about").length > 0) {
      d.hasBio = true;
      d.bioIsGeneric = ["living life","just me","blessed","vibes only"].some(p => pt.includes(p));
    }
    if (!d.hasBio && pt.length > 300) { d.hasBio = true; d.bioIsGeneric = false; }

    // Work
    if (findSpans(/works?\s+at\s/i).length > 0 || findContains("present","workplace").length > 0 || bioHits.length > 0) {
      d.hasWork = true;
      d.workIsSpecific = !["self-employed","freelancer"].some(v => pt.includes(v));
    }

    // Education
    if (findSpans(/(?:studied|went|goes|studies)\s+(?:at|to)\s/i).length > 0 ||
        findContains("college","university","school","institute").length > 0) {
      d.hasEducation = true;
      d.educationIsSpecific = !["school of hard knocks","university of life"].some(v => pt.includes(v));
    }

    // Location
    if (findSpans(/lives?\s+in\s/i).length > 0 || pt.includes("lives in") || pt.includes("current city")) d.hasCurrentCity = true;
    if (findSpans(/^from\s+[A-Z]/).length > 0 || /\bfrom\s+[a-z]{2,}/i.test(pt)) d.hasHometown = true;

    // Relationship
    if (["married","in a relationship","engaged","single","divorced","widowed"].some(w => pt.includes(w))) d.hasRelationship = true;

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
    if (d.accountAgeMonths === null) {
      for (const o of joinedSpans) {
        const m = o.text.match(/(\d{4})/);
        if (m && parseInt(m[1]) > 2004) { d.accountAgeMonths = (new Date().getFullYear() - parseInt(m[1])) * 12; break; }
      }
    }

    // Life events
    d.hasLifeEvents = findContains("life event","got married","had a baby","started a new job","moved to").length > 0 ||
      findSpans(/^\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i).length > 0;

    return d;
  }

  // ── Phase 3: Posts + Engagement Names ────────────────────────────────

  async function scrapePosts(onProgress) {
    onProgress("Loading posts...", 30);
    const clickedAll = await clickTab("all");
    if (!clickedAll) await clickTab("posts");
    await sleep(1000);
    scrollToTop();
    await sleep(500);

    onProgress("Scrolling through posts...", 35);
    await scrollDown(8, 1200);

    onProgress("Analyzing post content...", 50);
    const pt = pageText();

    // Timestamps
    const timestamps = [];
    for (const link of $$("a[aria-label]")) {
      const label = link.getAttribute("aria-label") || "";
      const m = label.match(/(\w+\s+\d{1,2},?\s+\d{4}(?:\s+at\s+\d{1,2}:\d{2}\s*[AP]M)?)/i);
      if (m) {
        const parsed = new Date(m[1].replace(" at ", " "));
        if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 2004) timestamps.push(parsed.getTime());
      }
    }
    const now = Date.now();
    for (const o of findSpans(/^\d+\s*[hdmw]\s*$/i)) {
      const hm = o.text.match(/(\d+)\s*h/i);
      const dm = o.text.match(/(\d+)\s*d/i);
      const wm = o.text.match(/(\d+)\s*w/i);
      if (hm) timestamps.push(now - parseInt(hm[1]) * 3600000);
      else if (dm) timestamps.push(now - parseInt(dm[1]) * 86400000);
      else if (wm) timestamps.push(now - parseInt(wm[1]) * 604800000);
    }

    const totalPosts = Math.max(
      $$('[role="article"]').length,
      timestamps.length,
      (pt.match(/like\s*·\s*comment/gi) || []).length
    );

    // Content analysis from page text
    const sharedMatches = (pt.match(/shared\s+a\s+(post|photo|video|memory|link|reel)/gi) || []);
    const sharedCount = sharedMatches.length;

    // ── Collect engagement names (people who liked/commented) ──
    onProgress("Analyzing engagement patterns...", 55);
    const engagementNames = [];

    // Method 1: Hover/tooltip names on reactions (aria-label on reaction buttons)
    const reactionLabels = $$('[aria-label*="and "][aria-label*="other"]');
    for (const el of reactionLabels) {
      const label = el.getAttribute("aria-label") || "";
      // Format: "Ahmed Ali, Sarah Khan, and 45 others"
      const names = label.split(/,|and \d/).map(n => n.trim()).filter(n => n && !n.match(/^\d/));
      engagementNames.push(...names);
    }

    // Method 2: Visible reaction/like text ("Ahmed Ali, Priya Sharma and 12 others")
    const reactionTexts = findSpans(/and\s+\d+\s+others?$/i);
    for (const o of reactionTexts) {
      const names = o.text.split(/,|and \d/).map(n => n.trim()).filter(n => n && !n.match(/^\d/) && n.length > 2);
      engagementNames.push(...names);
    }

    // Method 3: Comment author names
    const commentAuthors = $$('[role="article"] a[role="link"]');
    for (const a of commentAuthors) {
      const href = a.getAttribute("href") || "";
      if (href.includes("facebook.com/") && !href.includes("/posts/") && !href.includes("/photos/")) {
        const name = a.textContent.trim();
        if (name.length > 1 && name.length < 40 && !name.includes("·") && !/^\d/.test(name)) {
          engagementNames.push(name);
        }
      }
    }

    // Thirsty comments
    const thirstyPhrases = [
      "hi beautiful","hello dear","you are so pretty","gorgeous",
      "hey beautiful","nice pic","so beautiful","marry me","hello sweetie",
      "beautiful lady","pretty lady","hello angel","hi dear",
      "can we be friends","inbox me","dm me","i want to know you",
    ];
    let thirstyCount = 0;
    for (const phrase of thirstyPhrases) {
      thirstyCount += (pt.match(new RegExp(phrase, "gi")) || []).length;
    }

    return {
      totalPosts,
      timestamps,
      sharedCount,
      originalCount: Math.max(0, totalPosts - sharedCount),
      hasCheckIns: /\b(was at |is at |checked in)\b/i.test(pt),
      hasPersonalUpdates: /\b(feeling |i'm |i am |today i |so happy|so sad|excited|grateful)\b/i.test(pt),
      hasBirthdayWishes: (pt.match(/happy\s*birthday|happy\s*bday|\bhbd\b/gi) || []).length >= 2,
      hasLifeEvents: /\b(life event|started working|moved to|got married|new job|graduated)\b/i.test(pt),
      engagementBait: /\b(share if you|type amen|1 like =|like and share)\b/i.test(pt),
      mostlyMemes: totalPosts >= 3 && sharedCount / totalPosts > 0.7,
      thirstyCount,
      engagementNames,
      hasCommentThreads: findSpans(/\d+\s*comments?/i).length >= 2 || findContains("reply","replies").length >= 1,
      taggedByOthers: /\b(was with|— with|is with|tagged)\b/i.test(pt),
    };
  }

  // ── Phase 4: Friends List + Gender Ratio ─────────────────────────────

  async function scrapeFriends(onProgress) {
    onProgress("Checking friends list...", 65);

    const d = {
      friendCount: null, mutualFriends: null,
      friendNames: [],
    };

    // Get friend count from wherever we are
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

    // Followers fallback
    if (d.friendCount === null) {
      const followerSpans = findSpans(/[\d,.]+[kKmM]?\s*followers?\b/i);
      for (const o of followerSpans) {
        const text = o.text.toLowerCase().replace(/,/g, "");
        const mK = text.match(/([\d.]+)\s*k/);
        const mM = text.match(/([\d.]+)\s*m/);
        if (mM) { d.friendCount = Math.round(parseFloat(mM[1]) * 1000000); break; }
        if (mK) { d.friendCount = Math.round(parseFloat(mK[1]) * 1000); break; }
        const n = extractNumber(text);
        if (n) { d.friendCount = n; break; }
      }
    }

    // Navigate to Friends tab to collect names
    onProgress("Scanning friends list...", 70);
    const clicked = await clickTab("friends");
    if (clicked) {
      await sleep(1500);
      await scrollDown(5, 1000);

      // Collect friend names from the grid
      const friendLinks = $$('a[href*="facebook.com/"]').filter(a => {
        const name = a.textContent.trim();
        const href = a.getAttribute("href") || "";
        return name.length > 1 && name.length < 50 &&
          !name.includes("·") && !/^\d/.test(name) &&
          !href.includes("/posts/") && !href.includes("/photos/") &&
          !href.includes("/videos/") && !href.includes("/reels/") &&
          !NON_NAMES.has(name.toLowerCase());
      });

      // Deduplicate
      const seen = new Set();
      for (const a of friendLinks) {
        const name = a.textContent.trim();
        if (!seen.has(name) && name.split(/\s+/).length >= 2) {
          seen.add(name);
          d.friendNames.push(name);
        }
      }

      // Also re-check friend count from this tab
      if (d.friendCount === null) {
        const fcSpans = findSpans(/[\d,]+\s*friends?\b/i);
        for (const o of fcSpans) {
          if (!o.lower.includes("mutual")) {
            const n = extractNumber(o.text);
            if (n > 0) { d.friendCount = n; break; }
          }
        }
      }
    }

    return d;
  }

  // ── Phase 5: Identity ────────────────────────────────────────────────

  function scrapeIdentity() {
    const name = getProfileName();
    const url = window.location.href;
    const path = window.location.pathname;
    return {
      nameMatchesEthnicity: true,
      randomNumbers: /\d{2,}/.test(name) || /\.\d{3,}/.test(path),
      unusualFormatting: (name.length > 4 && name === name.toUpperCase()) ||
        /[!@#$%^&*]{2,}/.test(name) || /\.{3,}/.test(name),
      multipleNameChanges: findContains("former name","previously known as").length > 0,
      identityConsistent: true,
      hasVanityUrl: !url.includes("profile.php?id=") && !/\/\d{10,}/.test(url) && !/\.\d{3,}/.test(path),
    };
  }

  // ── Post timing analysis ─────────────────────────────────────────────

  function analyzePostTiming(timestamps) {
    const d = {
      postsSpreadNaturally: true, bulkPostsWithinHour: false,
      bulkPatternRepeats: false, consistentExactTimes: false,
      silenceThenBurst: false, timezoneMismatch: false,
    };
    if (timestamps.length < 3) return d;
    const sorted = [...new Set(timestamps)].sort((a, b) => a - b);

    for (let i = 0; i <= sorted.length - 3; i++) {
      if (sorted[i + 2] - sorted[i] < 3600000) { d.bulkPostsWithinHour = true; d.postsSpreadNaturally = false; break; }
    }
    if (sorted.length >= 4) {
      const gaps = [];
      for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i] - sorted[i - 1]);
      const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      if (gaps.some(g => g > avgGap * 5) && gaps.some(g => g < avgGap * 0.1)) { d.silenceThenBurst = true; d.postsSpreadNaturally = false; }
    }
    if (sorted.length >= 5) {
      const hours = sorted.map(t => new Date(t).getHours());
      const counts = {};
      hours.forEach(h => { counts[h] = (counts[h] || 0) + 1; });
      if (Math.max(...Object.values(counts)) >= hours.length * 0.7) { d.consistentExactTimes = true; d.postsSpreadNaturally = false; }
    }
    return d;
  }

  // ── Master collect ───────────────────────────────────────────────────

  async function collectProfile(onProgress) {
    const name = getProfileName();
    if (name === "Unknown" || NON_NAMES.has(name.toLowerCase())) return null;

    onProgress("Starting deep scan...", 0);

    const header = scrapeHeader();
    const about = await scrapeAbout(onProgress);
    const posts = await scrapePosts(onProgress);
    const friends = await scrapeFriends(onProgress);
    const identity = scrapeIdentity();

    // Navigate back to main profile
    onProgress("Computing verdict...", 90);
    await clickTab("all");
    scrollToTop();

    // ── Gender analysis on engagement + friends ──
    const profileGender = GenderEstimator.estimate(name);

    // Analyze engagement names
    const engagementGender = GenderEstimator.analyzeNames(posts.engagementNames);

    // Analyze friend names
    const friendsGender = GenderEstimator.analyzeNames(friends.friendNames);

    // Compute same-gender percentages
    let pctSameGenderLikes = null;
    let friendsGenderSkewed = false;
    let friendsOppositeGender = false;

    if (engagementGender.total >= 3 && profileGender !== "unknown") {
      const sameGender = profileGender === "female" ? engagementGender.femalePct : engagementGender.malePct;
      pctSameGenderLikes = sameGender;
    }

    if (friendsGender.total >= 10) {
      const ratio = friendsGender.femalePct;
      if (ratio !== null && (ratio > 0.8 || ratio < 0.2)) {
        friendsGenderSkewed = true;
        if (profileGender === "female" && ratio < 0.2) friendsOppositeGender = true;
        if (profileGender === "male" && ratio > 0.8) friendsOppositeGender = true;
      }
    }

    const data = {
      profileName: name,
      profileGender,
      completeness: {
        hasProfilePhoto: header.hasProfilePhoto,
        profilePhotoType: header.profilePhotoType,
        hasCoverPhoto: header.hasCoverPhoto,
        hasBio: about.hasBio, bioIsGeneric: about.bioIsGeneric,
        hasWork: about.hasWork, workIsSpecific: about.workIsSpecific,
        hasEducation: about.hasEducation, educationIsSpecific: about.educationIsSpecific,
        hasRelationship: about.hasRelationship,
        hasHometown: about.hasHometown, hasCurrentCity: about.hasCurrentCity,
        hasLifeEvents: about.hasLifeEvents || posts.hasLifeEvents,
      },
      activity: {
        accountAgeMonths: about.accountAgeMonths,
        totalPosts: posts.totalPosts,
        hadDormantPeriod: false,
        activityRampGradual: true,
      },
      network: {
        friendCount: friends.friendCount,
        mutualFriends: friends.mutualFriends,
        friendsGenderSkewed,
        friendsOppositeGender,
        friendsAppearFake: false,
      },
      postTiming: analyzePostTiming(posts.timestamps),
      engagementGender: {
        pctSameGenderLikes,
        hasTaggedSameGender: false,
        personalSameGenderComments: false,
        thirstyComments: posts.thirstyCount >= 3,
      },
      photos: {
        photoQualityMixed: true,
        hasCasualPhotos: posts.totalPosts > 0,
        allProfessional: false,
        suspectedAI: false,
        showsProgression: posts.timestamps.length >= 3 || posts.totalPosts > 5,
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
        dmPivot: /\b(inbox me|dm me|whatsapp me|text me)\b/i.test(pageText()),
        relationshipSeeking: /looking for\s+(a\s+)?relationship/i.test(pageText()),
      },
      identity,
      // Raw data for dynamic scoring
      _raw: {
        engagementGender,
        friendsGender,
        engagementNames: posts.engagementNames.length,
        friendNamesScanned: friends.friendNames.length,
        timestampsFound: posts.timestamps.length,
      },
    };

    console.group("[FB Analyzer] Deep scan results");
    console.log("Name:", name, "| Gender estimate:", profileGender);
    console.log("Completeness:", data.completeness);
    console.log("Activity:", data.activity);
    console.log("Network:", data.network);
    console.log("Post Timing:", data.postTiming);
    console.log("Engagement Gender:", data.engagementGender);
    console.log("  → Engagement names collected:", posts.engagementNames.length);
    console.log("  → Engagement gender breakdown:", engagementGender);
    console.log("  → pctSameGenderLikes:", pctSameGenderLikes);
    console.log("Friends Gender:", friendsGender);
    console.log("  → Friend names scanned:", friends.friendNames.length);
    console.log("Photos:", data.photos);
    console.log("Content:", data.content);
    console.log("Interaction:", data.interaction);
    console.log("Identity:", data.identity);
    console.log(`Posts: ${posts.totalPosts} | Timestamps: ${posts.timestamps.length} | Thirsty: ${posts.thirstyCount}`);
    console.groupEnd();

    return data;
  }

  return { collectProfile, getProfileName, NON_NAMES };
})();
