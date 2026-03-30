/**
 * FB Profile Authenticity Analyzer v2 — Dynamic Scoring Engine
 *
 * Key principles:
 * 1. Missing data = neutral (70), NOT penalizing
 * 2. 1500+ connections = strong positive signal
 * 3. Gender ratio (engagement + friends) is THE dominant signal
 * 4. Dynamic weights — signals with more data get more weight
 * 5. Strong positive signals boost more than weak negatives penalize
 */

/* exported FBAnalyzer */
const FBAnalyzer = (() => {
  "use strict";

  function clamp(v) { return Math.max(0, Math.min(100, Math.round(v))); }

  function flag(s) {
    if (s >= 70) return "clean";
    if (s >= 40) return "yellow";
    return "red";
  }

  // ── Signal scorers (dynamic) ─────────────────────────────────────────

  function scoreCompleteness(d) {
    // Simple: count how many KEY fields are present. 4+ = complete profile.
    const obs = [];
    let filled = 0;

    if (d.hasProfilePhoto) filled++;
    if (d.hasCoverPhoto) filled++;
    if (d.hasBio) filled++;
    if (d.hasWork) filled++;
    if (d.hasEducation) filled++;
    if (d.hasCurrentCity || d.hasHometown) filled++;
    if (d.hasRelationship) filled++;
    if (d.hasLifeEvents) filled++;

    // Score: 0-1 fields = 20, 2 = 40, 3 = 55, 4 = 70, 5 = 80, 6 = 90, 7+ = 95
    let s;
    if (filled >= 7) { s = 95; obs.push("Profile is well-filled with specific details"); }
    else if (filled >= 6) { s = 90; obs.push("Profile is well-filled with specific details"); }
    else if (filled >= 5) { s = 80; obs.push("Profile has good detail coverage"); }
    else if (filled >= 4) { s = 70; obs.push("Profile has reasonable details"); }
    else if (filled >= 3) { s = 55; obs.push("Profile has some details but gaps"); }
    else if (filled >= 2) { s = 40; obs.push("Profile is thin on details"); }
    else { s = 20; obs.push("Profile is mostly empty"); }

    // Bonus: specific (not generic) bio/work
    if (d.hasBio && !d.bioIsGeneric) s = Math.min(100, s + 5);
    if (d.hasWork && d.workIsSpecific) s = Math.min(100, s + 5);

    return { name: "Profile Completeness", num: 1, weight: 0.10, score: clamp(s), flag: flag(clamp(s)), obs };
  }

  function scoreActivity(d) {
    let s = 70; // Neutral default
    const obs = [];
    let dataPoints = 0;

    if (d.accountAgeMonths != null) {
      dataPoints++;
      if (d.accountAgeMonths >= 60) { s += 15; obs.push(`Account is ${Math.round(d.accountAgeMonths / 12)} years old`); }
      else if (d.accountAgeMonths >= 24) { s += 10; obs.push(`Account is ${Math.round(d.accountAgeMonths / 12)} years old`); }
      else if (d.accountAgeMonths < 6) { s -= 20; obs.push(`Account is only ${d.accountAgeMonths} months old`); }
    }

    if (d.totalPosts != null && d.totalPosts > 0) {
      dataPoints++;
      if (d.totalPosts > 10) { s += 5; obs.push(`${d.totalPosts}+ posts visible`); }
      if (d.accountAgeMonths != null && d.accountAgeMonths < 6 && d.totalPosts > 100) {
        s -= 25; obs.push("Abnormally high posts for new account");
      }
    }

    if (d.hadDormantPeriod) { s -= 25; obs.push("Dormant then suddenly active"); }
    if (!d.activityRampGradual && dataPoints > 0) { s -= 15; obs.push("Activity started abruptly"); }

    if (!obs.length) obs.push("Account age data not available — scored neutral");
    return { name: "Account Age vs Activity", num: 2, weight: 0.08, score: clamp(s), flag: flag(clamp(s)), obs };
  }

  function scoreNetwork(d) {
    let s = 65;
    const obs = [];

    if (d.friendCount != null) {
      // Dynamic scoring based on connection count
      if (d.friendCount >= 1500) {
        s += 25;
        obs.push(`${d.friendCount.toLocaleString()} connections — strong established network`);
      } else if (d.friendCount >= 500) {
        s += 15;
        obs.push(`${d.friendCount.toLocaleString()} connections — healthy network`);
      } else if (d.friendCount >= 100) {
        s += 5;
        obs.push(`${d.friendCount.toLocaleString()} connections`);
      } else if (d.friendCount < 30) {
        s -= 20;
        obs.push(`Very low connection count (${d.friendCount})`);
      }

      if (d.friendCount >= 4900) {
        s -= 10;
        obs.push("Near Facebook friend cap — could be mass-adding");
      }
    }

    if (d.mutualFriends != null) {
      if (d.mutualFriends >= 20) { s += 15; obs.push(`${d.mutualFriends} mutual friends — strong signal`); }
      else if (d.mutualFriends >= 5) { s += 10; obs.push(`${d.mutualFriends} mutual friends`); }
      else if (d.mutualFriends === 0) { s -= 10; obs.push("Zero mutual friends"); }
    }

    if (d.friendsGenderSkewed) {
      s -= 15;
      if (d.friendsOppositeGender) { s -= 15; obs.push("Friends heavily skewed to opposite gender — catfish indicator"); }
      else obs.push("Friends list skewed to one gender");
    }

    if (d.friendsAppearFake) { s -= 25; obs.push("Many friends appear to be fake profiles"); }

    if (!obs.length) obs.push("Network data not available — scored neutral");
    return { name: "Friend Count & Network", num: 3, weight: 0.12, score: clamp(s), flag: flag(clamp(s)), obs };
  }

  function scorePostTiming(d) {
    let s = 80;
    const obs = [];
    if (!d.postsSpreadNaturally) s -= 10;
    if (d.bulkPostsWithinHour) { s -= 25; obs.push("Bulk posts within short window"); }
    if (d.bulkPatternRepeats) { s -= 15; obs.push("Bulk pattern repeats"); }
    if (d.consistentExactTimes) { s -= 25; obs.push("Posts at same times — automation"); }
    if (d.silenceThenBurst) { s -= 20; obs.push("Long silence then sudden burst"); }
    if (d.timezoneMismatch) { s -= 15; obs.push("Timezone mismatch"); }
    if (!obs.length) obs.push("Post timing looks natural and human-like");
    return { name: "Post Timing", num: 4, weight: 0.10, score: clamp(s), flag: flag(clamp(s)), obs };
  }

  function scoreEngagementGender(d, raw) {
    let s = 70;
    const obs = [];
    let hasData = false;

    if (d.pctSameGenderLikes != null) {
      hasData = true;

      // Check sample quality — if too many unknowns, reduce confidence
      const eg = raw?.engagementGender;
      const sampleSize = eg?.total || 0;
      const unknownPct = eg ? eg.unknown / eg.total : 0;
      const knownCount = eg ? (eg.female + eg.male) : 0;

      if (knownCount < 10 || unknownPct > 0.3) {
        // Small or unreliable sample — reduce to moderate confidence
        s = 65;
        obs.push(`Gender data from small sample (${knownCount} known of ${sampleSize}) — low confidence`);
        hasData = false; // Don't give this high weight
      } else {
        const pct = d.pctSameGenderLikes;
        if (pct >= 0.35) { s = 85; obs.push(`Healthy same-gender engagement (${Math.round(pct * 100)}%, n=${knownCount})`); }
        else if (pct >= 0.20) { s = 65; obs.push(`Slightly skewed (${Math.round(pct * 100)}% same-gender, n=${knownCount})`); }
        else if (pct >= 0.08) { s = 30; obs.push(`Heavily opposite-gender (${Math.round(pct * 100)}% same-gender, n=${knownCount})`); }
        else { s = 10; obs.push(`Almost zero same-gender engagement (${Math.round(pct * 100)}%) — catfish pattern`); }
      }
    }

    if (d.hasTaggedSameGender) { s += 10; obs.push("Tagged with same-gender friends"); }
    if (d.personalSameGenderComments) { s += 10; obs.push("Personal comments from same-gender friends"); }
    if (d.thirstyComments) { s -= 20; obs.push("Generic thirsty comments detected"); }

    const weight = hasData ? 0.18 : 0.05;

    if (!obs.length) obs.push("Engagement gender data not available — scored neutral");
    return { name: "Engagement Gender", num: 5, weight, score: clamp(s), flag: flag(clamp(s)), obs, hasData };
  }

  function scorePhotos(d) {
    // Start neutral — we can't analyze photo content without LLM
    let s = 70;
    const obs = [];
    if (d.hasGroupTagged) { s += 15; obs.push("Tagged in others' photos — strong authenticity signal"); }
    if (d.showsProgression) { s += 5; obs.push("Photos span over time"); }
    if (d.allProfessional) { s -= 20; obs.push("All photos look professional — possible stolen content"); }
    if (d.suspectedAI) { s -= 40; obs.push("Photos may be AI-generated"); }
    if (d.reverseSearchMatch) { s -= 35; obs.push("Reverse search matches — likely stolen"); }
    if (d.onlySelfies) { s -= 10; obs.push("Only selfies"); }
    if (!obs.length) obs.push("Photo analysis neutral — can't verify content without reverse search");
    return { name: "Photo Authenticity", num: 6, weight: 0.08, score: clamp(s), flag: flag(clamp(s)), obs };
  }

  function scoreContent(d) {
    let s = 60;
    const obs = [];
    if (d.hasOriginalPosts) { s += 12; obs.push("Posts original content"); }
    if (d.hasPersonalUpdates) { s += 10; obs.push("Personal updates visible"); }
    if (d.hasCheckIns) { s += 8; obs.push("Location check-ins"); }
    if (d.hasBirthdayWishes) { s += 12; obs.push("Birthday wishes from friends"); }
    if (d.hasLifeEvents) { s += 8; obs.push("Life events documented"); }
    if (d.mostlyMemes) { s -= 20; obs.push("Mostly shared memes/quotes"); }
    if (d.engagementBait) { s -= 15; obs.push("Engagement bait content"); }
    if (!d.languageMatchesLocation) { s -= 15; obs.push("Language doesn't match location"); }
    if (!obs.length) obs.push("Content patterns look normal");
    return { name: "Content Pattern", num: 7, weight: 0.08, score: clamp(s), flag: flag(clamp(s)), obs };
  }

  function scoreInteraction(d) {
    let s = 70;
    const obs = [];
    if (d.twoWayConversations) { s += 12; obs.push("Two-way conversations visible"); }
    if (d.taggedByOthers) { s += 12; obs.push("Tagged by other people"); }
    if (d.sendsStrangerRequests) { s -= 20; obs.push("Mass friend requests to strangers"); }
    if (d.oneDirectional) { s -= 15; obs.push("One-directional engagement"); }
    if (d.manyGroups) { s -= 10; obs.push("Member of many buy/sell/dating groups"); }
    if (d.dmPivot) { s -= 20; obs.push("Pushes conversations to DMs/WhatsApp"); }
    if (d.relationshipSeeking) { s -= 15; obs.push("Publicly seeking relationships"); }
    if (!obs.length) obs.push("Interaction patterns look normal");
    return { name: "Interaction Behavior", num: 8, weight: 0.08, score: clamp(s), flag: flag(clamp(s)), obs };
  }

  function scoreIdentity(d) {
    let s = 80;
    const obs = [];
    if (d.nameMatchesEthnicity) { s += 5; }
    else { s -= 25; obs.push("Name doesn't match apparent background"); }
    if (d.randomNumbers) { s -= 20; obs.push("Random numbers in username"); }
    if (d.unusualFormatting) { s -= 15; obs.push("Unusual name formatting"); }
    if (d.multipleNameChanges) { s -= 15; obs.push("Multiple name changes"); }
    if (!d.identityConsistent) { s -= 20; obs.push("Identity markers inconsistent"); }
    if (!d.hasVanityUrl) { s -= 10; obs.push("Auto-generated profile URL"); }
    if (!obs.length) obs.push("Name and identity are consistent");
    return { name: "Name & Identity", num: 9, weight: 0.05, score: clamp(s), flag: flag(clamp(s)), obs };
  }

  // ── Signal 10: Engagement Ratio (likes vs friends) — KILLER signal ──

  function scoreEngagementRatio(d) {
    if (!d || !d.ratio || d.verdict === "no_data") {
      return { name: "Engagement Ratio", num: 10, weight: 0.04, score: 70, flag: "clean",
        obs: ["Engagement ratio data not available"], hasData: false };
    }

    let s = 70;
    const obs = [];
    const hasData = true;

    if (d.verdict === "healthy") {
      s = 90;
      obs.push(`${d.ratio}% engagement — healthy (avg ${d.avgLikes} likes)`);
    } else if (d.verdict === "normal") {
      s = 75;
      obs.push(`${d.ratio}% engagement — normal (avg ${d.avgLikes} likes)`);
    } else if (d.verdict === "low") {
      s = 25;
      obs.push(`Only ${d.ratio}% engagement — ${d.avgLikes} avg likes with many friends is very low`);
    } else if (d.verdict === "suspicious") {
      s = 5;
      obs.push(`${d.ratio}% engagement — almost no likes despite large friend list (avg ${d.avgLikes})`);
    }

    // Dynamic weight: low/suspicious engagement ratio is THE biggest red flag
    let weight;
    if (!hasData) weight = 0.04;
    else if (d.verdict === "suspicious" || d.verdict === "low") weight = 0.22;
    else weight = 0.12;

    return { name: "Engagement Ratio", num: 10, weight, score: clamp(s), flag: flag(clamp(s)), obs, hasData };
  }

  // ── Dynamic scoring ──────────────────────────────────────────────────

  function computeDynamicScore(signals) {
    // Normalize weights to sum to 1.0 (since engagement weight is dynamic)
    const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
    let score = 0;
    for (const s of signals) {
      score += s.score * (s.weight / totalWeight);
    }
    return Math.round(score * 10) / 10;
  }

  // ── Friends-count boost (dynamic) ────────────────────────────────────

  function friendCountBoost(friendCount) {
    if (friendCount === null || friendCount === undefined) return 0;
    if (friendCount >= 3000) return 5;
    if (friendCount >= 1500) return 3;
    if (friendCount >= 500) return 1;
    if (friendCount < 30) return -3;
    return 0;
  }

  // ── Catfish combo penalty ──────────────────────────────────────────────
  // Combines weak signals that individually aren't conclusive but together scream fake

  function catfishComboPenalty(profileData) {
    let redFlags = 0;
    const flags = [];

    // Random numbers in username
    if (profileData.identity?.randomNumbers) { redFlags++; flags.push("Auto-generated username"); }

    // No vanity URL
    if (profileData.identity && !profileData.identity.hasVanityUrl) { redFlags++; }

    // "Single" status (catfish bait)
    if (profileData.completeness?.hasRelationship) {
      // Having relationship status isn't bad, but "Single" specifically is a catfish signal
      // We detect this in the collector
    }

    // Low profile completeness (< 60) despite having photos
    if (!profileData.completeness?.hasEducation && !profileData.completeness?.hasWork) {
      redFlags++; flags.push("Missing work AND education");
    }

    // Engagement ratio suspicious
    if (profileData.engagementRatio?.verdict === "suspicious") {
      redFlags += 2; flags.push("Very low engagement vs friend count");
    } else if (profileData.engagementRatio?.verdict === "low") {
      redFlags++; flags.push("Low engagement vs friend count");
    }

    // Spelling errors in education (common fake signal)
    const edu = (profileData._raw?.educationText || "").toLowerCase();
    const spellingErrors = ["collage", "univercity", "univeristy", "engeneering", "managment"];
    if (spellingErrors.some(e => edu.includes(e))) {
      redFlags++; flags.push("Spelling errors in education");
    }

    // Calculate penalty: red flags compound aggressively
    // 0-1 = no penalty, 2 = -8, 3 = -15, 4+ = -25
    let penalty = 0;
    if (redFlags >= 4) penalty = -25;
    else if (redFlags >= 3) penalty = -15;
    else if (redFlags >= 2) penalty = -8;

    return { penalty, redFlags, flags };
  }

  // ── Verdict ──────────────────────────────────────────────────────────

  function classifyVerdict(score) {
    if (score >= 85) return { verdict: "verified_real", label: "Verified Real", color: "#34d399" };
    if (score >= 70) return { verdict: "likely_real", label: "Likely Real", color: "#6ee7b7" };
    if (score >= 50) return { verdict: "suspicious", label: "Suspicious", color: "#fbbf24" };
    if (score >= 30) return { verdict: "likely_fake", label: "Likely Fake", color: "#f97316" };
    return { verdict: "almost_certainly_fake", label: "Almost Certainly Fake", color: "#ef4444" };
  }

  function checkCatfishCombo(signals) {
    const byNum = {};
    signals.forEach(s => { byNum[s.num] = s; });
    return (byNum[4]?.score || 100) < 30 &&
           (byNum[5]?.score || 100) < 30 &&
           (byNum[6]?.score || 100) < 30;
  }

  function getTopEvidence(signals, n = 3) {
    const ranked = [...signals].sort((a, b) =>
      Math.abs(b.score - 50) * b.weight - Math.abs(a.score - 50) * a.weight
    );
    const evidence = [];
    for (const sig of ranked) {
      for (const o of sig.obs) {
        if (evidence.length >= n) return evidence;
        evidence.push({ signal: sig.name, text: o });
      }
    }
    return evidence;
  }

  function getRecommendation(score, catfish) {
    if (catfish) return { emoji: "\u{1F6AB}", text: "Do not engage — Classic catfish pattern detected" };
    if (score >= 70) return { emoji: "\u2705", text: "Safe to engage — Profile appears authentic" };
    if (score >= 50) return { emoji: "\u26A0\uFE0F", text: "Proceed with caution — Verify identity first" };
    return { emoji: "\u{1F6AB}", text: "Do not engage — Strong fake indicators" };
  }

  function getNextSteps(score, signals) {
    if (score >= 70) return [];
    const steps = [];
    const byNum = {};
    signals.forEach(s => { byNum[s.num] = s.score; });
    if ((byNum[6] || 100) < 50) steps.push("Reverse image search their photos (Google Images / TinEye)");
    if ((byNum[5] || 100) < 50) steps.push("Check who likes their posts — all opposite gender = catfish red flag");
    steps.push("Ask for a live video call — scammers always avoid this");
    return steps.slice(0, 3);
  }

  // ── Main ─────────────────────────────────────────────────────────────

  function analyze(profileData) {
    const signals = [
      scoreCompleteness(profileData.completeness || {}),
      scoreActivity(profileData.activity || {}),
      scoreNetwork(profileData.network || {}),
      scorePostTiming(profileData.postTiming || {}),
      scoreEngagementGender(profileData.engagementGender || {}, profileData._raw || {}),
      scorePhotos(profileData.photos || {}),
      scoreContent(profileData.content || {}),
      scoreInteraction(profileData.interaction || {}),
      scoreIdentity(profileData.identity || {}),
      scoreEngagementRatio(profileData.engagementRatio || {}),
    ];

    let finalScore = computeDynamicScore(signals);

    // Apply friend count boost
    const fc = profileData.network?.friendCount;
    finalScore += friendCountBoost(fc);

    // Apply catfish combo penalty
    const combo = catfishComboPenalty(profileData);
    finalScore += combo.penalty;
    if (combo.flags.length > 0) {
      console.log("[FBA] Catfish combo flags:", combo.flags, "penalty:", combo.penalty);
    }

    finalScore = Math.round(Math.max(0, Math.min(100, finalScore)) * 10) / 10;

    const catfish = checkCatfishCombo(signals);

    let verdictInfo;
    if (catfish) {
      verdictInfo = { verdict: "catfish_pattern", label: "CATFISH PATTERN DETECTED", color: "#ef4444" };
    } else {
      verdictInfo = classifyVerdict(finalScore);
    }

    return {
      profileName: profileData.profileName || "Unknown",
      finalScore,
      ...verdictInfo,
      catfish,
      signals,
      topEvidence: getTopEvidence(signals),
      recommendation: getRecommendation(finalScore, catfish),
      nextSteps: getNextSteps(finalScore, signals),
    };
  }

  return { analyze };
})();
