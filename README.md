# Social Audio Downloader (Chrome/Firefox)

Tiny browser extension to capture audio for one full iteration of the current short/reel/video and download it as WAV (Ableton-friendly).

## What it does
- WORKS WITH .WAV!!!
- Detects the best candidate `<video>` element on the page.
- Aligns capture to iteration start (`0s`):
  - if paused/stopped: seeks to `0s` and starts,
  - if already looping: waits for the next natural loop start.
- Records one full iteration from start to end.
- Converts capture to `.wav` and downloads automatically.

## Important notes

- Capture is real-time (a 45s video takes about 45s to capture).
- Output is always WAV for DAW compatibility.
- Some DRM-protected content may block browser-side capture.

## Install (Chrome/Chromium)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the whole folder

## Install (Firefox)🦊

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select file in the whole folder:
   - repo/manifest.json`

## Usage

1. Open a reel/short/video page.
2. Click the extension icon.
3. Click **Download full audio (WAV)**.
4. Wait for one full iteration to finish.
5. WAV download starts automatically.
