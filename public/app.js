// Application State
let currentMedia = null;
let currentMode = 'video'; // 'video' or 'audio'
let selectedQuality = 'best';
let pollingTimer = null;

// DOM Elements
const urlForm = document.getElementById('urlForm');
const videoUrlInput = document.getElementById('videoUrlInput');
const fetchBtn = document.getElementById('fetchBtn');
const fetchSpinner = document.getElementById('fetchSpinner');
const pasteBtn = document.getElementById('pasteBtn');
const alertBox = document.getElementById('alertBox');
const alertText = document.getElementById('alertText');

// Result Card DOM
const resultCard = document.getElementById('resultCard');
const videoThumb = document.getElementById('videoThumb');
const videoDuration = document.getElementById('videoDuration');
const videoPlatform = document.getElementById('videoPlatform');
const videoTitle = document.getElementById('videoTitle');
const videoUploader = document.getElementById('videoUploader');
const videoViews = document.getElementById('videoViews');
const viewsStatWrapper = document.getElementById('viewsStatWrapper');
const tabVideo = document.getElementById('tabVideo');
const tabAudio = document.getElementById('tabAudio');
const qualityOptions = document.getElementById('qualityOptions');
const startDownloadBtn = document.getElementById('startDownloadBtn');
const downloadBtnText = document.getElementById('downloadBtnText');

// Restriction & Bypass DOM
const restrictionBox = document.getElementById('restrictionBox');
const restrictionTitle = document.getElementById('restrictionTitle');
const restrictionDesc = document.getElementById('restrictionDesc');
const bypassPasswordInput = document.getElementById('bypassPasswordInput');
const bypassBtn = document.getElementById('bypassBtn');
const bypassMessage = document.getElementById('bypassMessage');

let isBypassed = false;
let verifiedBypassPassword = '';

// Progress DOM
const progressSection = document.getElementById('progressSection');
const progressStatusText = document.getElementById('progressStatusText');
const progressPercentText = document.getElementById('progressPercentText');
const cancelDownloadBtn = document.getElementById('cancelDownloadBtn');
const progressBarFill = document.getElementById('progressBarFill');
const progressSpeed = document.getElementById('progressSpeed');
const progressSize = document.getElementById('progressSize');
const progressEta = document.getElementById('progressEta');

let activeJobId = null;

// History DOM
const historySection = document.getElementById('historySection');
const historyList = document.getElementById('historyList');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  renderHistory();
  setupEventListeners();
});

// Setup Event Listeners
function setupEventListeners() {
  // URL Submit
  urlForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = videoUrlInput.value.trim();
    if (url) {
      await fetchVideoInfo(url);
    }
  });

  // Paste from clipboard button
  pasteBtn.addEventListener('click', async () => {
    let pastedText = '';

    // 1. Try modern navigator.clipboard API
    if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
      try {
        pastedText = await navigator.clipboard.readText();
      } catch (err) {
        console.warn('Clipboard readText permission or API error:', err);
      }
    }

    // 2. If modern API didn't produce text, try focus + execCommand fallback
    if (!pastedText) {
      videoUrlInput.focus();
      videoUrlInput.select();
      try {
        const success = document.execCommand('paste');
        if (success && videoUrlInput.value.trim()) {
          pastedText = videoUrlInput.value.trim();
        }
      } catch (execErr) {
        console.warn('execCommand paste fallback error:', execErr);
      }
    }

    // 3. Process pasted text or guide user
    if (pastedText && typeof pastedText === 'string') {
      const trimmed = pastedText.trim();
      videoUrlInput.value = trimmed;
      videoUrlInput.dispatchEvent(new Event('input', { bubbles: true }));
      videoUrlInput.focus();
      if (trimmed) {
        await fetchVideoInfo(trimmed);
      }
    } else {
      // If browser security blocked reading clipboard programmatically
      videoUrlInput.focus();
      videoUrlInput.select();
      // showAlert('Clipboard access was blocked by the browser. Please use Cmd+V (Mac) or Ctrl+V to paste directly into the box.');
    }
  });

  // Format Tabs
  tabVideo.addEventListener('click', () => switchMode('video'));
  tabAudio.addEventListener('click', () => switchMode('audio'));

  // Start Download
  startDownloadBtn.addEventListener('click', startDownload);

  // Cancel Download
  if (cancelDownloadBtn) {
    cancelDownloadBtn.addEventListener('click', cancelDownload);
  }

  // Clear History
  clearHistoryBtn.addEventListener('click', () => {
    localStorage.removeItem('download_history');
    renderHistory();
  });

  // Restriction Bypass
  if (bypassBtn) {
    bypassBtn.addEventListener('click', handleBypassAttempt);
  }
  if (bypassPasswordInput) {
    bypassPasswordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleBypassAttempt();
      }
    });
  }

  // Server Stats & Audit Console Inspector
  const serverStatsBtn = document.getElementById('serverStatsBtn');
  if (serverStatsBtn) {
    serverStatsBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/stats?limit=100');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        console.log(data);
      } catch (err) {
        console.error('Failed to fetch server stats:', err);
      }
    });
  }

  // OK Stats (Successful downloads / conversions only)
  const okStatsBtn = document.getElementById('okStatsBtn');
  if (okStatsBtn) {
    okStatsBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/stats?filter=ok&limit=100');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        console.log(data);
      } catch (err) {
        console.error('Failed to fetch OK stats:', err);
      }
    });
  }

  // Error Stats (Errors, blocked restrictions, failed downloads)
  const errorStatsBtn = document.getElementById('errorStatsBtn');
  if (errorStatsBtn) {
    errorStatsBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/stats?filter=error&limit=100');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        console.log(data);
      } catch (err) {
        console.error('Failed to fetch Error stats:', err);
      }
    });
  }
}

// Show/Hide Alert
function showAlert(message) {
  alertText.textContent = message;
  alertBox.style.display = 'flex';
}

function hideAlert() {
  alertBox.style.display = 'none';
}

// Fetch Video Information
async function fetchVideoInfo(url) {
  hideAlert();
  resultCard.style.display = 'none';
  progressSection.style.display = 'none';

  fetchBtn.disabled = true;
  fetchSpinner.style.display = 'inline-block';
  document.querySelector('.btn-text').textContent = 'Analyzing...';

  try {
    const res = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to inspect URL.');
    }

    currentMedia = data;
    renderMediaPreview(data);
  } catch (err) {
    showAlert(err.message || 'Error communicating with server.');
  } finally {
    fetchBtn.disabled = false;
    fetchSpinner.style.display = 'none';
    document.querySelector('.btn-text').textContent = 'Analyze Link';
  }
}

// Render Video Details & Options
function renderMediaPreview(media) {
  videoThumb.src = media.thumbnail || '';
  videoDuration.textContent = media.durationFormatted;
  videoPlatform.textContent = media.platform || 'Media';
  videoTitle.textContent = media.title || 'Untitled';
  videoUploader.textContent = media.uploader || 'Unknown';

  if (media.views) {
    viewsStatWrapper.style.display = 'flex';
    videoViews.textContent = `${media.views} views`;
  } else {
    viewsStatWrapper.style.display = 'none';
  }

  // Reset restriction state for new media
  isBypassed = false;
  verifiedBypassPassword = '';
  if (bypassPasswordInput) bypassPasswordInput.value = '';
  if (bypassMessage) {
    bypassMessage.textContent = '';
    bypassMessage.className = 'bypass-message';
  }
  if (restrictionBox) restrictionBox.classList.remove('unlocked');

  // Default to video mode
  switchMode('video');

  resultCard.style.display = 'block';

  // If this video is currently downloading in background, attach immediately!
  if (media.isDownloading && media.activeJobId) {
    progressSection.style.display = 'block';
    progressStatusText.textContent = 'Download already running in background...';
    startDownloadBtn.disabled = true;
    fetchBtn.disabled = true;
    pollJobProgress(media.activeJobId);
  }

  resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function updateDownloadButtonText() {
  downloadBtnText.textContent = currentMode === 'video' ? 'Download Video (MP4)' : 'Download Audio (MP3)';
}

// Switch between Video and Audio Mode
function switchMode(mode) {
  currentMode = mode;

  if (mode === 'video') {
    tabVideo.classList.add('active');
    tabAudio.classList.remove('active');
    renderQualityChips(currentMedia?.videoQualities || []);
  } else {
    tabAudio.classList.add('active');
    tabVideo.classList.remove('active');
    renderQualityChips(currentMedia?.audioQualities || []);
  }
  checkRestrictionState();
}

// Check and handle restrictions (>20 mins video locked; audio freely allowed up to 3h; >3h locked)
function checkRestrictionState() {
  if (!currentMedia) return;

  const isVideo = currentMode === 'video';
  const duration = typeof currentMedia.duration === 'number' ? currentMedia.duration : parseFloat(currentMedia.duration || 0);
  const durationOver20m = duration > 1200;  // 20 minutes
  const durationOver3h = duration > 10800;  // 3 hours
  const sizeOver1gb = (currentMedia.filesize || 0) > 1024 * 1024 * 1024 || !!currentMedia.isSizeRestricted;

  // Rules:
  // 1. >3h: All media (video & audio) locked without password
  // 2. >20m: Video locked without password (audio is freely allowed)
  // 3. >1GB: All media locked without password
  let isRestricted = false;
  let reason = '';

  if (durationOver3h) {
    isRestricted = true;
    reason = 'This media is longer than 3 hours. Both video and audio downloads require password.';
  } else if (isVideo && durationOver20m) {
    isRestricted = true;
    reason = 'Videos longer than 20 minutes require password (audio downloads are allowed freely).';
  } else if (sizeOver1gb) {
    isRestricted = true;
    reason = 'This file exceeds the 1 GB file size limit.';
  }

  if (isRestricted && !isBypassed) {
    if (restrictionBox) {
      restrictionBox.style.display = 'block';
      restrictionBox.classList.remove('unlocked');
      restrictionTitle.textContent = 'Download Restriction';
      restrictionDesc.textContent = `${reason} Enter password to bypass restriction.`;
    }
    startDownloadBtn.disabled = true;
    startDownloadBtn.style.opacity = '0.65';
    startDownloadBtn.style.cursor = 'not-allowed';
    downloadBtnText.textContent = 'Download Locked (Password Required)';
  } else {
    if (isBypassed && isRestricted) {
      if (restrictionBox) {
        restrictionBox.style.display = 'block';
        restrictionBox.classList.add('unlocked');
        restrictionTitle.textContent = '✓ Restriction Bypassed';
        restrictionDesc.textContent = 'Password verified. You can now download this media.';
      }
    } else {
      if (restrictionBox) restrictionBox.style.display = 'none';
    }
    startDownloadBtn.disabled = false;
    startDownloadBtn.style.opacity = '1';
    startDownloadBtn.style.cursor = 'pointer';
    updateDownloadButtonText();
  }
}

async function handleBypassAttempt() {
  const pwd = bypassPasswordInput ? bypassPasswordInput.value.trim() : '';
  if (!pwd) {
    if (bypassMessage) {
      bypassMessage.textContent = 'Please enter password. Hint: slija';
      bypassMessage.className = 'bypass-message error';
    }
    if (bypassPasswordInput) bypassPasswordInput.focus();
    return;
  }

  if (bypassBtn) bypassBtn.disabled = true;
  if (bypassMessage) {
    bypassMessage.textContent = 'Verifying...';
    bypassMessage.className = 'bypass-message';
  }

  try {
    const res = await fetch('/api/bypass/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd })
    });

    const data = await res.json();
    if (res.ok && data.valid) {
      isBypassed = true;
      verifiedBypassPassword = pwd;
      if (bypassMessage) {
        bypassMessage.textContent = '✓ Unlocked!';
        bypassMessage.className = 'bypass-message success';
      }
      checkRestrictionState();
    } else {
      isBypassed = false;
      if (bypassMessage) {
        bypassMessage.textContent = data.error || 'Incorrect password. Hint: slija';
        bypassMessage.className = 'bypass-message error';
      }
      if (bypassPasswordInput) bypassPasswordInput.focus();
      checkRestrictionState();
    }
  } catch (err) {
    if (bypassMessage) {
      bypassMessage.textContent = 'Verification error. Try again.';
      bypassMessage.className = 'bypass-message error';
    }
  } finally {
    if (bypassBtn) bypassBtn.disabled = false;
  }
}

// Render Quality Selection Chips
function renderQualityChips(qualities) {
  qualityOptions.innerHTML = '';
  if (!qualities || qualities.length === 0) {
    qualityOptions.innerHTML = '<span style="color: var(--text-dim); font-size: 0.85rem;">Standard quality selected</span>';
    selectedQuality = 'best';
    updateDownloadButtonText();
    return;
  }

  selectedQuality = qualities[0].id;

  qualities.forEach((q, index) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `quality-chip ${index === 0 ? 'selected' : ''}`;
    chip.textContent = q.label;
    chip.dataset.id = q.id;

    chip.addEventListener('click', () => {
      document.querySelectorAll('.quality-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      selectedQuality = q.id;
      updateDownloadButtonText();
    });

    qualityOptions.appendChild(chip);
  });

  updateDownloadButtonText();
}

// Start Download Process
async function startDownload() {
  if (!currentMedia) return;

  const isVideo = currentMode === 'video';
  const duration = typeof currentMedia.duration === 'number' ? currentMedia.duration : parseFloat(currentMedia.duration || 0);
  const durationOver20m = duration > 1200;
  const durationOver3h = duration > 10800;
  const sizeOver1gb = (currentMedia.filesize || 0) > 1024 * 1024 * 1024 || !!currentMedia.isSizeRestricted;
  const isRestricted = durationOver3h || (isVideo && durationOver20m) || sizeOver1gb;

  if (isRestricted && !isBypassed) {
    checkRestrictionState();
    if (restrictionBox) restrictionBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (bypassPasswordInput) bypassPasswordInput.focus();
    return;
  }

  hideAlert();
  startDownloadBtn.disabled = true;
  fetchBtn.disabled = true;
  if (cancelDownloadBtn) {
    cancelDownloadBtn.style.display = 'inline-flex';
    cancelDownloadBtn.disabled = false;
  }
  progressSection.style.display = 'block';
  progressBarFill.style.width = '0%';
  progressPercentText.textContent = '0%';
  progressStatusText.textContent = 'Checking local storage & starting...';
  progressSpeed.textContent = '-- KiB/s';
  progressSize.textContent = '--';
  progressEta.textContent = '--:--';

  try {
    const res = await fetch('/api/download/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: currentMedia.webpageUrl,
        type: currentMode,
        quality: selectedQuality,
        title: currentMedia.title,
        duration: currentMedia.duration,
        bypassPassword: isBypassed ? verifiedBypassPassword : (bypassPasswordInput ? bypassPasswordInput.value.trim() : '')
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to start download.');
    }

    // If download is already in progress, seamlessly attach to it!
    if (data.inProgress) {
      activeJobId = data.jobId;
      progressStatusText.textContent = 'Attaching to download in progress...';
      pollJobProgress(data.jobId);
      return;
    }

    // If file is already downloaded and present on server, save instantly!
    if (data.cached) {
      if (cancelDownloadBtn) cancelDownloadBtn.style.display = 'none';
      progressBarFill.style.width = '100%';
      progressPercentText.textContent = '100%';
      progressStatusText.textContent = '✓ Already downloaded! Saving to your computer...';
      progressSpeed.textContent = 'Instant';
      progressSize.textContent = 'Ready on Disk';
      progressEta.textContent = '0s';
      startDownloadBtn.disabled = false;
      fetchBtn.disabled = false;

      // Trigger browser save dialog immediately
      triggerBrowserDownload(`/api/download/file/${data.jobId}`);

      // Add to local history
      saveToHistory({
        title: currentMedia.title,
        thumbnail: currentMedia.thumbnail,
        platform: currentMedia.platform,
        mode: currentMode,
        quality: selectedQuality,
        downloadUrl: `/api/download/file/${data.jobId}`,
        filename: data.downloadFilename,
        timestamp: Date.now()
      });
      return;
    }

    activeJobId = data.jobId;
    pollJobProgress(data.jobId);
  } catch (err) {
    startDownloadBtn.disabled = false;
    fetchBtn.disabled = false;
    if (cancelDownloadBtn) cancelDownloadBtn.style.display = 'none';
    showAlert(err.message || 'Error starting download.');
  }
}

// Poll Download Progress
function pollJobProgress(jobId) {
  if (pollingTimer) clearInterval(pollingTimer);

  pollingTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/download/progress/${jobId}`);
      if (!res.ok) {
        clearInterval(pollingTimer);
        startDownloadBtn.disabled = false;
        showAlert('Download job lost or expired.');
        return;
      }

      const job = await res.json();

      // Update UI
      const percent = Math.round(job.percent || 0);
      progressBarFill.style.width = `${percent}%`;
      progressPercentText.textContent = `${percent}%`;

      if (job.status === 'processing') {
        progressStatusText.textContent = 'Muxing & converting high quality streams...';
      } else if (job.status === 'downloading') {
        progressStatusText.textContent = `Downloading stream: ${percent}%`;
      }

      if (job.speed) progressSpeed.textContent = job.speed;
      if (job.totalSize) progressSize.textContent = job.totalSize;
      if (job.eta) progressEta.textContent = job.eta;

      if (job.fileReady) {
        clearInterval(pollingTimer);
        pollingTimer = null;
        if (cancelDownloadBtn) cancelDownloadBtn.style.display = 'none';
        progressStatusText.textContent = '✓ Ready! Saving to your computer...';
        progressBarFill.style.width = '100%';
        progressPercentText.textContent = '100%';
        startDownloadBtn.disabled = false;
        fetchBtn.disabled = false;

        // Trigger browser save dialog
        triggerBrowserDownload(`/api/download/file/${jobId}`);

        // Add to history
        saveToHistory({
          title: currentMedia.title,
          thumbnail: currentMedia.thumbnail,
          platform: currentMedia.platform,
          mode: currentMode,
          quality: selectedQuality,
          downloadUrl: `/api/download/file/${jobId}`,
          filename: job.downloadFilename,
          timestamp: Date.now()
        });
      } else if (job.status === 'cancelled') {
        clearInterval(pollingTimer);
        pollingTimer = null;
        activeJobId = null;
        progressStatusText.textContent = '🛑 Download cancelled';
        startDownloadBtn.disabled = false;
        fetchBtn.disabled = false;
        if (cancelDownloadBtn) cancelDownloadBtn.style.display = 'none';
      } else if (job.status === 'error') {
        clearInterval(pollingTimer);
        pollingTimer = null;
        activeJobId = null;
        startDownloadBtn.disabled = false;
        fetchBtn.disabled = false;
        if (cancelDownloadBtn) cancelDownloadBtn.style.display = 'none';
        showAlert(job.error || 'Download encountered an error.');
      }
    } catch (e) {
      console.error('Polling error:', e);
    }
  }, 700);
}

// Cancel current download job
async function cancelDownload() {
  if (!activeJobId) return;

  if (cancelDownloadBtn) {
    cancelDownloadBtn.disabled = true;
    cancelDownloadBtn.querySelector('span').textContent = 'Cancelling...';
  }

  try {
    const res = await fetch(`/api/download/cancel/${activeJobId}`, { method: 'POST' });
    const data = await res.json();
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
    progressStatusText.textContent = '🛑 Download cancelled';
    startDownloadBtn.disabled = false;
    fetchBtn.disabled = false;
    if (cancelDownloadBtn) {
      cancelDownloadBtn.style.display = 'none';
      cancelDownloadBtn.querySelector('span').textContent = 'Cancel';
      cancelDownloadBtn.disabled = false;
    }
    activeJobId = null;
  } catch (err) {
    console.error('Failed to cancel download:', err);
    showAlert('Failed to cancel download.');
    if (cancelDownloadBtn) {
      cancelDownloadBtn.disabled = false;
      cancelDownloadBtn.querySelector('span').textContent = 'Cancel';
    }
  }
}

// Trigger Native Browser File Download
function triggerBrowserDownload(url) {
  const a = document.createElement('a');
  a.href = url;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Local Download History Management
function saveToHistory(item) {
  let history = [];
  try {
    history = JSON.parse(localStorage.getItem('download_history') || '[]');
  } catch (e) {
    history = [];
  }

  // Prepend new item, keep max 10
  history.unshift(item);
  if (history.length > 10) history = history.slice(0, 10);

  localStorage.setItem('download_history', JSON.stringify(history));
  renderHistory();
}

function renderHistory() {
  let history = [];
  try {
    history = JSON.parse(localStorage.getItem('download_history') || '[]');
  } catch (e) {
    history = [];
  }

  if (history.length === 0) {
    historySection.style.display = 'none';
    return;
  }

  historySection.style.display = 'block';
  historyList.innerHTML = '';

  history.forEach(item => {
    const el = document.createElement('div');
    el.className = 'history-item';
    el.innerHTML = `
      <img src="${item.thumbnail || ''}" class="history-thumb" alt="" />
      <div class="history-info">
        <div class="history-title">${escapeHtml(item.title)}</div>
        <div class="history-sub">${item.platform || 'Media'} • ${item.mode.toUpperCase()} (${item.quality}) • ${new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
      <a href="${item.downloadUrl}" class="btn-paste" style="text-decoration: none;" download>Save Again</a>
    `;
    historyList.appendChild(el);
  });
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
