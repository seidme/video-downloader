#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const url = args.find(a => !a.startsWith('-'));

if (!url) {
  console.log(`
\x1b[36m====================================================\x1b[0m
\x1b[1m\x1b[35m🎬 Universal Video & Audio Downloader CLI\x1b[0m
\x1b[36m====================================================\x1b[0m

\x1b[33mUsage:\x1b[0m
  node cli.js "<URL>" [options]

\x1b[33mOptions:\x1b[0m
  --audio, -a         Extract and convert to MP3 audio
  --quality <res>     Video resolution: 1080, 720, 480, 360, best (default: best)
  --output, -o <dir>  Destination directory (default: ./downloads)
  --help, -h          Show this help message

\x1b[33mSupported Sites:\x1b[0m
  YouTube, TikTok, Twitter/X, Instagram, Vimeo, Reddit, Twitch, Facebook,
  SoundCloud, Dailymotion, Bilibili, and 1,800+ more platforms.

\x1b[33mExamples:\x1b[0m
  node cli.js "https://www.youtube.com/watch?v=..."
  node cli.js "https://www.tiktok.com/@user/video/..."
  node cli.js "https://twitter.com/user/status/..." --audio
  node cli.js "https://www.youtube.com/watch?v=..." --quality 1080
`);
  process.exit(0);
}

const isAudio = args.includes('--audio') || args.includes('-a');
const qualityIdx = args.indexOf('--quality');
const quality = qualityIdx !== -1 && args[qualityIdx + 1] ? args[qualityIdx + 1] : 'best';

const outDirIdx = args.indexOf('--output') !== -1 ? args.indexOf('--output') : args.indexOf('-o');
const outDir = outDirIdx !== -1 && args[outDirIdx + 1] ? path.resolve(args[outDirIdx + 1]) : path.join(__dirname, 'downloads');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

function getBin(name) {
  const p = `/opt/homebrew/bin/${name}`;
  return fs.existsSync(p) ? p : name;
}

const YTDLP = getBin('yt-dlp');
const FFMPEG = getBin('ffmpeg');

console.log(`\n\x1b[34m[INFO]\x1b[0m Target: \x1b[1m${url}\x1b[0m`);
console.log(`\x1b[34m[INFO]\x1b[0m Mode: \x1b[32m${isAudio ? 'Audio Only (MP3)' : `Video (${quality})`}\x1b[0m`);
console.log(`\x1b[34m[INFO]\x1b[0m Output folder: \x1b[33m${outDir}\x1b[0m\n`);

const cmdArgs = [
  '--no-playlist',
  '--ffmpeg-location', FFMPEG,
  '-P', outDir,
  '-o', '%(title)s [%(id)s].%(ext)s'
];

if (isAudio) {
  cmdArgs.push('-x', '--audio-format', 'mp3', '--audio-quality', '320k');
} else {
  let formatFilter = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
  if (['1080', '720', '480', '360'].includes(quality)) {
    formatFilter = `bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${quality}][ext=mp4]/best`;
  }
  cmdArgs.push('-f', formatFilter, '--merge-output-format', 'mp4');
}

cmdArgs.push(url);

const env = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` };
const proc = spawn(YTDLP, cmdArgs, { stdio: 'inherit', env });

proc.on('close', code => {
  if (code === 0) {
    console.log(`\n\x1b[32m✓ Download completed successfully!\x1b[0m Files saved in: ${outDir}\n`);
  } else {
    console.error(`\n\x1b[31m✗ Download exited with code ${code}\x1b[0m\n`);
    process.exit(code);
  }
});
