const statusEl = document.getElementById("status");
const oneShotBtn = document.getElementById("oneShotBtn");
const extApi = globalThis.browser || globalThis.chrome;

async function getActiveTabId() {
  const [tab] = await extApi.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function sendToTab(payload) {
  const tabId = await getActiveTabId();
  if (!tabId) {
    throw new Error("No active tab found.");
  }
  return extApi.tabs.sendMessage(tabId, payload);
}

async function refreshStatus() {
  try {
    const response = await sendToTab({ action: "STATUS" });
    if (response?.recording) {
      const seconds = Math.max(1, Math.round((response.durationMs || 0) / 1000));
      statusEl.textContent = `Capturing full audio from 0s (${seconds}s). WAV download starts automatically when complete.`;
      oneShotBtn.disabled = true;
    } else if (response?.lastError) {
      statusEl.textContent = `Last attempt failed: ${response.lastError}`;
      oneShotBtn.disabled = false;
    } else if (response?.hasVideo) {
      statusEl.textContent = "Ready. One click captures full audio from beginning in background.";
      oneShotBtn.disabled = false;
    } else {
      statusEl.textContent = "No playable video detected on this page.";
      oneShotBtn.disabled = false;
    }
  } catch (_err) {
    statusEl.textContent = "Cannot run on this page (browser internal pages are restricted).";
    oneShotBtn.disabled = true;
  }
}

oneShotBtn.addEventListener("click", async () => {
  oneShotBtn.disabled = true;
  statusEl.textContent = "Starting full-from-beginning WAV capture...";

  try {
    const response = await sendToTab({ action: "DIRECT_DOWNLOAD" });
    if (!response?.ok) {
      throw new Error(response?.error || "Could not download media URL.");
    }
    statusEl.textContent = response.message || "Download started.";
  } catch (err) {
    statusEl.textContent = err.message;
  } finally {
    oneShotBtn.disabled = false;
  }
});

refreshStatus();
setInterval(refreshStatus, 1000);
