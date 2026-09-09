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

// Downloads directory
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
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

// URL Hash in filename helper: appends a compact 8-char hash to the filename on disk
function getUrlHash(url) {
  if (!url) return '';
  return crypto.createHash('md5').update(url.trim()).digest('hex').substring(0, 8);
}

function getExistingDownload(url, type = null) {
  if (!url) return null;
  const hash = getUrlHash(url);
  const token = `__[${hash}].`;

  try {
    const files = fs.readdirSync(DOWNLOADS_DIR);
    let match = null;
    if (type === 'audio') {
      match = files.find(f => f.includes(token) && (f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.wav')));
    } else if (type === 'video') {
      match = files.find(f => f.includes(token) && (f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mkv')));
    } else {
      match = files.find(f => f.includes(token));
    }

    if (!match) return null;

    const filePath = path.join(DOWNLOADS_DIR, match);
    const cleanFilename = match.replace(token, '.');

    // Reuse existing in-memory job or create a transient one
    let existingJobId = null;
    for (const [id, job] of jobs.entries()) {
      if (job.filePath === filePath) {
        existingJobId = id;
        break;
      }
    }

    if (!existingJobId) {
      existingJobId = crypto.randomUUID();
      jobs.set(existingJobId, {
        jobId: existingJobId,
        url: url.trim(),
        safeTitle: cleanFilename.substring(0, cleanFilename.lastIndexOf('.')) || 'media',
        filePath,
        downloadFilename: cleanFilename,
        status: 'completed',
        percent: 100,
        fileReady: true,
        cached: true,
        createdAt: Date.now()
      });
    }

    return {
      jobId: existingJobId,
      url: url.trim(),
      filePath,
      downloadFilename: cleanFilename
    };
  } catch (e) {
    return null;
  }
}

// GET /api/health - Check engine status
app.get('/api/health', (req, res) => {
  const ytProc = spawn(YTDLP_BIN, ['--version']);
  let ytVer = '';
  ytProc.stdout.on('data', d => ytVer += d.toString());
  ytProc.on('close', code => {
    res.json({
      status: code === 0 ? 'online' : 'error',
      ytdlp: code === 0 ? ytVer.trim() : 'missing',
      ffmpegLocation: FFMPEG_BIN,
      activeJobs: jobs.size
    });
  });
  ytProc.on('error', err => {
    res.json({ status: 'error', error: err.message });
  });
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

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', chunk => stdout += chunk);
  child.stderr.on('data', chunk => stderr += chunk);

  child.on('close', code => {
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
      if (has1080) availableVideoQualities.push({ id: '1080', label: '1080p Full HD', res: '1080p' });
      if (has720) availableVideoQualities.push({ id: '720', label: '720p HD', res: '720p' });
      if (has480) availableVideoQualities.push({ id: '480', label: '480p SD', res: '480p' });
      if (has360) availableVideoQualities.push({ id: '360', label: '360p', res: '360p' });

      const availableAudioQualities = [
        { id: 'mp3_320', label: 'MP3 - High (320 kbps)', ext: 'mp3' },
        { id: 'mp3_192', label: 'MP3 - Standard (192 kbps)', ext: 'mp3' },
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

      // Check if this exact URL was already downloaded
      const existing = getExistingDownload(trimmedUrl);

      res.json({
        id: data.id,
        title: data.title || 'Untitled Media',
        platform,
        uploader: data.uploader || data.channel || 'Unknown Creator',
        uploaderUrl: data.uploader_url || data.channel_url || null,
        duration: data.duration,
        durationFormatted: formatDuration(data.duration),
        views: formatCount(data.view_count),
        likes: formatCount(data.like_count),
        thumbnail,
        webpageUrl: data.webpage_url || trimmedUrl,
        videoQualities: availableVideoQualities,
        audioQualities: availableAudioQualities,
        alreadyDownloaded: !!existing,
        existingDownload: existing ? {
          jobId: existing.jobId,
          downloadFilename: existing.downloadFilename,
          downloadUrl: `/api/download/file/${existing.jobId}`
        } : null,
        isDownloading: !!activeJobId,
        activeJobId
      });
    } catch (parseErr) {
      console.error('Failed to parse metadata JSON:', parseErr);
      res.status(500).json({ error: 'Failed to parse video metadata.' });
    }
  });

  child.on('error', err => {
    res.status(500).json({ error: `Engine error: ${err.message}` });
  });
});

// POST /api/download/start - Initiate asynchronous download
app.post('/api/download/start', (req, res) => {
  const { url, type, quality, title } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required.' });
  }

  // If user already downloaded this URL, don't download again - just offer to save!
  const existing = getExistingDownload(url, type);
  if (existing) {
    console.log(`⚡ Already downloaded URL requested, offering immediate save: "${existing.downloadFilename}"`);
    return res.json({
      jobId: existing.jobId,
      cached: true,
      fileReady: true,
      downloadFilename: existing.downloadFilename,
      downloadUrl: `/api/download/file/${existing.jobId}`,
      message: 'Video already downloaded! Ready to save.'
    });
  }

  // 2. Check if a download for this exact URL is ALREADY IN PROGRESS
  const trimmedUrl = url.trim();
  const incomingHash = getUrlHash(trimmedUrl);
  for (const [id, activeJob] of jobs.entries()) {
    const jobHash = getUrlHash(activeJob.url);
    if ((activeJob.url === trimmedUrl || (jobHash && jobHash === incomingHash)) &&
        (activeJob.status === 'downloading' || activeJob.status === 'processing')) {
      console.log(`⏳ Download already in progress for: ${trimmedUrl} (attaching to job ${activeJob.jobId})`);
      return res.json({
        jobId: activeJob.jobId,
        inProgress: true,
        message: 'Download is already in progress, attaching to current job.'
      });
    }
  }

  // 3. Otherwise, start fresh download
  const jobId = crypto.randomUUID();
  const safeTitle = sanitizeFilename(title);
  const ext = type === 'audio' ? (quality === 'm4a' ? 'm4a' : 'mp3') : 'mp4';
  const urlHash = getUrlHash(url);
  const outputTemplate = path.join(DOWNLOADS_DIR, `${safeTitle}__[${urlHash}].%(ext)s`);

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
      const bitrate = quality === 'mp3_192' ? '192k' : '320k';
      args.push('--audio-quality', bitrate);
    }
  } else {
    // Video
    let formatFilter = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
    if (quality === '1080') {
      formatFilter = 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best';
    } else if (quality === '720') {
      formatFilter = 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best';
    } else if (quality === '480') {
      formatFilter = 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best';
    } else if (quality === '360') {
      formatFilter = 'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360][ext=mp4]/best';
    }
    args.push('-f', formatFilter);
    args.push('--merge-output-format', 'mp4');
  }

  args.push(url.trim());

  const job = {
    jobId,
    url,
    type,
    quality,
    safeTitle,
    targetExt: ext,
    status: 'downloading',
    percent: 0,
    speed: '0 KiB/s',
    eta: '--:--',
    totalSize: 'Calculating...',
    filePath: null,
    downloadFilename: `${safeTitle}.${ext}`,
    error: null,
    createdAt: Date.now()
  };

  jobs.set(jobId, job);

  const env = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` };
  const child = spawn(YTDLP_BIN, args, { env });
  job.process = child;

  let fullStderr = '';

  child.stdout.on('data', chunk => {
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
    if (code === 0) {
      // Find output file by urlHash token
      const files = fs.readdirSync(DOWNLOADS_DIR);
      const hashToken = `__[${urlHash}].`;
      const match = files.find(f => f.includes(hashToken));
      if (match) {
        job.filePath = path.join(DOWNLOADS_DIR, match);
        job.downloadFilename = match.replace(hashToken, '.');
        job.status = 'completed';
        job.percent = 100;
        console.log(`✅ Download complete: "${job.downloadFilename}" (saved as ${match})`);
      } else {
        job.status = 'error';
        job.error = 'Downloaded file not found on disk.';
      }
    } else {
      job.status = 'error';
      job.error = fullStderr.trim() || 'Failed to download stream.';
    }
  });

  child.on('error', err => {
    job.status = 'error';
    job.error = err.message;
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
