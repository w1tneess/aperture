import crypto from 'node:crypto';
import fs from 'node:fs';
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

const flag = (value, fallback) => (value == null || value === '' ? fallback : /^(1|true|yes|on)$/i.test(value));

// PUBLIC_MODE=1 is for a shared instance anyone can open (e.g. on Render). It tightens limits and never
// uses anyone's personal cookies. Leave it off when you run Aperture just for yourself.
const publicMode = flag(process.env.PUBLIC_MODE, false);

// Render "Secret Files" are mounted here. A file with this name turns on logged-in Instagram access.
const RENDER_IG_SECRET = '/etc/secrets/instagram-cookies.txt';
const instagramCookiesSource =
  process.env.INSTAGRAM_COOKIES_FILE || (fs.existsSync(RENDER_IG_SECRET) ? RENDER_IG_SECRET : '');

// Platforms that work reliably from a cloud server. Others are blocked by the platforms themselves there.
const PUBLIC_DEFAULT_PLATFORMS = ['instagram', 'x', 'facebook', 'pinterest'];

export const config = {
  appName: 'Aperture',
  port: int(process.env.PORT, 8787),
  host: process.env.HOST || '127.0.0.1',
  isProd: process.env.NODE_ENV === 'production' || process.argv.includes('--prod'),
  publicMode,

  // Netscape-format cookies.txt for every platform. Ignored in public mode: a shared server must not act as
  // your personal account.
  cookiesFile: publicMode ? '' : process.env.COOKIES_FILE || '',
  // Cookies used for Instagram only, also in public mode. Use a throwaway account: Instagram may
  // rate-limit or challenge an account that serves many downloads.
  instagramCookiesSource,

  // Apify fallback for Instagram (no personal login needed). Token from https://console.apify.com.
  apifyToken: process.env.APIFY_TOKEN || '',
  // Each lookup costs ~$0.0027; 60/day ≈ $4.90/month, inside Apify's $5 free monthly credit.
  apifyDailyLimit: int(process.env.APIFY_DAILY_LIMIT, 60),

  // Which platforms this instance accepts. Comma-separated ids; defaults depend on PUBLIC_MODE.
  enabledPlatforms: list(process.env.ENABLED_PLATFORMS).length
    ? list(process.env.ENABLED_PLATFORMS)
    : publicMode
      ? PUBLIC_DEFAULT_PLATFORMS
      : null, // null = all

  tmpDir: process.env.TMP_DIR || path.join(os.tmpdir(), 'aperture-downloads'),
  maxConcurrent: int(process.env.MAX_CONCURRENT, publicMode ? 2 : 3),
  maxJobsPerIp: int(process.env.MAX_JOBS_PER_IP, publicMode ? 3 : 20),
  maxFilesize: process.env.MAX_FILESIZE || (publicMode ? '500M' : '2G'),
  maxDurationSec: int(process.env.MAX_DURATION_MINUTES, publicMode ? 90 : 600) * 60,
  maxItemsPerPost: int(process.env.MAX_ITEMS_PER_POST, 20),
  // Files live on the server only briefly: removed this long after creation, and soon after they're saved.
  jobTtlMs: int(process.env.JOB_TTL_MINUTES, publicMode ? 15 : 30) * 60_000,
  afterSaveTtlMs: int(process.env.AFTER_SAVE_MINUTES, publicMode ? 5 : 30) * 60_000,
  probeLimitPerMin: int(process.env.PROBE_LIMIT_PER_MIN, publicMode ? 12 : 30),

  // Keep extractors current: platforms break them often, and fixes ship within days.
  autoUpdate: flag(process.env.AUTO_UPDATE, false),
  python: process.env.PYTHON || (process.platform === 'win32' ? 'py' : 'python3'),

  passcode: process.env.APP_PASSCODE || '',
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),

  // Shown in the footer for takedown requests on a public instance (e.g. your GitHub issues URL).
  contactUrl: process.env.CONTACT_URL || '',
  repoUrl: process.env.REPO_URL || '',

  extraHosts: list(process.env.EXTRA_HOSTS),
  // Express reads a string as an IP list, so "1" must become the number 1 (= trust one proxy hop, e.g. Render).
  trustProxy: /^\d+$/.test(process.env.TRUST_PROXY || '')
    ? Number(process.env.TRUST_PROXY)
    : /^true$/i.test(process.env.TRUST_PROXY || '')
      ? true
      : process.env.TRUST_PROXY || '',
};
