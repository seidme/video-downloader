# 🎬 Video Downloader — Universal Video & Audio Downloader

A modern, high-performance web application and CLI to download video and audio from **YouTube, TikTok, Twitter/X, Instagram, Vimeo, Reddit, Twitch, and 1,800+ other platforms** in highest available quality (up to 4K / 1080p Full HD) or convert straight to MP3 audio.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](<https://img.shields.io/badge/node-%3E%3D20.0.0-green.svg>)
![yt--dlp](https://img.shields.io/badge/engine-yt--dlp-purple.svg)
![ffmpeg](https://img.shields.io/badge/muxing-ffmpeg-red.svg)

---

## ✨ Features

- 🌐 **Universal Recognition**: Works with any URL from YouTube, TikTok, Instagram, Twitter/X, Reddit, Vimeo, Facebook, Bilibili, and generic web streams (.mp4, .m3u8, HLS).
- 💎 **High Resolution**: Downloads up to 4K, 1440p, 1080p, 720p, 480p, and 360p with synchronized audio.
- 🎵 **Crystal Clear Audio**: Converts any video to high-bitrate MP3 (320kbps / 192kbps) or AAC/M4A with one click.
- ⚡ **Sleek Browser UI**: Modern dark-mode interface with glassmorphic cards, instant thumbnail previews, metadata inspection, and real-time download progress tracking (speed, ETA, and percentage).
- 💻 **Standalone CLI Mode**: Command-line support for rapid terminal workflows (`node cli.js "<url>"`).
- 🧹 **Automatic Storage Management**: Temp downloads automatically pruned after 60 minutes.
- 🛡️ **Zero Third-Party Ads or Popups**: Direct, private, and local execution on your machine.

---


## 🚀 Quick Start (Browser App)

1. **Clone the repository**:

   ```bash
   git clone git@github.com:seidme/video-downloader.git
   cd video-downloader
   ```
2. **Install dependencies**:

   ```bash
   npm install
   ```
3. **Start the local server**:

   ```bash
   npm start
   ```
4. **Open in your browser**:

   ```
   http://localhost:3000
   ```

---

## 💻 CLI Usage

You can also download videos directly from your terminal:

```bash
# Basic video download (best available quality)
node cli.js "https://www.youtube.com/watch?v=..."

# Download in 1080p Full HD
node cli.js "https://www.youtube.com/watch?v=..." --quality 1080

# Convert directly to MP3 audio
node cli.js "https://www.youtube.com/watch?v=..." --audio

# Download TikTok, Twitter/X, or Instagram video
node cli.js "https://www.tiktok.com/@user/video/..."
node cli.js "https://twitter.com/user/status/..."

# Custom output destination
node cli.js "https://..." -o ~/Movies
```

---

## 🔌 API Endpoints

- `GET /api/health` — Verifies engine readiness and returns yt-dlp & ffmpeg version information.
- `POST /api/info` — Inspects any media URL and returns title, author, duration, thumbnail, and available resolutions.
- `POST /api/download/start` — Spawns background download job and streams real-time progress.
- `GET /api/download/progress/:jobId` — Returns real-time percent, speed, ETA, and completion status.
- `GET /api/download/file/:jobId` — Streams the finished file directly into the browser with proper `Content-Disposition`.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
