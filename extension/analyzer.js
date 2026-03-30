/**
 * FB Profile Authenticity Analyzer v3 — Focused Dynamic Scoring
 *
 * Only 6 signals — the ones that ACTUALLY work from DOM scraping:
 *
 * 1. Profile Completeness (fields filled) — factual
 * 2. Network Strength (friends + mutuals + follower count) — factual
 * 3. Engagement Ratio (avg likes ÷ friends) — math, killer signal
 * 4. Engagement Gender (who interacts, sample-size aware) — behavioral
 * 5. Post Timing (timestamps analysis) — reliable when data exists
 * 6. Identity (URL numbers, name formatting) — factual
 *
 * REMOVED: Photo Authenticity, Content Pattern, Interaction Behavior
 * (these were guessing from unreliable DOM data, adding noise not signal)
 *
 * Principles:
 * - Missing data = neutral 70, never penalizing
 * - Dynamic weights: signals with data get more weight
 * - Engagement ratio is THE dominant fake detector
 * - 1500+ connections = positive boost
 * - Catfish combo: multiple weak red flags compound
 */

/* exported FBAnalyzer */
const FBAnalyzer = (() => {
  "use strict";

  function clamp(v) { return Math.max(0, Math.min(100, Math.round(v))); }
  function flag(s) { return s >= 70 ? "clean" : s >= 40 ? "yellow" : "red"; }

  // ── Signal 1: Profile Completeness — factual field count ─────────────

  function scoreCompleteness(d) {
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

    let s;
    if (filled >= 7) { s = 95; obs.push(`${filled} profile fields filled — very complete`); }
    else if (filled >= 6) { s = 90; obs.push(`${filled} profile fields filled — well detailed`); }
    else if (filled >= 5) { s = 80; obs.push(`${filled} profile fields filled`); }
    else if (filled >= 4) { s = 70; obs.push(`${filled} profile fields filled`); }
    else if (filled >= 3) { s = 55; obs.push(`Only ${filled} fields — thin profile`); }
    else if (filled >= 2) { s = 40; obs.push(`Only ${filled} fields — very thin`); }
    else { s = 20; obs.push("Profile is mostly empty"); }

    if (d.hasBio && !d.bioIsGeneric) s = Math.min(100, s + 5);
    if (d.hasWork && d.workIsSpecific) s = Math.min(100, s + 5);

    return { name: "Profile Completeness", num: 1, weight: 0.15, score: clamp(s), flag: flag(s), obs };
  }

  // ── Signal 2: Network Strength — factual numbers ─────────────────────

  function scoreNetwork(d) {
    let s = 65;
    const obs = [];

    if (d.friendCount != null) {
      if (d.friendCount >= 3000) { s = 95; obs.push(`${d.friendCount.toLocaleString()} connections — strong established network`); }
      else if (d.friendCount >= 1500) { s = 90; obs.push(`${d.friendCount.toLocaleString()} connections — well established`); }
      else if (d.friendCount >= 500) { s = 80; obs.push(`${d.friendCount.toLocaleString()} connections — healthy network`); }
      else if (d.friendCount >= 100) { s = 70; obs.push(`${d.friendCount.toLocaleString()} connections`); }
      else if (d.friendCount >= 30) { s = 55; obs.push(`${d.friendCount} connections — small network`); }
      else { s = 30; obs.push(`Only ${d.friendCount} connections — very small`); }

      if (d.friendCount >= 4900) { s -= 10; obs.push("Near Facebook cap — possible mass-adding"); }
    }

    if (d.mutualFriends != null) {
      if (d.mutualFriends >= 20) { s += 10; obs.push(`${d.mutualFriends} mutual friends — strong trust signal`); }
      else if (d.mutualFriends >= 5) { s += 5; obs.push(`${d.mutualFriends} mutual friends`); }
      else if (d.mutualFriends === 0) { s -= 10; obs.push("Zero mutual friends"); }
    }

    if (d.friendsGenderSkewed) {
      s -= 10;
      if (d.friendsOppositeGender) { s -= 15; obs.push("Friends heavily skewed to opposite gender"); }
    }

    if (!obs.length) obs.push("Network data not available");
    return { name: "Network Strength", num: 2, weight: 0.20, score: clamp(s), flag: flag(clamp(s)), obs };
  }

  // ── Signal 3: Engagement Ratio — likes ÷ friends — THE killer signal ─

  function scoreEngagementRatio(d) {
    if (!d || !d.ratio || d.verdict === "no_data") {
      return {
        name: "Engagement Ratio", num: 3, weight: 0.05,
        score: 70, flag: "clean",
        obs: ["Like counts not available — scored neutral"],
      };
    }

    let s, weight;
    const obs = [];

    if (d.verdict === "healthy") {
      s = 92;
      weight = 0.15;
      obs.push(`${d.ratio}% engagement rate — ${d.avgLikes} avg likes, audience is real`);
    } else if (d.verdict === "normal") {
      s = 78;
      weight = 0.15;
      obs.push(`${d.ratio}% engagement — ${d.avgLikes} avg likes, normal range`);
    } else if (d.verdict === "low") {
      s = 20;
      weight = 0.25;
      obs.push(`Only ${d.ratio}% engagement — ${d.avgLikes} avg likes vs large friend list`);
    } else {
      s = 5;
      weight = 0.30;
      obs.push(`${d.ratio}% engagement — almost nobody interacts despite ${d.avgLikes} avg likes`);
    }

    return { name: "Engagement Ratio", num: 3, weight, score: clamp(s), flag: flag(clamp(s)), obs };
  }

  // ── Signal 4: Engagement Gender — who interacts, sample-aware ────────

  function scoreEngagementGender(d, raw) {
    let s = 70;
    const obs = [];
    let weight = 0.05; // Default low weight when no data

    if (d.pctSameGenderLikes != null) {
      const eg = raw?.engagementGender;
      const knownCount = eg ? (eg.female + eg.male) : 0;
      const unknownPct = eg ? eg.unknown / eg.total : 0;

      if (knownCount < 10 || unknownPct > 0.3) {
        s = 65;
        weight = 0.05;
        obs.push(`Gender data from small sample (${knownCount} known) — low confidence`);
      } else {
        weight = 0.15;
        const pct = d.pctSameGenderLikes;
        if (pct >= 0.35) { s = 85; obs.push(`${Math.round(pct * 100)}% same-gender engagement (n=${knownCount})`); }
        else if (pct >= 0.20) { s = 60; obs.push(`Skewed: ${Math.round(pct * 100)}% same-gender (n=${knownCount})`); }
        else if (pct >= 0.08) { s = 25; obs.push(`Heavily opposite-gender: ${Math.round(pct * 100)}% same-gender (n=${knownCount})`); }
        else { s = 5; obs.push(`Almost zero same-gender engagement — classic catfish (n=${knownCount})`); }
      }
    }

    if (d.thirstyComments) { s -= 20; obs.push("Thirsty/generic comments detected"); }
    if (!obs.length) obs.push("Gender engagement data not available");

    return { name: "Engagement Gender", num: 4, weight, score: clamp(s), flag: flag(clamp(s)), obs };
  }

  // ── Signal 5: Post Timing — timestamp analysis ───────────────────────

  function scorePostTiming(d) {
    let s = 75;
    const obs = [];

    if (d.bulkPostsWithinHour) { s -= 25; obs.push("Multiple posts within 1 hour"); }
    if (d.bulkPatternRepeats) { s -= 15; obs.push("Bulk pattern repeats across days"); }
    if (d.consistentExactTimes) { s -= 25; obs.push("Posts at same times daily — automation"); }
    if (d.silenceThenBurst) { s -= 20; obs.push("Long silence then sudden post burst"); }

    if (!obs.length) obs.push("Post timing looks natural");
    return { name: "Post Timing", num: 5, weight: 0.10, score: clamp(s), flag: flag(clamp(s)), obs };
  }

  // ── Signal 6: Identity — URL, name, formatting ───────────────────────

  function scoreIdentity(d) {
    let s = 85;
    const obs = [];

    if (d.randomNumbers) { s -= 25; obs.push("Random numbers in username/URL"); }
    if (d.unusualFormatting) { s -= 15; obs.push("Unusual name formatting"); }
    if (d.multipleNameChanges) { s -= 15; obs.push("Multiple name changes"); }
    if (!d.identityConsistent) { s -= 20; obs.push("Identity markers don't add up"); }
    if (!d.hasVanityUrl) { s -= 10; obs.push("Auto-generated profile URL"); }

    if (!obs.length) obs.push("Name and identity look clean");
    return { name: "Identity", num: 6, weight: 0.15, score: clamp(s), flag: flag(clamp(s)), obs };
  }

  // ── Dynamic weighted scoring ─────────────────────────────────────────

  function computeScore(signals) {
    const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
    let score = 0;
    for (const s of signals) {
      score += s.score * (s.weight / totalWeight);
    }
    return Math.round(score * 10) / 10;
  }

  // ── Catfish combo — weak signals that compound ───────────────────────

  function catfishCombo(profileData) {
    let flags = 0;
    const reasons = [];

    if (profileData.identity?.randomNumbers) { flags++; reasons.push("Auto-generated username"); }
    if (profileData.identity && !profileData.identity.hasVanityUrl) { flags++; }

    if (profileData.engagementRatio?.verdict === "suspicious") {
      flags += 2; reasons.push("Almost no engagement vs friend count");
    } else if (profileData.engagementRatio?.verdict === "low") {
      flags++; reasons.push("Low engagement vs friend count");
    }

    if (!profileData.completeness?.hasEducation && !profileData.completeness?.hasWork) {
      flags++; reasons.push("No work or education listed");
    }

    // Penalty: 0-1 = 0, 2 = -8, 3 = -15, 4+ = -25
    let penalty = 0;
    if (flags >= 4) penalty = -25;
    else if (flags >= 3) penalty = -15;
    else if (flags >= 2) penalty = -8;

    return { penalty, flags, reasons };
  }

  // ── Verdict classification ───────────────────────────────────────────

  function classify(score) {
    if (score >= 85) return { verdict: "verified_real", label: "Verified Real", color: "#34d399" };
    if (score >= 70) return { verdict: "likely_real", label: "Likely Real", color: "#6ee7b7" };
    if (score >= 50) return { verdict: "suspicious", label: "Suspicious", color: "#fbbf24" };
    if (score >= 30) return { verdict: "likely_fake", label: "Likely Fake", color: "#f97316" };
    return { verdict: "fake", label: "Almost Certainly Fake", color: "#ef4444" };
  }

  function getEvidence(signals, n = 3) {
    const ranked = [...signals].sort((a, b) =>
      Math.abs(b.score - 70) * b.weight - Math.abs(a.score - 70) * a.weight
    );
    const out = [];
    for (const s of ranked) {
      for (const o of s.obs) {
        if (out.length >= n) return out;
        out.push({ signal: s.name, text: o });
      }
    }
    return out;
  }

  function getRecommendation(score) {
    if (score >= 70) return { emoji: "\u2705", text: "Safe to engage — Profile appears authentic" };
    if (score >= 50) return { emoji: "\u26A0\uFE0F", text: "Proceed with caution — Verify identity first" };
    return { emoji: "\u{1F6AB}", text: "Do not engage — Strong fake indicators" };
  }

  function getNextSteps(score) {
    if (score >= 70) return [];
    const steps = [
      "Ask for a live video call — scammers always avoid this",
      "Reverse image search their profile photo (Google Images / TinEye)",
      "Check who likes their posts — fake profiles get very few real interactions",
    ];
    return steps;
  }

  // ── Main analyze ─────────────────────────────────────────────────────

  function analyze(profileData) {
    const signals = [
      scoreCompleteness(profileData.completeness || {}),
      scoreNetwork(profileData.network || {}),
      scoreEngagementRatio(profileData.engagementRatio || {}),
      scoreEngagementGender(profileData.engagementGender || {}, profileData._raw || {}),
      scorePostTiming(profileData.postTiming || {}),
      scoreIdentity(profileData.identity || {}),
    ];

    let finalScore = computeScore(signals);

    // Catfish combo
    const combo = catfishCombo(profileData);
    finalScore += combo.penalty;
    if (combo.reasons.length > 0) {
      console.log("[FBA] Catfish combo:", combo.reasons, "penalty:", combo.penalty);
    }

    finalScore = Math.round(Math.max(0, Math.min(100, finalScore)) * 10) / 10;

    const catfish = signals.every(s => s.score < 30);
    const verdictInfo = catfish
      ? { verdict: "catfish", label: "CATFISH DETECTED", color: "#ef4444" }
      : classify(finalScore);

    return {
      profileName: profileData.profileName || "Unknown",
      finalScore,
      ...verdictInfo,
      catfish,
      signals,
      topEvidence: getEvidence(signals),
      recommendation: getRecommendation(finalScore),
      nextSteps: getNextSteps(finalScore),
    };
  }

  return { analyze };
})();
