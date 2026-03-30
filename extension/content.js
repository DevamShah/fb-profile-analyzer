/**
 * Content script — runs on Facebook profile pages.
 * Uses FBCollector for deep async scanning, FBAnalyzer for scoring.
 * Shows progress overlay during scan, then verdict overlay.
 */

(() => {
  "use strict";

  let overlayVisible = false;
  let lastResult = null;
  let scanning = false;

  // ── Flag/meter helpers ───────────────────────────────────────────────

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

  // ── Progress overlay ─────────────────────────────────────────────────

  function showProgress(message, pct) {
    let panel = document.getElementById("fba-overlay");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "fba-overlay";
      document.body.appendChild(panel);
      requestAnimationFrame(() => panel.classList.add("fba-visible"));
    }

    panel.innerHTML = `
      <div class="fba-header">
        <div class="fba-title">Profile Analyzer</div>
        <div style="color:#64748b;font-size:11px">Scanning...</div>
      </div>
      <div style="padding:24px 16px;text-align:center">
        <div class="fba-scanning-spinner"></div>
        <div style="margin-top:16px;font-size:13px;color:#94a3b8">${message}</div>
        <div class="fba-progress-bar">
          <div class="fba-progress-fill" style="width:${pct}%"></div>
        </div>
        <div style="margin-top:8px;font-size:11px;color:#475569">${pct}% complete</div>
      </div>
    `;
    overlayVisible = true;
  }

  // ── Verdict overlay ──────────────────────────────────────────────────

  function showVerdict(result) {
    let panel = document.getElementById("fba-overlay");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "fba-overlay";
      document.body.appendChild(panel);
    }

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

    panel.classList.add("fba-visible");
    panel.classList.remove("fba-hidden");
    overlayVisible = true;

    document.getElementById("fba-close").addEventListener("click", () => {
      panel.classList.add("fba-hidden");
      overlayVisible = false;
    });

    document.getElementById("fba-rescan").addEventListener("click", () => {
      if (!scanning) runAnalysis();
    });
  }

  // ── Trigger button ───────────────────────────────────────────────────

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
      if (scanning) return;
      if (overlayVisible) {
        const overlay = document.getElementById("fba-overlay");
        if (overlay) {
          overlay.classList.toggle("fba-hidden");
          overlayVisible = !overlayVisible;
        }
      } else {
        runAnalysis();
      }
    });

    document.body.appendChild(btn);
  }

  // ── Run deep analysis ────────────────────────────────────────────────

  async function runAnalysis() {
    if (scanning) return;
    scanning = true;

    // Update trigger button
    const btn = document.getElementById("fba-trigger");
    if (btn) {
      btn.querySelector("span").textContent = "Scanning...";
      btn.style.opacity = "0.6";
    }

    try {
      const profileData = await FBCollector.collectProfile((msg, pct) => {
        showProgress(msg, pct || 0);
      });

      if (!profileData) {
        console.log("[FBA] Not a profile page or couldn't determine name");
        const panel = document.getElementById("fba-overlay");
        if (panel) panel.remove();
        return;
      }

      lastResult = FBAnalyzer.analyze(profileData);
      console.log("[FBA] Analysis result:", lastResult);
      showVerdict(lastResult);

    } catch (err) {
      console.error("[FBA] Analysis error:", err);
    } finally {
      scanning = false;
      if (btn) {
        btn.querySelector("span").textContent = "Scan Profile";
        btn.style.opacity = "1";
      }
    }
  }

  // ── Listen for messages from popup ───────────────────────────────────

  if (typeof chrome !== "undefined" && chrome.runtime) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.action === "analyze") {
        runAnalysis().then(() => {
          sendResponse({ success: true, result: lastResult });
        });
        return true; // async response
      } else if (msg.action === "getResult") {
        const name = FBCollector.getProfileName();
        const isProfile = name !== "Unknown" && !FBCollector.NON_NAMES.has(name.toLowerCase());
        sendResponse({ result: lastResult, isProfile });
      }
    });
  }

  // ── Initialize ───────────────────────────────────────────────────────

  function isProfileUrl() {
    const path = window.location.pathname;
    const nonRoutes = [
      "watch", "groups", "events", "marketplace", "gaming",
      "search", "notifications", "messages", "settings",
      "stories", "reels", "feeds", "bookmarks", "pages",
      "friends", "photo", "videos", "hashtag", "help",
      "login", "recover", "checkpoint", "privacy", "policies",
    ];
    const segments = path.split("/").filter(Boolean);
    if (segments.length >= 1 && nonRoutes.includes(segments[0])) return false;
    if (window.location.href.includes("/profile.php")) return true;
    if (window.location.href.includes("/people/")) return true;
    if (segments.length === 1) return true;
    return false;
  }

  function init() {
    if (!isProfileUrl()) return;
    injectTriggerButton();
    // Don't auto-scan anymore — wait for user click (deep scan navigates tabs)
  }

  // Handle Facebook SPA navigation
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;

      const oldOverlay = document.getElementById("fba-overlay");
      if (oldOverlay) oldOverlay.remove();
      const oldBtn = document.getElementById("fba-trigger");
      if (oldBtn) oldBtn.remove();
      overlayVisible = false;
      lastResult = null;
      scanning = false;

      setTimeout(init, 1500);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init);
  }
})();
