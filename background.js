const extApi = globalThis.browser || globalThis.chrome;

extApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.action !== "DOWNLOAD_URL") {
      return;
    }

    try {
      const id = await extApi.downloads.download({
        url: message.url,
        filename: message.fileName,
        saveAs: false,
        conflictAction: "uniquify"
      });

      sendResponse({ ok: true, downloadId: id });
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || "Download failed." });
    }
  })();

  return true;
});
