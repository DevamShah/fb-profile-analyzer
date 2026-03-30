document.addEventListener("DOMContentLoaded", () => {
  const statusEl = document.getElementById("status");
  const btnEl = document.getElementById("analyzeBtn");
  const resultEl = document.getElementById("result");

  // Check if we're on a Facebook profile page
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url || !tab.url.includes("facebook.com")) {
      statusEl.className = "status off";
      statusEl.textContent = "Not on Facebook — navigate to a profile page";
      return;
    }

    // Ask content script if this is a profile page and if there's a result
    chrome.tabs.sendMessage(tab.id, { action: "getResult" }, (response) => {
      if (chrome.runtime.lastError || !response) {
        statusEl.className = "status warn";
        statusEl.textContent = "Extension loading... refresh the page";
        return;
      }

      if (!response.isProfile) {
        statusEl.className = "status warn";
        statusEl.textContent = "Navigate to a Facebook profile page";
        return;
      }

      statusEl.className = "status ok";
      statusEl.textContent = "On profile page — ready to scan";
      btnEl.disabled = false;

      if (response.result) {
        showMiniResult(response.result);
      }
    });
  });

  // Analyze button
  btnEl.addEventListener("click", () => {
    btnEl.disabled = true;
    btnEl.textContent = "Scanning...";

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: "analyze" }, (response) => {
        btnEl.disabled = false;
        btnEl.textContent = "Scan This Profile";

        if (response && response.result) {
          showMiniResult(response.result);
        }
      });
    });
  });

  function showMiniResult(result) {
    resultEl.style.display = "block";
    resultEl.innerHTML = `
      <div class="score-line">
        <span class="score-val" style="color:${result.color}">${result.finalScore}</span>
        <span class="verdict-text" style="color:${result.color}">${result.label}</span>
      </div>
      <div class="rec">${result.recommendation.emoji} ${result.recommendation.text}</div>
    `;
  }
});
