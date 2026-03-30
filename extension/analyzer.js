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
    let s = 0;
    const obs = [];
    const fields = [
      [d.hasProfilePhoto && d.profilePhotoType === "real", 15, "Real profile photo"],
      [d.hasCoverPhoto, 10, "Cover photo present"],
      [d.hasBio && !d.bioIsGeneric, 15, "Specific bio/description"],
      [d.hasBio && d.bioIsGeneric, 7, null],
      [d.hasWork && d.workIsSpecific, 15, "Specific work history"],
      [d.hasWork && !d.workIsSpecific, 7, null],
      [d.hasEducation && d.educationIsSpecific, 12, "Specific education"],
      [d.hasEducation && !d.educationIsSpecific, 6, null],
      [d.hasRelationship, 5, null],
      [d.hasCurrentCity, 8, null],
      [d.hasHometown, 8, null],
      [d.hasLifeEvents, 12, null],
    ];

    let earned = 0;
    for (const [cond, pts, ob] of fields) {
      if (cond) { earned += pts; if (ob) obs.push(ob); }
    }
    s = Math.min(100, earned);

    if (s >= 80) obs.unshift("Profile is well-filled with specific details");
    else if (s < 30) obs.push("Profile is mostly empty");

    return { name: "Profile Completeness", num: 1, weight: 0.10, score: clamp(s), flag: flag(s), obs };
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

  function scoreEngagementGender(d) {
    // This is THE catfish detector — weight dynamically based on data
    let s = 70; // Neutral when no data
    const obs = [];
    let hasData = false;

    if (d.pctSameGenderLikes != null) {
      hasData = true;
      const pct = d.pctSameGenderLikes;
      if (pct >= 0.35) { s = 85; obs.push(`Healthy same-gender engagement (${Math.round(pct * 100)}%)`); }
      else if (pct >= 0.20) { s = 65; obs.push(`Slightly skewed engagement (${Math.round(pct * 100)}% same-gender)`); }
      else if (pct >= 0.08) { s = 35; obs.push(`Heavily opposite-gender engagement (${Math.round(pct * 100)}% same-gender)`); }
      else { s = 10; obs.push(`Almost zero same-gender engagement (${Math.round(pct * 100)}%) — classic catfish pattern`); }
    }

    if (d.hasTaggedSameGender) { s += 10; obs.push("Tagged with same-gender friends"); }
    if (d.personalSameGenderComments) { s += 10; obs.push("Personal comments from same-gender friends"); }
    if (d.thirstyComments) { s -= 20; obs.push("Generic thirsty comments detected"); }

    // Dynamic weight: if we have gender data, this signal matters A LOT
    const weight = hasData ? 0.20 : 0.05;

    if (!obs.length) obs.push("Engagement gender data not available — scored neutral");
    return { name: "Engagement Gender", num: 5, weight, score: clamp(s), flag: flag(clamp(s)), obs, hasData };
  }

  function scorePhotos(d) {
    let s = 65;
    const obs = [];
    if (d.photoQualityMixed && d.hasCasualPhotos) { s += 15; obs.push("Mix of casual and professional photos"); }
    if (d.allProfessional) { s -= 20; obs.push("All photos are professional quality"); }
    if (d.suspectedAI) { s -= 40; obs.push("Photos may be AI-generated"); }
    if (d.showsProgression) { s += 10; obs.push("Photos show progression over time"); }
    else { s -= 10; obs.push("Limited photo history"); }
    if (d.hasGroupTagged) { s += 15; obs.push("Tagged in others' photos — strong signal"); }
    if (d.reverseSearchMatch) { s -= 35; obs.push("Reverse search matches — likely stolen photos"); }
    if (d.onlySelfies) { s -= 10; obs.push("Only selfies"); }
    if (!obs.length) obs.push("Photo data looks normal");
    return { name: "Photo Authenticity", num: 6, weight: 0.10, score: clamp(s), flag: flag(clamp(s)), obs };
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
      scoreEngagementGender(profileData.engagementGender || {}),
      scorePhotos(profileData.photos || {}),
      scoreContent(profileData.content || {}),
      scoreInteraction(profileData.interaction || {}),
      scoreIdentity(profileData.identity || {}),
    ];

    let finalScore = computeDynamicScore(signals);

    // Apply friend count boost
    const fc = profileData.network?.friendCount;
    finalScore = Math.round((finalScore + friendCountBoost(fc)) * 10) / 10;
    finalScore = Math.max(0, Math.min(100, finalScore));

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
