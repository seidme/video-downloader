import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Downloads directory & Storage Limit (2 GB max)
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const MAX_STORAGE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024; // 1 GB
const BYPASS_PASSWORD = 'leptir';

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// Helper: Calculate total storage currently used by downloads folder
function getStorageUsage() {
  try {
    const files = fs.readdirSync(DOWNLOADS_DIR);
    let totalBytes = 0;
    const details = [];
    for (const file of files) {
      const fullPath = path.join(DOWNLOADS_DIR, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          totalBytes += stat.size;
          details.push({ file, fullPath, size: stat.size, mtimeMs: stat.mtimeMs });
        }
      } catch (statErr) {}
    }
    return { totalBytes, details };
  } catch (err) {
    return { totalBytes: 0, details: [] };
  }
}

// Helper: Enforce 2 GB volume limit by purging oldest files if needed
function ensureStorageQuota(headroomBytes = 50 * 1024 * 1024) {
  try {
    let { totalBytes, details } = getStorageUsage();
    if (totalBytes + headroomBytes <= MAX_STORAGE_BYTES) {
      return { ok: true, totalBytes };
    }

    // Sort files by mtime ascending (oldest first)
    details.sort((a, b) => a.mtimeMs - b.mtimeMs);

    // Active jobs file set to prevent deleting active downloads
    const activePaths = new Set();
    for (const job of jobs.values()) {
      if (job.targetFilePath) activePaths.add(job.targetFilePath);
      if (job.filePath) activePaths.add(job.filePath);
    }

    let purgedBytes = 0;
    for (const item of details) {
      if (totalBytes + headroomBytes <= MAX_STORAGE_BYTES) break;
      if (activePaths.has(item.fullPath)) continue;

      try {
        fs.unlinkSync(item.fullPath);
        totalBytes -= item.size;
        purgedBytes += item.size;
        console.log(`🧹 Storage quota: purged oldest file "${item.file}" (${(item.size / (1024 * 1024)).toFixed(1)} MB)`);
      } catch (delErr) {
        console.error(`Failed to delete ${item.file}:`, delErr);
      }
    }

    const ok = (totalBytes + headroomBytes) <= MAX_STORAGE_BYTES;
    return { ok, totalBytes, purgedBytes };
  } catch (err) {
    console.error('Storage quota check error:', err);
    return { ok: true, totalBytes: 0, purgedBytes: 0 };
  }
}

// Active download jobs in-memory store
const jobs = new Map();

// Helper: Find binary paths
function getBinPath(binName) {
  const customPaths = [
    `/opt/homebrew/bin/${binName}`,
    `/usr/local/bin/${binName}`,
    `/usr/bin/${binName}`,
    binName
  ];
  for (const p of customPaths) {
    if (p.includes('/') && fs.existsSync(p)) {
      return p;
    }
  }
  return binName;
}

const YTDLP_BIN = getBinPath('yt-dlp');
const FFMPEG_BIN = getBinPath('ffmpeg');

// Format seconds into MM:SS or HH:MM:SS
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return 'Live / Unknown';
  const sec = Math.floor(seconds);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Format numbers (views, likes)
function formatCount(num) {
  if (!num || isNaN(num)) return null;
  return new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short' }).format(num);
}

// Sanitize filename for safe file system and download headers
function sanitizeFilename(name) {
  return (name || 'video')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 150);
}

// URL Short Hash helper: compact 6-char hex hash
function getUrlHash(url) {
  if (!url) return '';
  return crypto.createHash('md5').update(url.trim()).digest('hex').substring(0, 6);
}



// GET /api/health - Check engine status & storage health
app.get('/api/health', (req, res) => {
  const ytProc = spawn(YTDLP_BIN, ['--version']);
  let ytVer = '';
  ytProc.stdout.on('data', d => ytVer += d.toString());
  ytProc.on('close', code => {
    const { totalBytes } = getStorageUsage();
    res.json({
      status: code === 0 ? 'online' : 'error',
      ytdlp: code === 0 ? ytVer.trim() : 'missing',
      ffmpegLocation: FFMPEG_BIN,
      activeJobs: jobs.size,
      storage: {
        usedBytes: totalBytes,
        usedMB: (totalBytes / (1024 * 1024)).toFixed(2),
        maxBytes: MAX_STORAGE_BYTES,
        maxGB: (MAX_STORAGE_BYTES / (1024 * 1024 * 1024)).toFixed(1),
        usagePercent: ((totalBytes / MAX_STORAGE_BYTES) * 100).toFixed(1)
      }
    });
  });
  ytProc.on('error', err => {
    res.json({ status: 'error', error: err.message });
  });
});

// POST /api/bypass/verify - Verify bypass password on backend
app.post('/api/bypass/verify', (req, res) => {
  const { password } = req.body || {};
  if (password === BYPASS_PASSWORD) {
    return res.json({ valid: true, message: 'Password verified.' });
  }
  return res.status(401).json({ valid: false, error: 'Incorrect password. Hint: slija' });
});

// POST /api/info - Fetch metadata for any video URL
app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'A valid URL is required.' });
  }

  const trimmedUrl = url.trim();

  // Execute yt-dlp to inspect video
  const args = [
    '--dump-single-json',
    '--no-warnings',
    '--no-playlist',
    trimmedUrl
  ];

  const env = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` };
  const child = spawn(YTDLP_BIN, args, { env });

  const infoTimeout = setTimeout(() => { child.kill(); }, 30 * 1000);

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', chunk => stdout += chunk);
  child.stderr.on('data', chunk => stderr += chunk);

  child.on('close', code => {
    clearTimeout(infoTimeout);

    if (code !== 0) {
      console.error('yt-dlp error:', stderr);
      let message = 'Failed to extract video information from this URL.';
      if (stderr.includes('Video unavailable') || stderr.includes('Private video')) {
        message = 'This video is private, removed, or unavailable.';
      } else if (stderr.includes('Sign in to confirm')) {
        message = 'This video requires login / bot verification.';
      } else if (stderr.includes('Unsupported URL')) {
        message = 'URL is not supported or does not contain recognizable media.';
      }
      return res.status(400).json({ error: message, details: stderr.trim() });
    }

    try {
      const data = JSON.parse(stdout);

      // Determine platform
      let platform = data.extractor_key || data.extractor || 'Web Video';
      if (/youtube/i.test(platform)) platform = 'YouTube';
      else if (/tiktok/i.test(platform)) platform = 'TikTok';
      else if (/twitter|x\.com/i.test(platform)) platform = 'Twitter/X';
      else if (/instagram/i.test(platform)) platform = 'Instagram';
      else if (/reddit/i.test(platform)) platform = 'Reddit';
      else if (/vimeo/i.test(platform)) platform = 'Vimeo';
      else if (/facebook/i.test(platform)) platform = 'Facebook';

      // Pick best thumbnail
      let thumbnail = data.thumbnail;
      if (Array.isArray(data.thumbnails) && data.thumbnails.length > 0) {
        // Find highest resolution thumbnail if available
        const sorted = [...data.thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
        thumbnail = sorted[0].url || thumbnail;
      }

      // Filter available formats
      const formats = data.formats || [];
      const has1080 = formats.some(f => f.height && f.height >= 1080);
      const has720 = formats.some(f => f.height && f.height >= 720);
      const has480 = formats.some(f => f.height && f.height >= 480);
      const has360 = formats.some(f => f.height && f.height >= 360);

      const availableVideoQualities = [
        { id: 'best', label: 'Best Quality (Auto)', res: 'Original / Max' }
      ];
      if (has1080) availableVideoQualities.push({ id: '1080p', label: '1080p Full HD', res: '1080p' });
      if (has720) availableVideoQualities.push({ id: '720p', label: '720p HD', res: '720p' });
      if (has480) availableVideoQualities.push({ id: '480p', label: '480p SD', res: '480p' });
      if (has360) availableVideoQualities.push({ id: '360p', label: '360p', res: '360p' });

      const availableAudioQualities = [
        { id: '320k', label: 'MP3 - High (320 kbps)', ext: 'mp3' },
        { id: '192k', label: 'MP3 - Standard (192 kbps)', ext: 'mp3' },
        { id: 'm4a', label: 'M4A - AAC Audio', ext: 'm4a' }
      ];

      // Check if download for this URL is currently in progress
      let activeJobId = null;
      const incomingHash = getUrlHash(trimmedUrl);
      for (const [id, activeJob] of jobs.entries()) {
        const jobHash = getUrlHash(activeJob.url);
        if ((activeJob.url === trimmedUrl || (jobHash && jobHash === incomingHash)) && 
            (activeJob.status === 'downloading' || activeJob.status === 'processing')) {
          activeJobId = activeJob.jobId;
          break;
        }
      }

      res.json({
        id: data.id,
        title: data.title || 'Untitled Media',
        platform,
        uploader: data.uploader || data.channel || 'Unknown Creator',
        uploaderUrl: data.uploader_url || data.channel_url || null,
        duration: data.duration,
        durationFormatted: formatDuration(data.duration),
        filesize: data.filesize || data.filesize_approx || null,
        isSizeRestricted: !!((data.filesize && data.filesize > MAX_FILE_SIZE_BYTES) || (data.filesize_approx && data.filesize_approx > MAX_FILE_SIZE_BYTES)),
        views: formatCount(data.view_count),
        likes: formatCount(data.like_count),
        thumbnail,
        webpageUrl: data.webpage_url || trimmedUrl,
        videoQualities: availableVideoQualities,
        audioQualities: availableAudioQualities,
        isDownloading: !!activeJobId,
        activeJobId
      });
    } catch (parseErr) {
      console.error('Failed to parse metadata JSON:', parseErr);
      res.status(500).json({ error: 'Failed to parse video metadata.' });
    }
  });

  child.on('error', err => {
    clearTimeout(infoTimeout);
    res.status(500).json({ error: `Engine error: ${err.message}` });
  });
});

// POST /api/download/start - Initiate asynchronous download
app.post('/api/download/start', (req, res) => {
  const { url, type, quality, title, duration, bypassPassword } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required.' });
  }

  const isVideo = type !== 'audio';
  const durationOver1h = typeof duration === 'number' && duration > 3600;
  const isBypassed = bypassPassword === 'leptir';

  if (isVideo && durationOver1h && !isBypassed) {
    return res.status(403).json({
      error: 'Videos longer than 1 hour require bypass password (Hint: slija).',
      restricted: true,
      hint: 'slija'
    });
  }

  const safeTitle = sanitizeFilename(title);
  const ext = type === 'audio' ? (quality === 'm4a' ? 'm4a' : 'mp3') : 'mp4';
  const urlHash = getUrlHash(url);
  const qTag = quality || (type === 'audio' ? '320k' : 'best');
  const targetFilename = `${safeTitle} [${qTag}] [${urlHash}].${ext}`;
  const targetFilePath = path.join(DOWNLOADS_DIR, targetFilename);

  // 1. Check if a download for this exact file is ALREADY IN PROGRESS
  for (const [id, activeJob] of jobs.entries()) {
    if (activeJob.targetFilePath === targetFilePath &&
        (activeJob.status === 'downloading' || activeJob.status === 'processing')) {
      console.log(`⏳ Download already in progress for: "${targetFilename}" (attaching to job ${activeJob.jobId})`);
      return res.json({
        jobId: activeJob.jobId,
        inProgress: true,
        message: 'Download is already in progress, attaching to current job.'
      });
    }
  }

  // 2. If finished file already exists on disk, offer to save immediately!
  if (fs.existsSync(targetFilePath)) {
    const existingJobId = crypto.randomUUID();
    jobs.set(existingJobId, {
      jobId: existingJobId,
      url,
      targetFilePath,
      targetFilename,
      filePath: targetFilePath,
      downloadFilename: targetFilename,
      status: 'completed',
      percent: 100
    });
    console.log(`⚡ Already downloaded file requested, offering immediate save: "${targetFilename}"`);
    return res.json({
      jobId: existingJobId,
      cached: true,
      fileReady: true,
      downloadFilename: targetFilename,
      downloadUrl: `/api/download/file/${existingJobId}`,
      message: 'File already downloaded! Ready to save.'
    });
  }

  // 3. Otherwise, start fresh download
  const quota = ensureStorageQuota();
  if (!quota.ok) {
    return res.status(507).json({
      error: 'Storage limit reached (2 GB max). Please try again shortly.'
    });
  }

  const jobId = crypto.randomUUID();
  const outputTemplate = path.join(DOWNLOADS_DIR, `${safeTitle} [${qTag}] [${urlHash}].%(ext)s`);

  // Build yt-dlp arguments
  const args = [
    '--no-playlist',
    '--newline',
    '--progress-template',
    'PROGRESS:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.total_bytes_estimate_str)s',
    '--ffmpeg-location', FFMPEG_BIN,
    '-o', outputTemplate
  ];

  if (type === 'audio') {
    args.push('-x');
    if (quality === 'm4a') {
      args.push('--audio-format', 'm4a');
    } else {
      args.push('--audio-format', 'mp3');
      const bitrate = quality === '192k' ? '192k' : '320k';
      args.push('--audio-quality', bitrate);
    }
  } else {
    // Video
    let formatFilter = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
    const height = parseInt(quality, 10);
    if (height && !isNaN(height)) {
      formatFilter = `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${height}][ext=mp4]/best`;
    }
    args.push('-f', formatFilter);
    args.push('--merge-output-format', 'mp4');
  }

  // Unless bypassed with password, enforce 1 GB (1024M) max file size
  if (!isBypassed) {
    args.push('--max-filesize', '1024M');
  }

  args.push(url.trim());

  const job = {
    jobId,
    url,
    targetFilePath,
    targetFilename,
    type,
    quality: qTag,
    safeTitle,
    targetExt: ext,
    status: 'downloading',
    percent: 0,
    speed: '0 KiB/s',
    eta: '--:--',
    totalSize: 'Calculating...',
    filePath: null,
    downloadFilename: targetFilename,
    error: null,
    createdAt: Date.now()
  };

  jobs.set(jobId, job);

  const env = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` };
  const child = spawn(YTDLP_BIN, args, { env });
  job.process = child;

  const resetWatchdog = () => {
    if (job.watchdog) clearTimeout(job.watchdog);
    job.watchdog = setTimeout(() => {
      child.kill();
      job.status = 'error';
      job.error = 'Download stalled — no progress for 120 seconds.';
    }, 120 * 1000);
  };
  resetWatchdog();

  let fullStderr = '';

  child.stdout.on('data', chunk => {
    resetWatchdog();

    const text = chunk.toString();
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.startsWith('PROGRESS:')) {
        const parts = line.replace('PROGRESS:', '').split('|');
        if (parts.length >= 3) {
          const rawPercent = parts[0].trim().replace('%', '');
          const pct = parseFloat(rawPercent);
          if (!isNaN(pct)) job.percent = Math.min(100, Math.max(0, pct));
          if (parts[1]?.trim()) job.speed = parts[1].trim();
          if (parts[2]?.trim()) job.eta = parts[2].trim();
          if (parts[3]?.trim() && parts[3].trim() !== 'NA') job.totalSize = parts[3].trim();
        }
      } else if (line.includes('[Merger]') || line.includes('[ExtractAudio]')) {
        job.status = 'processing';
      }
    }
  });

  child.stderr.on('data', chunk => {
    fullStderr += chunk.toString();
  });

  child.on('close', code => {
    if (job.watchdog) clearTimeout(job.watchdog);
    job.process = null;

    if (job.status === 'cancelled') {
      console.log(`🛑 Download cancelled by user: "${targetFilename}"`);
      // Clean up partial/temporary files for this exact file
      try {
        if (fs.existsSync(targetFilePath)) fs.unlinkSync(targetFilePath);
        const partFile = `${targetFilePath}.part`;
        const ytdlFile = `${targetFilePath}.ytdl`;
        if (fs.existsSync(partFile)) fs.unlinkSync(partFile);
        if (fs.existsSync(ytdlFile)) fs.unlinkSync(ytdlFile);

        // Also check if yt-dlp created intermediate audio/video parts with targetFilename prefix
        const files = fs.readdirSync(DOWNLOADS_DIR);
        for (const file of files) {
          if (file.startsWith(targetFilename) || file.startsWith(`${safeTitle} [${qTag}] [${urlHash}]`)) {
            const fullPath = path.join(DOWNLOADS_DIR, file);
            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
          }
        }
      } catch (cleanupErr) {
        console.error('Error cleaning up cancelled files:', cleanupErr);
      }
      return;
    }

    if (code === 0 && fs.existsSync(targetFilePath)) {
      job.filePath = targetFilePath;
      job.downloadFilename = targetFilename;
      job.status = 'completed';
      job.percent = 100;
      console.log(`✅ Download complete: "${targetFilename}"`);
    } else {
      job.status = 'error';
      if (fullStderr.includes('larger than max-filesize') || fullStderr.includes('max-filesize')) {
        job.error = 'File exceeds 1 GB limit. Enter bypass password to download (Hint: slija).';
      } else {
        job.error = fullStderr.trim() || 'Downloaded file not found on disk.';
      }
    }
  });

  child.on('error', err => {
    if (job.watchdog) clearTimeout(job.watchdog);
    job.process = null;
    if (job.status !== 'cancelled') {
      job.status = 'error';
      job.error = err.message;
    }
  });

  res.json({ jobId });
});

// GET /api/download/progress/:jobId - Poll status of download
app.get('/api/download/progress/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Download job not found.' });
  }

  res.json({
    jobId: job.jobId,
    status: job.status,
    percent: job.percent,
    speed: job.speed,
    eta: job.eta,
    totalSize: job.totalSize,
    downloadFilename: job.downloadFilename,
    error: job.error,
    fileReady: job.status === 'completed'
  });
});

// POST /api/download/cancel/:jobId - Cancel an active download
app.post('/api/download/cancel/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Download job not found.' });
  }

  if (job.status === 'completed') {
    return res.status(400).json({ error: 'Download has already completed.' });
  }

  if (job.status === 'cancelled') {
    return res.json({ success: true, message: 'Download already cancelled.' });
  }

  job.status = 'cancelled';
  if (job.watchdog) {
    clearTimeout(job.watchdog);
    job.watchdog = null;
  }

  if (job.process) {
    job.process.kill();
    job.process = null;
  }

  // Clean up partial files immediately if any
  try {
    if (job.targetFilePath && fs.existsSync(job.targetFilePath)) {
      fs.unlinkSync(job.targetFilePath);
    }
    const partFile = `${job.targetFilePath}.part`;
    const ytdlFile = `${job.targetFilePath}.ytdl`;
    if (fs.existsSync(partFile)) fs.unlinkSync(partFile);
    if (fs.existsSync(ytdlFile)) fs.unlinkSync(ytdlFile);

    if (job.targetFilename) {
      const basePrefix = `${job.safeTitle} [${job.quality}] [${getUrlHash(job.url)}]`;
      const files = fs.readdirSync(DOWNLOADS_DIR);
      for (const file of files) {
        if (file.startsWith(job.targetFilename) || file.startsWith(basePrefix)) {
          const fullPath = path.join(DOWNLOADS_DIR, file);
          if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        }
      }
    }
  } catch (err) {
    console.error('Error cleaning up files on cancel:', err);
  }

  res.json({ success: true, message: 'Download cancelled successfully.' });
});

// GET /api/download/file/:jobId - Stream completed download file
app.get('/api/download/file/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  if (!job || !job.filePath || !fs.existsSync(job.filePath)) {
    return res.status(404).json({ error: 'File is not ready or has expired.' });
  }

  res.download(job.filePath, job.downloadFilename, (err) => {
    if (err) {
      console.error('Download transfer error:', err);
    }
  });
});

// Periodic cleanup of downloads older than 60 minutes (runs every 5 minutes)
const PURGE_MAX_AGE_MS = 60 * 60 * 1000; // 60 minutes

setInterval(() => {
  try {
    const now = Date.now();
    const files = fs.readdirSync(DOWNLOADS_DIR);
    let purgedCount = 0;

    for (const file of files) {
      const fullPath = path.join(DOWNLOADS_DIR, file);
      const stat = fs.statSync(fullPath);
      if (now - stat.mtimeMs > PURGE_MAX_AGE_MS) {
        fs.unlinkSync(fullPath);
        purgedCount++;
      }
    }

    if (purgedCount > 0) {
      console.log(`🧹 Purged ${purgedCount} download file(s) older than 60 minutes.`);
    }

    // Clean old jobs from memory map
    for (const [id, job] of jobs.entries()) {
      if (now - job.createdAt > PURGE_MAX_AGE_MS) {
        jobs.delete(id);
      }
    }

    // Enforce 2 GB volume quota if needed
    ensureStorageQuota(0);
  } catch (e) {
    console.error('Cleanup error:', e);
  }
}, 5 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Video Downloader server running!`);
  console.log(`🌐 Open in browser: http://localhost:${PORT}`);
  console.log(`⚙️  yt-dlp: ${YTDLP_BIN}`);
  console.log(`⚙️  ffmpeg: ${FFMPEG_BIN}`);
  console.log(`====================================================`);
});

// Graceful shutdown: kill active downloads on exit
function gracefulShutdown() {
  console.log('\n🛑 Shutting down — killing active downloads...');
  for (const [id, job] of jobs.entries()) {
    if (job.process) {
      job.process.kill();
      job.process = null;
    }
  }
  process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
