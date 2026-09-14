# Video Downloader — Chrome Extension

A clean, 1-click companion extension for your self-hosted Video Downloader.

## Features

- **1-Click Download**: Automatically detects the video on the current active browser tab (YouTube, Reddit, Instagram, Twitter/X, TikTok, Vimeo, and more).
- **Default 320 kbps Audio**: Defaults directly to high-quality 320 kbps MP3, with instant toggle to MP4 Video.
- **YouTube Session / Visitor Token Extraction**: Transparently reads `VISITOR_DATA` from your active browser tab and forwards it to your downloader server to satisfy YouTube bot verification checks.
- **Built-in Progress Tracking**: Live download progress bar, speed, and ETA right in the popup.
- **Auto Browser Download**: Seamlessly triggers the completed file download directly into your Chrome Downloads folder.
- **Custom Server & Password**: Configure your server URL (`https://video.codeeve.com` or `http://localhost:3000`) and bypass password in Settings.

---

## How to Install in Chrome (Takes 15 Seconds)

1. Open Google Chrome (or Brave / Edge / Chromium).
2. Go to:
   ```
   chrome://extensions/
   ```
3. In the top-right corner, toggle **Developer mode** to **ON**.
4. In the top-left corner, click **Load unpacked**.
5. Select this folder:
   ```
   /Users/seidme/_dev/PP/video-downloader/chrome-extension
   ```
6. Click the puzzle icon 🧩 in the Chrome toolbar and click the **Pin 📌** icon next to **Video Downloader**.

---

## How to Use

1. Navigate to any video on **YouTube**, **Twitter**, **Reddit**, **Instagram**, or any web page.
2. Click the **Video Downloader** icon in your toolbar.
3. Choose **Audio** (MP3 320k) or **Video** (MP4).
4. Click **Download**! The server processes the media and Chrome saves the file directly to your computer.

---

## Settings

Click the **Gear ⚙️** icon in the popup header to configure:
- **Downloader Server URL**: `https://video.codeeve.com` (default) or `http://localhost:3000` for local runs.
- **Bypass Password**: Your server bypass password (Hint: `slija`).
- **Auto-pass real session / visitor token on YouTube**: Enabled by default to bypass bot checks.
