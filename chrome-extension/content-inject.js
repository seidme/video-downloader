// Injected into companion web app pages to announce extension readiness
try {
  document.documentElement.setAttribute('data-extension-installed', 'true');
  window.postMessage({ type: 'VIDEO_DOWNLOADER_EXTENSION_READY', version: '1.0.0' }, '*');
} catch (e) {
  // Ignore
}
