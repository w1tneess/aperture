import { execFile } from 'node:child_process';
import { config } from './config.js';
import { resolveTools } from './tools.js';

const DAY = 24 * 60 * 60_000;

/** pip install -U the extractors, then re-detect them. Failures are logged, never fatal. */
export function updateExtractors() {
  return new Promise((resolve) => {
    const args = ['-m', 'pip', 'install', '-U', '--disable-pip-version-check', '-q', 'yt-dlp[default]', 'gallery-dl'];
    execFile(config.python, args, { timeout: 5 * 60_000, windowsHide: true }, async (err, _out, stderr) => {
      if (err) {
        console.warn('[update] extractor update failed:', String(stderr || err.message).trim().split('\n').at(-1));
        return resolve(false);
      }
      await resolveTools();
      resolve(true);
    });
  });
}

/** With AUTO_UPDATE=1: update shortly after start, then once a day. Platforms break extractors often. */
export function startAutoUpdate() {
  if (!config.autoUpdate) return;
  setTimeout(() => void updateExtractors(), 10_000).unref();
  setInterval(() => void updateExtractors(), DAY).unref();
}
