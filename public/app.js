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

// Progress DOM
const progressSection = document.getElementById('progressSection');
const progressStatusText = document.getElementById('progressStatusText');
const progressPercentText = document.getElementById('progressPercentText');
const progressBarFill = document.getElementById('progressBarFill');
const progressSpeed = document.getElementById('progressSpeed');
const progressSize = document.getElementById('progressSize');
const progressEta = document.getElementById('progressEta');

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
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        videoUrlInput.value = text.trim();
        await fetchVideoInfo(text.trim());
      }
    } catch (err) {
      videoUrlInput.focus();
    }
  });

  // Format Tabs
  tabVideo.addEventListener('click', () => switchMode('video'));
  tabAudio.addEventListener('click', () => switchMode('audio'));

  // Start Download
  startDownloadBtn.addEventListener('click', startDownload);

  // Clear History
  clearHistoryBtn.addEventListener('click', () => {
    localStorage.removeItem('download_history');
    renderHistory();
  });
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

  // Default to video mode
  switchMode('video');

  resultCard.style.display = 'block';
  resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Switch between Video and Audio Mode
function switchMode(mode) {
  currentMode = mode;

  if (mode === 'video') {
    tabVideo.classList.add('active');
    tabAudio.classList.remove('active');
    downloadBtnText.textContent = 'Download Video (MP4)';
    renderQualityChips(currentMedia?.videoQualities || []);
  } else {
    tabAudio.classList.add('active');
    tabVideo.classList.remove('active');
    downloadBtnText.textContent = 'Download Audio (MP3)';
    renderQualityChips(currentMedia?.audioQualities || []);
  }
}

// Render Quality Selection Chips
function renderQualityChips(qualities) {
  qualityOptions.innerHTML = '';
  if (!qualities || qualities.length === 0) {
    qualityOptions.innerHTML = '<span style="color: var(--text-dim); font-size: 0.85rem;">Standard quality selected</span>';
    selectedQuality = 'best';
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
    });

    qualityOptions.appendChild(chip);
  });
}

// Start Download Process
async function startDownload() {
  if (!currentMedia) return;

  hideAlert();
  startDownloadBtn.disabled = true;
  progressSection.style.display = 'block';
  progressBarFill.style.width = '0%';
  progressPercentText.textContent = '0%';
  progressStatusText.textContent = 'Initializing media extraction...';
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
        title: currentMedia.title
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to start download.');
    }

    pollJobProgress(data.jobId);
  } catch (err) {
    startDownloadBtn.disabled = false;
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
        progressStatusText.textContent = '✓ Ready! Saving to your computer...';
        progressBarFill.style.width = '100%';
        progressPercentText.textContent = '100%';
        startDownloadBtn.disabled = false;

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
      } else if (job.status === 'error') {
        clearInterval(pollingTimer);
        startDownloadBtn.disabled = false;
        showAlert(job.error || 'Download encountered an error.');
      }
    } catch (e) {
      console.error('Polling error:', e);
    }
  }, 700);
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
