import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

// Per-platform cookie files actually passed to the extractors.
let instagramCookies = '';

/**
 * Secret files (e.g. Render's /etc/secrets) are read-only, but yt-dlp and gallery-dl write refreshed
 * cookies back to their cookie file. Work on a private writable copy instead.
 */
export async function initCookies() {
  const src = config.instagramCookiesSource;
  if (!src) return;
  try {
    const text = await fs.readFile(src, 'utf8');
    if (!/sessionid/i.test(text)) {
      console.warn('✗ Instagram cookies file has no "sessionid": export it while logged in to instagram.com.');
      return;
    }
    const dir = path.join(config.tmpDir, 'aperture-cookies');
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    instagramCookies = path.join(dir, 'instagram.txt');
    await fs.writeFile(instagramCookies, text, { mode: 0o600 });
    console.log('✓ Instagram login cookies loaded (Instagram requests only)');
  } catch (err) {
    console.warn(`✗ Couldn't read Instagram cookies (${src}): ${err.code || err.message}`);
  }
}

/** Cookie file for a given platform, or '' for none. */
export function cookiesFor(platform) {
  if (platform === 'instagram' && instagramCookies) return instagramCookies;
  return config.cookiesFile; // private-mode global cookies ('' in public mode)
}

export const hasInstagramLogin = () => Boolean(instagramCookies || (!config.publicMode && config.cookiesFile));
