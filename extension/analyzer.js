/**
 * FB Profile Authenticity Analyzer — Scoring Engine (JS port)
 * 9-signal weighted scoring, catfish combo detection, verdict classification.
 * Runs entirely in-browser — no server dependency.
 */

/* exported FBAnalyzer */
const FBAnalyzer = (() => {
  "use strict";

  // ── Helpers ──────────────────────────────────────────────────────────

  function clamp(v, lo = 0, hi = 100) {
    return Math.max(lo, Math.min(hi, v));
  }

  function flag(score) {
    if (score >= 70) return "clean";
    if (score >= 40) return "yellow";
    return "red";
  }

  // ── Signal 1: Profile Completeness (10%) ─────────────────────────────

  function scoreCompleteness(d) {
    let s = 0;
    const obs = [];

    if (d.hasProfilePhoto) {
      if (["real", "unknown"].includes(d.profilePhotoType)) s += 20;
      else if (d.profilePhotoType === "stock") { s += 5; obs.push("Profile photo may be stock imagery"); }
      else obs.push(`Profile photo flagged as ${d.profilePhotoType}`);
    } else { obs.push("No profile photo"); }

    if (d.hasCoverPhoto) s += 10; else obs.push("No cover photo");
    if (d.hasBio && !d.bioIsGeneric) s += 10;
    else if (d.hasBio) { s += 5; obs.push("Bio is generic/vague"); }
    else obs.push("No bio section");

    if (d.hasWork && d.workIsSpecific) s += 15;
    else if (d.hasWork) { s += 7; obs.push("Work history is vague"); }
    else obs.push("No work history");

    if (d.hasEducation && d.educationIsSpecific) s += 15;
    else if (d.hasEducation) s += 7;
    if (d.hasRelationship) s += 5;
    if (d.hasHometown && d.hasCurrentCity) s += 10;
    else if (d.hasHometown || d.hasCurrentCity) s += 5;
    if (d.hasLifeEvents) s += 15;

    if (!obs.length) obs.push("Profile is well-filled with specific details");
    return { name: "Profile Completeness", num: 1, weight: 0.10, score: clamp(s), flag: flag(clamp(s)), obs };
  }

  // ── Signal 2: Account Age vs Activity (10%) ──────────────────────────

  function scoreActivity(d) {
    let s = 70;
    const obs = [];

    if (d.accountAgeMonths != null) {
      if (d.accountAgeMonths < 6) {
        s -= 20; obs.push(`Account is young (${d.accountAgeMonths} months)`);
        if (d.totalPosts != null && d.totalPosts > 100) {
          s -= 25; obs.push("Abnormally high post count for new account");
        }
      } else if (d.accountAgeMonths >= 24) {
        s += 10; obs.push(`Account is ${d.accountAgeMonths} months old`);
      }
    }

    if (d.hadDormantPeriod) { s -= 30; obs.push("Dormant period followed by sudden burst"); }
    if (!d.activityRampGradual) { s -= 20; obs.push("Activity started abruptly"); }
    if (!obs.length) obs.push("Account age and activity look natural");
    return { name: "Account Age vs Activity", num: 2, weight: 0.10, score: clamp(s), flag: flag(clamp(s)), obs };
  }

  // ── Signal 3: Friend Count & Network (10%) ───────────────────────────

  function scoreNetwork(d) {
    let s = 60;
    const obs = [];

    if (d.friendCount != null) {
      if (d.friendCount >= 100 && d.friendCount <= 2000) {
        s += 20; obs.push(`Friend count (${d.friendCount}) in natural range`);
      } else if (d.friendCount < 30) {
        s -= 20; obs.push(`Very low friend count (${d.friendCount})`);
      } else if (d.friendCount >= 4900) {
        s -= 15; obs.push(`Friend count (${d.friendCount}) near Facebook cap`);
      }
    }

    if (d.mutualFriends != null) {
      if (d.mutualFriends > 5) { s += 15; obs.push(`${d.mutualFriends} mutual friends`); }
      else if (d.mutualFriends === 0) { s -= 15; obs.push("Zero mutual friends"); }
    }

    if (d.friendsGenderSkewed) {
      s -= 15; obs.push("Friends list heavily skewed to one gender");
      if (d.friendsOppositeGender) { s -= 10; obs.push("Friends dominated by opposite gender"); }
    }
    if (d.friendsAppearFake) { s -= 25; obs.push("Many friends appear fake"); }

    if (!obs.length) obs.push("Network appears natural");
    return { name: "Friend Count & Network", num: 3, weight: 0.10, score: clamp(s), flag: flag(clamp(s)), obs };
  }

  // ── Signal 4: Post Timing Clustering (15%) — HIGH ────────────────────

  function scorePostTiming(d) {
    let s = 80;
    const obs = [];

    if (!d.postsSpreadNaturally) s -= 15;
    if (d.bulkPostsWithinHour) {
      s -= 25; obs.push("Multiple posts within a short window");
      if (d.bulkPatternRepeats) { s -= 20; obs.push("Bulk pattern repeats across days"); }
    }
    if (d.consistentExactTimes) { s -= 25; obs.push("Posts at exact same times — automation signature"); }
    if (d.silenceThenBurst) { s -= 20; obs.push("Long silence then sudden posting burst"); }
    if (d.timezoneMismatch) { s -= 15; obs.push("Posting times don't match claimed location"); }

    if (!obs.length) obs.push("Post timing looks natural and human-like");
    return { name: "Post Timing Clustering", num: 4, weight: 0.15, score: clamp(s), flag: flag(clamp(s)), obs };
  }

  // ── Signal 5: Engagement Gender Mismatch (15%) — CATFISH ─────────────

  function scoreEngagementGender(d) {
    let s = 50;
    const obs = [];

    if (d.pctSameGenderLikes != null) {
      const p = d.pctSameGenderLikes;
      if (p >= 0.40) { s += 30; obs.push(`Healthy same-gender engagement (${Math.round(p * 100)}%)`); }
      else if (p >= 0.15) { s += 10; obs.push(`Slightly skewed engagement (${Math.round(p * 100)}% same-gender)`); }
      else if (p >= 0.05) { s -= 15; obs.push(`Heavily opposite-gender skewed (${Math.round(p * 100)}% same-gender)`); }
      else { s -= 35; obs.push(`Virtually zero same-gender engagement (${Math.round(p * 100)}%)`); }
    }

    if (d.hasTaggedSameGender) { s += 15; obs.push("Tagged photos with same-gender friends"); }
    else if (d.pctSameGenderLikes != null) { s -= 10; obs.push("No tagged photos with same-gender friends"); }

    if (d.personalSameGenderComments) { s += 10; obs.push("Personal comments from same-gender friends"); }
    if (d.thirstyComments) { s -= 20; obs.push("Generic thirsty comments ('hi beautiful', 'hello dear')"); }

    if (!obs.length) obs.push("Insufficient engagement data");
    return { name: "Engagement Gender Mismatch", num: 5, weight: 0.15, score: clamp(s), flag: flag(clamp(s)), obs };
  }

  // ── Signal 6: Photo Authenticity (15%) — HIGH ────────────────────────

  function scorePhotos(d) {
    let s = 60;
    const obs = [];

    if (d.photoQualityMixed && d.hasCasualPhotos) {
      s += 20; obs.push("Mix of professional and casual photos");
    } else if (d.allProfessional) {
      s -= 20; obs.push("All photos are professional/studio quality");
    }
    if (d.suspectedAI) { s -= 40; obs.push("Photos appear AI-generated"); }

    if (d.showsProgression) { s += 10; obs.push("Photos show natural progression over time"); }
    else { s -= 15; obs.push("No visible progression across photos"); }

    if (d.hasGroupTagged) { s += 15; obs.push("Tagged in group photos by others"); }
    else { s -= 10; obs.push("No group photos tagged by others"); }

    if (d.reverseSearchMatch) { s -= 35; obs.push("Reverse image search matches other profiles — likely stolen"); }
    if (d.onlySelfies) { s -= 10; obs.push("Only selfies, no candid or event photos"); }

    if (!obs.length) obs.push("Photos appear authentic");
    return { name: "Photo Authenticity", num: 6, weight: 0.15, score: clamp(s), flag: flag(clamp(s)), obs };
  }

  // ── Signal 7: Content Pattern (10%) ──────────────────────────────────

  function scoreContent(d) {
    let s = 50;
    const obs = [];

    if (d.hasOriginalPosts) { s += 15; obs.push("Posts original text content"); }
    if (d.hasPersonalUpdates) { s += 10; obs.push("Shares personal updates"); }
    if (d.hasCheckIns) { s += 10; obs.push("Has location check-ins"); }
    if (d.hasBirthdayWishes) { s += 15; obs.push("Friends post birthday wishes"); }
    if (d.hasLifeEvents) s += 10;
    if (d.mostlyMemes) { s -= 20; obs.push("Mostly shared memes and quotes — no original content"); }
    if (d.engagementBait) { s -= 20; obs.push("Content feels like engagement bait"); }
    if (!d.languageMatchesLocation) { s -= 15; obs.push("Language inconsistent with claimed location"); }

    if (!obs.length) obs.push("Content mix looks normal");
    return { name: "Content Pattern", num: 7, weight: 0.10, score: clamp(s), flag: flag(clamp(s)), obs };
  }

  // ── Signal 8: Interaction Behavior (10%) ─────────────────────────────

  function scoreInteraction(d) {
    let s = 65;
    const obs = [];

    if (d.twoWayConversations) { s += 15; obs.push("Natural two-way conversations visible"); }
    if (d.taggedByOthers) { s += 15; obs.push("Tagged in others' posts"); }
    if (d.sendsStrangerRequests) { s -= 20; obs.push("Sends friend requests to strangers"); }
    if (d.oneDirectional) { s -= 15; obs.push("One-directional engagement pattern"); }
    if (d.manyGroups) { s -= 10; obs.push("Member of many buy/sell/dating groups"); }
    if (d.dmPivot) { s -= 20; obs.push("Quickly moves to DMs or WhatsApp"); }
    if (d.relationshipSeeking) { s -= 15; obs.push("Posts relationship-seeking content publicly"); }

    if (!obs.length) obs.push("Interaction behavior looks normal");
    return { name: "Interaction Behavior", num: 8, weight: 0.10, score: clamp(s), flag: flag(clamp(s)), obs };
  }

  // ── Signal 9: Name & Identity (5%) ───────────────────────────────────

  function scoreIdentity(d) {
    let s = 75;
    const obs = [];

    if (d.nameMatchesEthnicity) { s += 10; obs.push("Name matches apparent background"); }
    else { s -= 25; obs.push("Name doesn't match apparent ethnicity"); }
    if (d.randomNumbers) { s -= 20; obs.push("Name contains random numbers"); }
    if (d.unusualFormatting) { s -= 15; obs.push("Unusual name formatting"); }
    if (d.multipleNameChanges) { s -= 15; obs.push("Multiple name changes visible"); }
    if (!d.identityConsistent) { s -= 20; obs.push("Identity markers don't add up"); }
    if (!d.hasVanityUrl) { s -= 10; obs.push("Profile URL is random numbers, not a vanity URL"); }

    if (!obs.length) obs.push("Name and identity are consistent");
    return { name: "Name & Identity", num: 9, weight: 0.05, score: clamp(s), flag: flag(clamp(s)), obs };
  }

  // ── Scorer ───────────────────────────────────────────────────────────

  function computeScore(signals) {
    return Math.round(signals.reduce((sum, s) => sum + s.score * s.weight, 0) * 10) / 10;
  }

  function classifyVerdict(score) {
    if (score >= 90) return { verdict: "verified_real", label: "Verified Real", color: "#34d399" };
    if (score >= 70) return { verdict: "likely_real", label: "Likely Real", color: "#6ee7b7" };
    if (score >= 50) return { verdict: "suspicious", label: "Suspicious", color: "#fbbf24" };
    if (score >= 30) return { verdict: "likely_fake", label: "Likely Fake", color: "#f97316" };
    return { verdict: "almost_certainly_fake", label: "Almost Certainly Fake", color: "#ef4444" };
  }

  function checkCatfishCombo(signals) {
    const byNum = {};
    signals.forEach(s => { byNum[s.num] = s.score; });
    return (byNum[4] || 100) < 30 && (byNum[5] || 100) < 30 && (byNum[6] || 100) < 30;
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
    if (score >= 50) return { emoji: "\u26A0\uFE0F", text: "Proceed with caution — Verify identity before sharing personal info" };
    return { emoji: "\u{1F6AB}", text: "Do not engage — Strong fake indicators present" };
  }

  function getNextSteps(score, signals) {
    if (score >= 70) return [];
    const steps = [];
    const byNum = {};
    signals.forEach(s => { byNum[s.num] = s.score; });
    if ((byNum[6] || 100) < 50) steps.push("Reverse image search their profile photos (Google Images or TinEye)");
    if ((byNum[5] || 100) < 50) steps.push("Check if any same-gender friends interact — #1 catfish indicator");
    steps.push("Ask for a live video call — scammers always find excuses");
    if ((byNum[3] || 100) < 50) steps.push("Ask mutual friends if they know this person IRL");
    return steps.slice(0, 3);
  }

  // ── Main analyze function ────────────────────────────────────────────

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

    const finalScore = computeScore(signals);
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
