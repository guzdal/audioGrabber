const extApi = globalThis.browser || globalThis.chrome;

let activeJob = null;
let captureStartedAt = 0;
let lastError = "";

function sanitizeFileName(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function getCandidateVideos() {
  return [...document.querySelectorAll("video")].filter((video) => video instanceof HTMLVideoElement);
}

function chooseBestVideo() {
  const videos = getCandidateVideos();
  if (!videos.length) {
    return null;
  }

  const playing = videos.filter((v) => !v.paused && !v.ended);
  const candidates = playing.length ? playing : videos;

  candidates.sort((a, b) => {
    const aArea = a.clientWidth * a.clientHeight;
    const bArea = b.clientWidth * b.clientHeight;
    return bArea - aArea;
  });

  return candidates[0] || null;
}

function waitForEvent(target, eventName, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let timeoutId = null;

    const cleanup = () => {
      target.removeEventListener(eventName, onEvent);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };

    const onEvent = () => {
      cleanup();
      resolve();
    };

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${eventName}.`));
    }, timeoutMs);

    target.addEventListener(eventName, onEvent, { once: true });
  });
}

function waitForLoopBoundary(video, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timeoutId = null;
    let pollId = null;
    let lastTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const nearStart = 0.25;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (pollId) {
        clearInterval(pollId);
      }
    };

    const finish = () => {
      cleanup();
      resolve();
    };

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Could not detect next loop start."));
    }, timeoutMs);

    pollId = setInterval(() => {
      const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const wrapped = current <= nearStart && lastTime > current + 0.4;
      lastTime = current;

      if (wrapped) {
        finish();
      }
    }, 100);
  });
}

function waitForSingleIterationEnd(video, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timeoutId = null;
    let pollId = null;
    let lastTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    let sawProgress = false;
    const nearTail = 0.2;
    let finished = false;

    const cleanup = () => {
      video.removeEventListener("ended", onEnded);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (pollId) {
        clearInterval(pollId);
      }
    };

    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      resolve();
    };

    const fail = (message) => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      reject(new Error(message));
    };

    const onEnded = () => finish();

    const check = () => {
      const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const duration = Number.isFinite(video.duration) ? video.duration : 0;

      if (current > 0.5) {
        sawProgress = true;
      }

      const wrapped = sawProgress && current + 0.4 < lastTime;
      const reachedTail = duration > 0 && current >= duration - nearTail;
      lastTime = current;

      if (wrapped || reachedTail) {
        finish();
      }
    };

    timeoutId = setTimeout(() => {
      fail("Timed out waiting for a full iteration to complete.");
    }, timeoutMs);

    video.addEventListener("ended", onEnded, { once: true });
    pollId = setInterval(check, 100);
  });
}

function pickMediaRecorderType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg"
  ];

  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }

  return "";
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function audioBufferToWavBlob(audioBuffer) {
  const channels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const frameCount = audioBuffer.length;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = frameCount * blockAlign;
  const wavBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wavBuffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const channelData = [];
  for (let channel = 0; channel < channels; channel += 1) {
    channelData.push(audioBuffer.getChannelData(channel));
  }

  let offset = 44;
  for (let i = 0; i < frameCount; i += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[channel][i]));
      const pcm = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, pcm, true);
      offset += 2;
    }
  }

  return new Blob([wavBuffer], { type: "audio/wav" });
}

async function transcodeBlobToWav(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioCtx) {
    throw new Error("AudioContext is not available in this browser.");
  }

  const audioContext = new AudioCtx();
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    return audioBufferToWavBlob(audioBuffer);
  } finally {
    await audioContext.close();
  }
}

function buildFileName(ext) {
  const title = sanitizeFileName(document.title || "social-audio");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${title}-${ts}.${ext}`;
}

function triggerDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function alignToStart(video) {
  if (video.readyState < 1) {
    await waitForEvent(video, "loadedmetadata", 20000);
  }

  if (video.paused || video.ended) {
    video.currentTime = 0;
    return;
  }

  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 30;
  const waitMs = Math.max(10000, Math.min(Math.ceil(duration * 1500), 120000));
  await waitForLoopBoundary(video, waitMs);
}

async function captureWholeAudioFromStart() {
  if (activeJob) {
    return { ok: false, error: "A download is already running." };
  }

  const video = chooseBestVideo();
  if (!video) {
    return { ok: false, error: "No suitable video found on this page." };
  }

  lastError = "";
  activeJob = (async () => {
    let recorder = null;
    let stream = null;
    const chunks = [];

    try {
      await alignToStart(video);

      const streamFactory = typeof video.captureStream === "function" ? video.captureStream : video.mozCaptureStream;
      if (typeof streamFactory !== "function") {
        throw new Error("This browser/page does not allow media capture on this content.");
      }

      stream = streamFactory.call(video);
      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length) {
        throw new Error("No capturable audio track was found.");
      }

      const mimeType = pickMediaRecorderType();
      recorder = mimeType
        ? new MediaRecorder(new MediaStream(audioTracks), { mimeType })
        : new MediaRecorder(new MediaStream(audioTracks));

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      captureStartedAt = Date.now();
      recorder.start(500);

      if (video.paused || video.ended) {
        await video.play();
      }

      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 30;
      const timeoutMs = Math.max(30000, Math.min(Math.ceil(duration * 1500) + 15000, 180000));
      await waitForSingleIterationEnd(video, timeoutMs);

      const finalMime = recorder.mimeType || mimeType || "audio/webm";

      await new Promise((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });

      if (!chunks.length) {
        throw new Error("Capture finished but produced no audio data.");
      }

      const blob = new Blob(chunks, { type: finalMime });
      const wavBlob = await transcodeBlobToWav(blob);
      triggerDownload(wavBlob, buildFileName("wav"));
    } finally {
      captureStartedAt = 0;
      if (stream) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
      }
      activeJob = null;
    }
  })().catch((err) => {
    lastError = err?.message || "Full capture failed.";
    console.error("Full capture failed:", err);
  });

  return {
    ok: true,
    message: "Capturing one full iteration from 0s. Download starts when it finishes."
  };
}

function status() {
  const recording = !!activeJob;
  return {
    hasVideo: !!chooseBestVideo(),
    recording,
    durationMs: recording && captureStartedAt > 0 ? Date.now() - captureStartedAt : 0,
    lastError
  };
}

extApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.action === "DIRECT_DOWNLOAD") {
      try {
        sendResponse(await captureWholeAudioFromStart());
      } catch (err) {
        sendResponse({ ok: false, error: err.message || "Full capture failed." });
      }
      return;
    }

    if (message?.action === "STATUS") {
      sendResponse(status());
      return;
    }

    sendResponse({ ok: false, error: "Unknown action." });
  })();

  return true;
});
