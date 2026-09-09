import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
];

/**
 * Fetches an anonymous, isolated incognito guest session from YouTube
 * and formats it as a Netscape HTTP Cookie file string.
 */
export async function generateGuestCookieSession(index = 1) {
  const ua = USER_AGENTS[(index - 1) % USER_AGENTS.length];

  const res = await fetch('https://www.youtube.com', {
    headers: {
      'User-Agent': ua,
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none'
    }
  });

  const rawSetCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const cookiesMap = new Map();

  // Pre-set GDPR cookie consent so YouTube skips the European consent interstitial
  const oneYearFromNow = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  cookiesMap.set('SOCS', {
    domain: '.youtube.com',
    path: '/',
    secure: true,
    expires: oneYearFromNow,
    value: 'CAESEwgDEgk2OTk4OTAzNDQaAmVuIAEaBgiA_L20Bg'
  });

  for (const raw of rawSetCookies) {
    const parts = raw.split(';').map(p => p.trim());
    const [nameVal, ...attrs] = parts;
    const eqIdx = nameVal.indexOf('=');
    if (eqIdx === -1) continue;

    const name = nameVal.substring(0, eqIdx);
    const value = nameVal.substring(eqIdx + 1);
    if (!value) continue;

    let domain = '.youtube.com';
    let pathVal = '/';
    let secure = true;
    let expires = oneYearFromNow;

    for (const attr of attrs) {
      const lower = attr.toLowerCase();
      if (lower.startsWith('domain=')) {
        domain = attr.substring(7).trim();
        if (!domain.startsWith('.')) domain = '.' + domain;
      } else if (lower.startsWith('path=')) {
        pathVal = attr.substring(5).trim();
      } else if (lower.startsWith('expires=')) {
        const expDate = new Date(attr.substring(8).trim());
        if (!isNaN(expDate.getTime())) {
          expires = Math.floor(expDate.getTime() / 1000);
        }
      }
    }

    cookiesMap.set(name, { domain, path: pathVal, secure, expires, value });
  }

  const lines = [
    '# Netscape HTTP Cookie File',
    '# https://curl.se/docs/http-cookies.html',
    `# Anonymous Incognito Guest Session #${index} - Generated at ${new Date().toISOString()}`,
    ''
  ];

  for (const [name, c] of cookiesMap.entries()) {
    lines.push(`${c.domain}\tTRUE\t${c.path}\t${c.secure ? 'TRUE' : 'FALSE'}\t${c.expires}\t${name}\t${c.value}`);
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate N guest cookie files and save them to target directory
 */
export async function exportMultipleGuestCookies(count = 5, targetDir = path.join(__dirname, 'data', 'cookies')) {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  console.log(`🍪 Generating ${count} incognito guest cookie session files in "${targetDir}"...`);
  const generatedFiles = [];

  for (let i = 1; i <= count; i++) {
    try {
      const content = await generateGuestCookieSession(i);
      const filePath = path.join(targetDir, `cookies_${i}.txt`);
      fs.writeFileSync(filePath, content, 'utf-8');
      generatedFiles.push(filePath);
      console.log(`  ✓ Created [${i}/${count}]: ${path.basename(filePath)}`);
      // Small pause between requests
      if (i < count) await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`  ✗ Error creating session #${i}:`, err.message);
    }
  }

  console.log(`✨ Successfully created ${generatedFiles.length} cookie file(s) for random rotation.`);
  return generatedFiles;
}

// CLI runner
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const count = parseInt(process.argv[2], 10) || 5;
  exportMultipleGuestCookies(count).catch(err => {
    console.error('Failed to export cookies:', err);
    process.exit(1);
  });
}
