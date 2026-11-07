import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load the project-root .env if present. process.loadEnvFile is built into Node 20.12+, on every OS.
try {
  process.loadEnvFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env'));
} catch {
  /* no .env file: use real environment variables */
}

const int = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const list = (value) =>
  (value || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export const config = {
  port: int(process.env.PORT, 8787),
  // Loopback by default: this is a personal tool. Set HOST=0.0.0.0 to use it from your phone on the same Wi-Fi.
  host: process.env.HOST || '127.0.0.1',
  isProd: process.env.NODE_ENV === 'production' || process.argv.includes('--prod'),

  // Netscape-format cookies.txt exported from your browser. Needed for most Instagram and some Facebook/X posts.
  cookiesFile: process.env.COOKIES_FILE || '',

  tmpDir: process.env.TMP_DIR || path.join(os.tmpdir(), 'stash-downloads'),
  maxConcurrent: int(process.env.MAX_CONCURRENT, 3),
  maxFilesize: process.env.MAX_FILESIZE || '2G',
  jobTtlMs: int(process.env.JOB_TTL_MINUTES, 30) * 60_000,
  maxItemsPerPost: int(process.env.MAX_ITEMS_PER_POST, 20),

  // Optional shared passcode. Strongly recommended whenever HOST is not loopback.
  passcode: process.env.APP_PASSCODE || '',
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),

  // Extra hostnames to allow (any site yt-dlp supports, e.g. "vimeo.com,soundcloud.com").
  extraHosts: list(process.env.EXTRA_HOSTS),
  trustProxy: process.env.TRUST_PROXY || '',
};
