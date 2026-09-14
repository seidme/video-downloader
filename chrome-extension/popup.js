const LOCAL_SERVER_URL = 'http://127.0.0.1:3000';
const DEFAULT_CLOUD_URL = 'https://video.codeeve.com';
const DEFAULT_PASSWORD = 'slija';

let state = {
  serverUrl: DEFAULT_CLOUD_URL,
  savedServerUrl: null,
  bypassPassword: DEFAULT_PASSWORD,
  autoToken: true,
  currentTab: null,
  currentMode: 'audio', // 'audio' or 'video'
  selectedQuality: '320k',
  selectedFormat: 'mp3',
  activeJobId: null,
  pollTimer: null,
  extractedTokens: null
};

// DOM Elements
const el = {
  statusPill: document.getElementById('serverStatus'),
  statusText: document.getElementById('statusText'),
  settingsBtn: document.getElementById('settingsBtn'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  mainView: document.getElementById('mainView'),
  settingsView: document.getElementById('settingsView'),
  
  // Media Card
  mediaTitle: document.getElementById('mediaTitle'),
  mediaDomain: document.getElementById('mediaDomain'),
  mediaThumb: document.getElementById('mediaThumb'),
  mediaThumbPlaceholder: document.getElementById('mediaThumbPlaceholder'),

  // Mode Buttons
  modeAudio: document.getElementById('modeAudio'),
  modeVideo: document.getElementById('modeVideo'),

  // Formats & Quality
  qualitySelect: document.getElementById('qualitySelect'),
  formatSelect: document.getElementById('formatSelect'),
  downloadBtn: document.getElementById('downloadBtn'),
  downloadBtnText: document.getElementById('downloadBtnText'),

  // Progress Card
  progressCard: document.getElementById('progressCard'),
  progressStatus: document.getElementById('progressStatus'),
  progressPercent: document.getElementById('progressPercent'),
  progressBar: document.getElementById('progressBar'),
  progressDetail: document.getElementById('progressDetail'),
  cancelBtn: document.getElementById('cancelBtn'),

  // Alerts
  alertBox: document.getElementById('alertBox'),
  alertMsg: document.getElementById('alertMsg'),

  // Settings
  settingServerUrl: document.getElementById('settingServerUrl'),
  settingPassword: document.getElementById('settingPassword'),
  settingAutoToken: document.getElementById('settingAutoToken'),
  testConnectionBtn: document.getElementById('testConnectionBtn'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  settingsAlert: document.getElementById('settingsAlert')
};

// Initialize Extension Popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupEventListeners();
  await detectActiveTab();
  checkServerHealth();
});

// Load settings from chrome.storage.local
async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['serverUrl', 'bypassPassword', 'autoToken'], (items) => {
      state.savedServerUrl = items.serverUrl ? items.serverUrl.replace(/\/+$/, '') : null;
      state.serverUrl = state.savedServerUrl || DEFAULT_CLOUD_URL;
      state.bypassPassword = items.bypassPassword !== undefined ? items.bypassPassword : DEFAULT_PASSWORD;
      state.autoToken = items.autoToken !== undefined ? items.autoToken : true;

      el.settingServerUrl.value = state.savedServerUrl || DEFAULT_CLOUD_URL;
      el.settingPassword.value = state.bypassPassword;
      el.settingAutoToken.checked = state.autoToken;
      resolve();
    });
  });
}

// Setup Event Listeners
function setupEventListeners() {
  // Mode selection
  el.modeAudio.addEventListener('click', () => setMode('audio'));
  el.modeVideo.addEventListener('click', () => setMode('video'));

  // Dropdown changes
  el.qualitySelect.addEventListener('change', (e) => {
    state.selectedQuality = e.target.value;
    updateButtonText();
  });
  el.formatSelect.addEventListener('change', (e) => {
    state.selectedFormat = e.target.value;
    updateButtonText();
  });

  // Action Button
  el.downloadBtn.addEventListener('click', handleDownload);
  el.cancelBtn.addEventListener('click', handleCancel);

  // Settings Toggles
  el.settingsBtn.addEventListener('click', () => toggleSettings(true));
  el.closeSettingsBtn.addEventListener('click', () => toggleSettings(false));
  el.testConnectionBtn.addEventListener('click', testConnection);
  el.saveSettingsBtn.addEventListener('click', saveSettings);
}

// Mode Selector (Audio vs Video)
function setMode(mode) {
  state.currentMode = mode;
  el.modeAudio.classList.toggle('active', mode === 'audio');
  el.modeVideo.classList.toggle('active', mode === 'video');

  if (mode === 'audio') {
    el.qualitySelect.innerHTML = `
      <option value="320k" selected>320 kbps (HQ)</option>
      <option value="256k">256 kbps</option>
      <option value="192k">192 kbps</option>
      <option value="128k">128 kbps</option>
    `;
    el.formatSelect.innerHTML = `
      <option value="mp3" selected>MP3</option>
      <option value="m4a">M4A</option>
    `;
    state.selectedQuality = '320k';
    state.selectedFormat = 'mp3';
  } else {
    el.qualitySelect.innerHTML = `
      <option value="best" selected>Best Available</option>
      <option value="1080">1080p</option>
      <option value="720">720p</option>
      <option value="480">480p</option>
      <option value="360">360p</option>
    `;
    el.formatSelect.innerHTML = `
      <option value="mp4" selected>MP4</option>
    `;
    state.selectedQuality = 'best';
    state.selectedFormat = 'mp4';
  }
  updateButtonText();
}

function updateButtonText() {
  if (state.currentMode === 'audio') {
    el.downloadBtnText.textContent = `Download Audio (${state.selectedQuality.toUpperCase()})`;
  } else {
    const qLabel = state.selectedQuality === 'best' ? 'Best' : `${state.selectedQuality}p`;
    el.downloadBtnText.textContent = `Download Video (${qLabel})`;
  }
}

// Detect current active tab URL and title
async function detectActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      setEmptyTab();
      return;
    }

    state.currentTab = tab;
    el.mediaTitle.textContent = tab.title || 'Untitled Page';
    el.mediaTitle.title = tab.title || '';

    try {
      const urlObj = new URL(tab.url);
      el.mediaDomain.textContent = urlObj.hostname.replace(/^www\./, '');

      // Check YouTube thumbnail
      const ytId = extractYouTubeId(tab.url);
      if (ytId) {
        el.mediaThumb.src = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
        el.mediaThumb.classList.remove('hidden');
        el.mediaThumbPlaceholder.classList.add('hidden');

        if (state.autoToken) {
          extractYouTubeSession(tab.id);
        }
      } else {
        el.mediaThumb.classList.add('hidden');
        el.mediaThumbPlaceholder.classList.remove('hidden');
      }
    } catch {
      el.mediaDomain.textContent = 'Web Page';
    }
  } catch (err) {
    console.error('Error detecting active tab:', err);
    setEmptyTab();
  }
}

function setEmptyTab() {
  el.mediaTitle.textContent = 'No media detected on current tab';
  el.mediaDomain.textContent = '-';
  el.downloadBtn.disabled = true;
}

function extractYouTubeId(url) {
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  return match ? match[1] : null;
}

// Extract YouTube visitorData / session token from page
async function extractYouTubeSession(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        try {
          const cfg = window.ytcfg;
          if (!cfg) return null;
          return {
            visitorData: cfg.get('VISITOR_DATA') || null,
            innertubeApiKey: cfg.get('INNERTUBE_API_KEY') || null,
            sessionIndex: cfg.get('SESSION_INDEX') || null
          };
        } catch {
          return null;
        }
      }
    });

    if (results && results[0] && results[0].result) {
      state.extractedTokens = results[0].result;
      console.log('Extracted YouTube session data:', state.extractedTokens.visitorData ? 'OK' : 'Empty');
    }
  } catch (err) {
    // Non-fatal if script injection fails on restricted chrome:// pages
    console.debug('Session extraction notice:', err.message);
  }
}

// Check if Downloader Server is online (Auto-detect Local vs Cloud)
async function checkServerHealth() {
  // 1. If user didn't force a custom cloud URL, prioritize local instance (127.0.0.1:3000)
  try {
    const localRes = await fetch(`${LOCAL_SERVER_URL}/api/health`, { method: 'GET', signal: AbortSignal.timeout(600) });
    if (localRes.ok) {
      state.serverUrl = LOCAL_SERVER_URL;
      el.statusPill.className = 'status-pill online';
      el.statusText.textContent = 'Local (3000)';
      el.statusPill.title = 'Running locally on your machine (100% private - zero server contact)';
      return true;
    }
  } catch (err) {
    // Local instance not running, proceed to fallback
  }

  // 2. Fallback to configured cloud server
  const targetCloud = state.savedServerUrl || DEFAULT_CLOUD_URL;
  try {
    const res = await fetch(`${targetCloud}/api/health`, { method: 'GET', signal: AbortSignal.timeout(3500) });
    if (res.ok) {
      state.serverUrl = targetCloud;
      el.statusPill.className = 'status-pill online';
      el.statusText.textContent = 'Cloud';
      el.statusPill.title = `Connected to server: ${targetCloud}`;
      return true;
    }
  } catch (err) {
    // Offline
  }

  el.statusPill.className = 'status-pill offline';
  el.statusText.textContent = 'Offline';
  el.statusPill.title = `Cannot reach local (${LOCAL_SERVER_URL}) or cloud (${targetCloud})`;
  return false;
}

// Handle Download Click
async function handleDownload() {
  if (!state.currentTab || !state.currentTab.url) return;

  hideAlert();
  el.downloadBtn.disabled = true;
  el.progressCard.classList.remove('hidden');
  updateProgress(0, 'Contacting server...', 'Sending download request');

  const payload = {
    url: state.currentTab.url,
    type: state.currentMode,
    quality: state.selectedQuality,
    title: state.currentTab.title,
    bypassPassword: state.bypassPassword
  };

  // Attach extracted tokens if available
  if (state.extractedTokens && state.extractedTokens.visitorData) {
    payload.visitorData = state.extractedTokens.visitorData;
  }

  try {
    const res = await fetch(`${state.serverUrl}/api/download/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || `Server responded with status ${res.status}`);
    }

    state.activeJobId = data.jobId;
    updateProgress(5, 'Processing...', 'Queued in downloader engine');
    startPolling(data.jobId);
  } catch (err) {
    console.error('Download error:', err);
    showAlert(err.message, 'error');
    resetProgress();
  }
}

// Poll Progress
function startPolling(jobId) {
  if (state.pollTimer) clearInterval(state.pollTimer);

  state.pollTimer = setInterval(async () => {
    try {
      const res = await fetch(`${state.serverUrl}/api/download/progress/${jobId}`);
      if (!res.ok) return;

      const data = await res.json();

      if (data.status === 'downloading') {
        const percent = Math.max(5, Math.min(99, Math.round(data.percent || 0)));
        const detail = `${data.speed || ''} ${data.eta ? '• ETA: ' + data.eta : ''}`.trim() || 'Downloading stream...';
        updateProgress(percent, 'Downloading...', detail);
      } else if (data.status === 'converting') {
        updateProgress(98, 'Converting...', 'Finalizing audio/video encoding');
      } else if (data.status === 'completed') {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        updateProgress(100, 'Complete!', 'Triggering file save');

        const downloadUrl = `${state.serverUrl}/api/download/file/${jobId}`;
        
        // Trigger Chrome browser download
        if (chrome.downloads && chrome.downloads.download) {
          chrome.downloads.download({
            url: downloadUrl,
            filename: data.filename || undefined,
            saveAs: false
          });
        } else {
          // Fallback: open URL in tab
          window.open(downloadUrl, '_blank');
        }

        showAlert('Download complete! File saved to your Downloads folder.', 'success');
        setTimeout(() => resetProgress(), 4000);
      } else if (data.status === 'error') {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        throw new Error(data.error || 'Download failed on server.');
      }
    } catch (err) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
      showAlert(err.message, 'error');
      resetProgress();
    }
  }, 1000);
}

// Cancel Active Download
async function handleCancel() {
  if (!state.activeJobId) return;

  try {
    await fetch(`${state.serverUrl}/api/download/cancel/${state.activeJobId}`, { method: 'POST' });
  } catch (err) {
    console.error('Cancel request error:', err);
  }

  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
  showAlert('Download cancelled.', 'error');
  resetProgress();
}

function updateProgress(percent, status, detail) {
  el.progressPercent.textContent = `${percent}%`;
  el.progressBar.style.width = `${percent}%`;
  if (status) el.progressStatus.textContent = status;
  if (detail) el.progressDetail.textContent = detail;
}

function resetProgress() {
  el.downloadBtn.disabled = false;
  el.progressCard.classList.add('hidden');
  updateProgress(0, '', '');
  state.activeJobId = null;
}

function showAlert(msg, type = 'error') {
  el.alertMsg.textContent = msg;
  el.alertBox.className = `alert-box ${type === 'success' ? 'success' : ''}`;
  el.alertBox.classList.remove('hidden');
}

function hideAlert() {
  el.alertBox.classList.add('hidden');
}

// Settings Drawer
function toggleSettings(open) {
  el.settingsView.classList.toggle('hidden', !open);
  el.mainView.classList.toggle('hidden', open);
  hideSettingsAlert();
}

async function testConnection() {
  const testUrl = el.settingServerUrl.value.trim().replace(/\/+$/, '');
  showSettingsAlert('Testing connection...', '');

  try {
    const res = await fetch(`${testUrl}/api/health`, { method: 'GET', signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      showSettingsAlert('Connected successfully! Server is healthy.', 'success');
    } else {
      showSettingsAlert(`Server reached but returned error (${res.status}).`, 'error');
    }
  } catch (err) {
    showSettingsAlert(`Failed to connect: ${err.message}`, 'error');
  }
}

async function saveSettings() {
  const newUrl = el.settingServerUrl.value.trim().replace(/\/+$/, '') || DEFAULT_CLOUD_URL;
  const newPassword = el.settingPassword.value.trim();
  const newAutoToken = el.settingAutoToken.checked;

  chrome.storage.local.set({
    serverUrl: newUrl,
    bypassPassword: newPassword,
    autoToken: newAutoToken
  }, () => {
    state.savedServerUrl = newUrl;
    state.serverUrl = newUrl;
    state.bypassPassword = newPassword;
    state.autoToken = newAutoToken;
    showSettingsAlert('Settings saved!', 'success');
    checkServerHealth();
    setTimeout(() => toggleSettings(false), 1000);
  });
}

function showSettingsAlert(msg, type) {
  el.settingsAlert.textContent = msg;
  el.settingsAlert.className = `settings-alert ${type}`;
  el.settingsAlert.classList.remove('hidden');
}

function hideSettingsAlert() {
  el.settingsAlert.classList.add('hidden');
}
