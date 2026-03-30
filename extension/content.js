/**
 * Content script — runs on Facebook profile pages.
 * Scrapes the DOM, runs the analyzer, and injects the verdict overlay.
 */

(() => {
  "use strict";

  let overlayVisible = false;
  let lastResult = null;
  let analyzeTimeout = null;

  // ── Build overlay HTML ───────────────────────────────────────────────

  function flagIcon(f) {
    if (f === "clean") return "\u2705";
    if (f === "yellow") return "\u26A0\uFE0F";
    return "\u{1F6A9}";
  }

  function meterColor(score) {
    if (score >= 70) return "#34d399";
    if (score >= 40) return "#fbbf24";
    return "#ef4444";
  }

  function renderOverlay(result) {
    // Remove existing
    const existing = document.getElementById("fba-overlay");
    if (existing) existing.remove();

    const panel = document.createElement("div");
    panel.id = "fba-overlay";

    const signalRows = result.signals.map(s => `
      <div class="fba-signal-row">
        <span class="fba-flag">${flagIcon(s.flag)}</span>
        <span class="fba-sig-name">${s.name}</span>
        <span class="fba-sig-score" style="color:${meterColor(s.score)}">${s.score}</span>
        <div class="fba-meter"><div class="fba-meter-fill" style="width:${s.score}%;background:${meterColor(s.score)}"></div></div>
      </div>
    `).join("");

    const evidenceRows = result.topEvidence.map(e =>
      `<li><strong>${e.signal}:</strong> ${e.text}</li>`
    ).join("");

    const stepsRows = result.nextSteps.map(s => `<li>${s}</li>`).join("");

    panel.innerHTML = `
      <div class="fba-header">
        <div class="fba-title">Profile Analyzer</div>
        <button class="fba-close" id="fba-close">\u2715</button>
      </div>

      <div class="fba-verdict-box" style="border-color:${result.color}40;background:${result.color}10">
        <div class="fba-score" style="color:${result.color}">${result.finalScore}</div>
        <div class="fba-verdict-label" style="color:${result.color}">${result.label}</div>
        ${result.catfish ? '<div class="fba-catfish-badge">\u{1F6A8} CATFISH COMBO TRIGGERED</div>' : ''}
      </div>

      <div class="fba-section">
        <div class="fba-section-title">Signal Breakdown</div>
        ${signalRows}
      </div>

      <div class="fba-section">
        <div class="fba-section-title">Key Evidence</div>
        <ul class="fba-evidence">${evidenceRows}</ul>
      </div>

      <div class="fba-section">
        <div class="fba-rec">${result.recommendation.emoji} ${result.recommendation.text}</div>
      </div>

      ${stepsRows ? `
      <div class="fba-section">
        <div class="fba-section-title">What to Check</div>
        <ul class="fba-steps">${stepsRows}</ul>
      </div>` : ''}

      <div class="fba-footer">
        <button class="fba-rescan" id="fba-rescan">Re-scan Profile</button>
        <span class="fba-branding">FB Profile Analyzer v1.0</span>
      </div>
    `;

    document.body.appendChild(panel);
    overlayVisible = true;

    // Event handlers
    document.getElementById("fba-close").addEventListener("click", () => {
      panel.classList.add("fba-hidden");
      overlayVisible = false;
    });

    document.getElementById("fba-rescan").addEventListener("click", () => {
      runAnalysis();
    });

    // Animate in
    requestAnimationFrame(() => {
      panel.classList.add("fba-visible");
    });
  }

  // ── Floating trigger button ──────────────────────────────────────────

  function injectTriggerButton() {
    if (document.getElementById("fba-trigger")) return;

    const btn = document.createElement("button");
    btn.id = "fba-trigger";
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
      <span>Scan Profile</span>
    `;
    btn.addEventListener("click", () => {
      if (overlayVisible) {
        const overlay = document.getElementById("fba-overlay");
        if (overlay) overlay.classList.toggle("fba-hidden");
        overlayVisible = !overlayVisible;
      } else {
        runAnalysis();
      }
    });

    document.body.appendChild(btn);
  }

  // ── Run analysis ─────────────────────────────────────────────────────

  function runAnalysis() {
    const profileData = FBScraper.scrapeProfile();
    if (!profileData) {
      console.log("[FBA] Not a profile page — skipping");
      return;
    }

    console.log("[FBA] Scraped profile data:", profileData);
    lastResult = FBAnalyzer.analyze(profileData);
    console.log("[FBA] Analysis result:", lastResult);
    renderOverlay(lastResult);
  }

  // ── Listen for messages from popup ───────────────────────────────────

  if (typeof chrome !== "undefined" && chrome.runtime) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.action === "analyze") {
        runAnalysis();
        sendResponse({ success: true, result: lastResult });
      } else if (msg.action === "getResult") {
        sendResponse({ result: lastResult, isProfile: FBScraper.isProfilePage() });
      }
    });
  }

  // ── Initialize ───────────────────────────────────────────────────────

  function init() {
    if (!FBScraper.isProfilePage()) return;
    injectTriggerButton();

    // Auto-analyze after a short delay (let FB render)
    analyzeTimeout = setTimeout(() => {
      runAnalysis();
    }, 2000);
  }

  // Handle Facebook's SPA navigation
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      clearTimeout(analyzeTimeout);

      // Clean up old UI
      const oldOverlay = document.getElementById("fba-overlay");
      if (oldOverlay) oldOverlay.remove();
      const oldBtn = document.getElementById("fba-trigger");
      if (oldBtn) oldBtn.remove();
      overlayVisible = false;
      lastResult = null;

      // Re-init after navigation
      setTimeout(init, 1500);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Initial run
  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init);
  }
})();
