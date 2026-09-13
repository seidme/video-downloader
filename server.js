import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

import { exportMultipleGuestCookies } from './export-cookies.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.set('trust proxy', true);
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Unified persistent data directory with nested subfolders
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DOWNLOADS_DIR = path.join(DATA_DIR, 'downloads');
const COOKIES_DIR = path.join(DATA_DIR, 'cookies');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.json');

// Ensure directories exist
[DATA_DIR, DOWNLOADS_DIR, COOKIES_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Auto-seed incognito guest cookies if none exist on startup
(async function initCookies() {
  try {
    const existing = fs.readdirSync(COOKIES_DIR).filter(f => f.endsWith('.txt'));
    if (existing.length === 0) {
      console.log('🍪 No cookies found in cookies directory. Auto-generating guest cookies pool...');
      await exportMultipleGuestCookies(3, COOKIES_DIR);
    }
  } catch (err) {
    console.warn('⚠️ Auto-cookie initialization notice:', err.message);
  }
})();

const MAX_STORAGE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB max hard limit
const PURGE_THRESHOLD_BYTES = MAX_STORAGE_BYTES * 0.6; // Start purging at 60% (1.2 GB)
const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024; // 1 GB
const MAX_CONCURRENT_DOWNLOADS = 3; // Maximum active downloads allowed concurrently
const BYPASS_PASSWORD = 'leptir';

// Helper: Count currently active downloading or processing jobs
function getActiveDownloadCount() {
  let count = 0;
  for (const job of jobs.values()) {
    if (job.status === 'downloading' || job.status === 'processing') {
      count++;
    }
  }
  return count;
}

// Audit Action Enum & Categorization
const AuditAction = Object.freeze({
  DOWNLOAD_START: 'download_start',
  DOWNLOAD_COMPLETED: 'download_completed',
  DOWNLOAD_CACHED_HIT: 'download_cached_hit',
  DOWNLOAD_CANCELLED: 'download_cancelled',
  DOWNLOAD_ERROR: 'download_error',
  INFO_FETCH: 'info_fetch',
  INFO_ERROR: 'info_error',
  BYPASS_ATTEMPT: 'bypass_attempt',
  RESTRICTION_BLOCKED: 'restriction_blocked',
  ERROR: 'error'
});

const OK_AUDIT_ACTIONS = new Set([
  AuditAction.DOWNLOAD_COMPLETED,
  AuditAction.DOWNLOAD_CACHED_HIT
]);

const ERROR_AUDIT_ACTIONS = new Set([
  AuditAction.DOWNLOAD_ERROR,
  AuditAction.INFO_ERROR,
  AuditAction.RESTRICTION_BLOCKED,
  AuditAction.ERROR
]);

const isSuccessAuditLog = (log) => OK_AUDIT_ACTIONS.has(log.action);
const isErrorAuditLog = (log) => 
  ERROR_AUDIT_ACTIONS.has(log.action) ||
  (log.action === AuditAction.BYPASS_ATTEMPT && log.details?.toLowerCase().includes('incorrect'));

// Audit Log (Persisted to audit.json, keeps up to 1000 most recent events)
const MAX_AUDIT_LOGS = 1000;
let auditLogs = [];

try {
  if (fs.existsSync(AUDIT_FILE)) {
    const raw = fs.readFileSync(AUDIT_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      auditLogs = parsed.slice(0, MAX_AUDIT_LOGS);
    }
  }
} catch (err) {
  console.error('Failed to initialize audit.json:', err.message);
  auditLogs = [];
}

let saveAuditTimer = null;
function scheduleSaveAudit() {
  if (saveAuditTimer) return;
  saveAuditTimer = setTimeout(() => {
    saveAuditTimer = null;
    try {
      fs.writeFileSync(AUDIT_FILE, JSON.stringify(auditLogs, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save audit.json:', err.message);
    }
  }, 500);
}

function getClientIp(req) {
  if (!req) return 'unknown';
  if (req.ipContext) return req.ipContext;
  const forwarded = req.headers ? req.headers['x-forwarded-for'] : null;
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0 || isNaN(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function logAuditEvent(action, data = {}, req = null) {
  const entry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    action,
    ip: getClientIp(req),
    url: data.url || null,
    type: data.type || null,
    quality: data.quality || null,
    title: data.title || null,
    filename: data.filename || null,
    fileSize: data.fileSize || null,
    fileSizeFormatted: data.fileSizeFormatted || (data.fileSize ? formatBytes(data.fileSize) : null),
    duration: data.duration || null,
    cached: data.cached || false,
    details: data.details || null
  };

  auditLogs.unshift(entry);
  if (auditLogs.length > MAX_AUDIT_LOGS) {
    auditLogs = auditLogs.slice(0, MAX_AUDIT_LOGS);
  }
  scheduleSaveAudit();
  return entry;
}

// Helper: Calculate total storage currently used by downloads folder (excludes audit.json)
function getStorageUsage() {
  try {
    const files = fs.readdirSync(DOWNLOADS_DIR);
    let totalBytes = 0;
    const details = [];
    for (const file of files) {
      if (file.startsWith('.')) continue;
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

// Helper: Enforce volume quota (starts purging oldest files at 60% / 1.2 GB, hard cap at 2 GB)
function ensureStorageQuota(headroomBytes = 50 * 1024 * 1024) {
  try {
    let { totalBytes, details } = getStorageUsage();
    if (totalBytes + headroomBytes <= PURGE_THRESHOLD_BYTES) {
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
      if (totalBytes + headroomBytes <= PURGE_THRESHOLD_BYTES) break;
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

// Helper: Collect all available cookies files for rotation
function getAvailableCookieFiles() {
  const found = new Set();

  const envCookie = process.env.YTDLP_COOKIES_FILE;
  if (envCookie && fs.existsSync(envCookie)) found.add(path.resolve(envCookie));

  const singleFile = path.join(DATA_DIR, 'cookies.txt');
  if (fs.existsSync(singleFile)) {
    try {
      if (fs.statSync(singleFile).isFile()) found.add(singleFile);
    } catch (e) {}
  }

  if (fs.existsSync(COOKIES_DIR)) {
    try {
      const entries = fs.readdirSync(COOKIES_DIR);
      for (const entry of entries) {
        if (entry.startsWith('.') || !entry.endsWith('.txt')) continue;
        const fullPath = path.join(COOKIES_DIR, entry);
        try {
          if (fs.statSync(fullPath).isFile()) {
            found.add(fullPath);
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  return Array.from(found);
}

// Helper: Pick a random cookie file from the available pool
function getRandomCookieFile() {
  const pool = getAvailableCookieFiles();
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Helper: Common yt-dlp arguments (cookies, optional proxy, optional player client)
function getYtDlpCommonArgs() {
  const common = [];

  const cookiePath = getRandomCookieFile();
  if (cookiePath) {
    common.push('--cookies', cookiePath);
  }

  const proxy = process.env.YTDLP_PROXY || process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
  if (proxy) {
    common.push('--proxy', proxy);
  }

  // Only apply player_client if explicitly configured via environment variable
  // (We do not force android by default, avoiding automatic quality downgrades to 360p)
  if (process.env.YTDLP_PLAYER_CLIENT) {
    common.push('--extractor-args', `youtube:player_client=${process.env.YTDLP_PLAYER_CLIENT}`);
  }

  return common;
}

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
      activeJobs: getActiveDownloadCount(),
      maxConcurrentDownloads: MAX_CONCURRENT_DOWNLOADS,
      storage: {
        usedBytes: totalBytes,
        usedMB: (totalBytes / (1024 * 1024)).toFixed(2),
        maxBytes: MAX_STORAGE_BYTES,
        maxGB: (MAX_STORAGE_BYTES / (1024 * 1024 * 1024)).toFixed(1),
        purgeThresholdBytes: PURGE_THRESHOLD_BYTES,
        purgeThresholdMB: (PURGE_THRESHOLD_BYTES / (1024 * 1024)).toFixed(0),
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
  const valid = password === BYPASS_PASSWORD;
  logAuditEvent(AuditAction.BYPASS_ATTEMPT, {
    details: valid ? 'Password bypass verified successfully' : 'Incorrect password entered'
  }, req);
  if (valid) {
    return res.json({ valid: true, message: 'Password verified.' });
  }
  return res.status(401).json({ valid: false, error: 'Incorrect password. Hint: slija' });
});

// POST /api/admin/cookies - Securely upload or update cookie files
app.post('/api/admin/cookies', (req, res) => {
  const { password, cookies, filename } = req.body || {};
  if (password !== BYPASS_PASSWORD) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  if (!cookies || typeof cookies !== 'string' || cookies.trim().length === 0) {
    return res.status(400).json({ error: 'No cookie content provided.' });
  }
  const cleanName = (filename && /^[a-zA-Z0-9_-]+\.txt$/.test(filename)) ? filename : 'account.txt';
  const targetPath = path.join(COOKIES_DIR, cleanName);
  try {
    fs.writeFileSync(targetPath, cookies.trim() + '\n', 'utf-8');
    console.log(`🍪 Admin updated cookie file: ${cleanName}`);
    return res.json({ success: true, filename: cleanName, activeCookies: getAvailableCookieFiles().length });
  } catch (err) {
    return res.status(500).json({ error: `Failed to write cookies: ${err.message}` });
  }
});

// GET /api/stats - Server health, history file counts, sizes, biggest file, and audit logs
app.get('/api/stats', (req, res) => {
  const { totalBytes, details } = getStorageUsage();

  // Find biggest file
  let biggestFile = null;
  if (details.length > 0) {
    const sorted = [...details].sort((a, b) => b.size - a.size);
    biggestFile = {
      filename: sorted[0].file,
      sizeBytes: sorted[0].size,
      sizeFormatted: formatBytes(sorted[0].size)
    };
  }

  const filesList = details.map(d => ({
    filename: d.file,
    sizeBytes: d.size,
    sizeFormatted: formatBytes(d.size),
    mtimeMs: d.mtimeMs
  })).sort((a, b) => b.mtimeMs - a.mtimeMs);

  const filter = (req.query.filter || req.query.status || '').toLowerCase();
  let targetLogs = auditLogs;
  if (filter === 'ok' || filter === 'success') {
    targetLogs = auditLogs.filter(isSuccessAuditLog);
  } else if (filter === 'error' || filter === 'errors' || filter === 'fail') {
    targetLogs = auditLogs.filter(isErrorAuditLog);
  }

  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 1000);

  res.json({
    status: 'online',
    filter: filter || 'all',
    timestamp: new Date().toISOString(),
    history: {
      fileCount: details.length,
      totalBytes,
      totalFormatted: formatBytes(totalBytes),
      biggestFile,
      files: filesList
    },
    storage: {
      usedBytes: totalBytes,
      usedMB: (totalBytes / (1024 * 1024)).toFixed(2),
      maxBytes: MAX_STORAGE_BYTES,
      maxGB: (MAX_STORAGE_BYTES / (1024 * 1024 * 1024)).toFixed(1),
      purgeThresholdBytes: PURGE_THRESHOLD_BYTES,
      purgeThresholdMB: (PURGE_THRESHOLD_BYTES / (1024 * 1024)).toFixed(0),
      usagePercent: ((totalBytes / MAX_STORAGE_BYTES) * 100).toFixed(1)
    },
    activeJobs: getActiveDownloadCount(),
    maxConcurrentDownloads: MAX_CONCURRENT_DOWNLOADS,
    cookies: {
      count: getAvailableCookieFiles().length
    },
    audit: {
      totalCount: targetLogs.length,
      recentLogs: targetLogs.slice(0, limit)
    }
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
    ...getYtDlpCommonArgs(),
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
      logAuditEvent(AuditAction.INFO_ERROR, { url: trimmedUrl, details: stderr.trim() || message }, req);
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

      logAuditEvent(AuditAction.INFO_FETCH, {
        url: trimmedUrl,
        title: data.title,
        duration: data.duration
      }, req);
    } catch (parseErr) {
      console.error('Failed to parse metadata JSON:', parseErr);
      logAuditEvent(AuditAction.INFO_ERROR, { url: trimmedUrl, details: 'Failed to parse video metadata JSON' }, req);
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
  const isBypassed = bypassPassword === BYPASS_PASSWORD;

  if (isVideo && durationOver1h && !isBypassed) {
    logAuditEvent(AuditAction.RESTRICTION_BLOCKED, {
      url,
      type,
      duration,
      title: safeTitle,
      details: 'Video exceeds 1 hour limit without password'
    }, req);
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
    let fileSize = 0;
    try {
      fileSize = fs.statSync(targetFilePath).size;
    } catch (e) {}

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

    logAuditEvent(AuditAction.DOWNLOAD_CACHED_HIT, {
      url,
      type,
      quality: qTag,
      title: safeTitle,
      filename: targetFilename,
      fileSize,
      fileSizeFormatted: formatBytes(fileSize),
      cached: true
    }, req);

    return res.json({
      jobId: existingJobId,
      cached: true,
      fileReady: true,
      downloadFilename: targetFilename,
      downloadUrl: `/api/download/file/${existingJobId}`,
      message: 'File already downloaded! Ready to save.'
    });
  }

  // 3. Concurrency limit check: Reject if 3 active downloads are already running
  const activeDownloads = getActiveDownloadCount();
  if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
    logAuditEvent(AuditAction.DOWNLOAD_ERROR, {
      url,
      type,
      quality: qTag,
      title: safeTitle,
      details: `Server busy: Maximum concurrent downloads reached (${activeDownloads}/${MAX_CONCURRENT_DOWNLOADS})`
    }, req);
    return res.status(503).json({
      error: 'Server is currently busy processing other downloads. Maximum 3 concurrent downloads reached. Please try again in a few moments.',
      busy: true
    });
  }

  // 4. Otherwise, start fresh download
  const quota = ensureStorageQuota();
  if (!quota.ok) {
    logAuditEvent(AuditAction.DOWNLOAD_ERROR, { url, details: 'Storage limit reached (2 GB max)' }, req);
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
    ...getYtDlpCommonArgs(),
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

  const clientIp = getClientIp(req);

  const job = {
    jobId,
    url,
    clientIp,
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

  logAuditEvent(AuditAction.DOWNLOAD_START, {
    url,
    type,
    quality: qTag,
    title: safeTitle,
    filename: targetFilename,
    duration,
    details: isBypassed ? 'Bypass password used' : 'Standard download start'
  }, req);

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
      logAuditEvent(AuditAction.DOWNLOAD_CANCELLED, {
        url: job.url,
        type: job.type,
        quality: job.quality,
        title: job.safeTitle,
        filename: targetFilename
      }, { ipContext: job.clientIp });

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

      let fileSize = 0;
      try {
        fileSize = fs.statSync(targetFilePath).size;
      } catch (e) {}

      logAuditEvent(AuditAction.DOWNLOAD_COMPLETED, {
        url: job.url,
        type: job.type,
        quality: job.quality,
        title: job.safeTitle,
        filename: targetFilename,
        fileSize,
        fileSizeFormatted: formatBytes(fileSize),
        cached: false
      }, { ipContext: job.clientIp });
    } else {
      job.status = 'error';
      if (fullStderr.includes('larger than max-filesize') || fullStderr.includes('max-filesize')) {
        job.error = 'File exceeds 1 GB limit. Enter bypass password to download (Hint: slija).';
      } else {
        job.error = fullStderr.trim() || 'Downloaded file not found on disk.';
      }

      logAuditEvent(AuditAction.DOWNLOAD_ERROR, {
        url: job.url,
        type: job.type,
        quality: job.quality,
        title: job.safeTitle,
        filename: targetFilename,
        details: job.error
      }, { ipContext: job.clientIp });
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

  logAuditEvent(AuditAction.DOWNLOAD_CANCELLED, {
    url: job.url,
    type: job.type,
    quality: job.quality,
    title: job.safeTitle,
    filename: job.targetFilename,
    jobId
  }, req);

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
      if (file.startsWith('.')) continue;
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
  const cookieFiles = getAvailableCookieFiles();
  const proxy = process.env.YTDLP_PROXY || process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
  if (cookieFiles.length > 1) {
    console.log(`🍪 cookies: ${cookieFiles.length} files loaded (random rotation active)`);
  } else if (cookieFiles.length === 1) {
    console.log(`🍪 cookies: 1 file loaded (${path.basename(cookieFiles[0])})`);
  } else {
    console.log(`🍪 cookies: None (guest mode)`);
  }
  if (proxy) {
    console.log(`🌐 proxy: ${proxy}`);
  }
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
