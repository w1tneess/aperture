import { config } from './config.js';
import { ExtractError } from './extract.js';

// Fallback for Instagram: Apify's official scraper (apify/instagram-scraper) runs on Apify's own
// infrastructure, so no personal Instagram login is needed. Priced per result; used only when the free
// path fails. https://apify.com/apify/instagram-scraper
const API = 'https://api.apify.com/v2';
const ACTOR = 'apify~instagram-scraper';

// Media URLs Apify returns must point at Instagram/Meta CDNs. Anything else is refused, so a bad response
// can never make this server fetch an arbitrary host.
const MEDIA_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;

let day = '';
let usedToday = 0;

export const apifyEnabled = () => Boolean(config.apifyToken);

function budget() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    usedToday = 0;
  }
  if (usedToday >= config.apifyDailyLimit) {
    throw new ExtractError('BUSY', 'Instagram backup is at today’s limit. Try again tomorrow.', undefined, 'apify daily limit reached');
  }
  usedToday++;
}

async function api(path, init = {}, timeoutMs = 30_000) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      headers: { authorization: `Bearer ${config.apifyToken}`, 'content-type': 'application/json', ...init.headers },
    });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      throw new ExtractError('TIMEOUT', 'Instagram took too long to respond. Try again.', undefined, 'apify request timed out');
    }
    // Network failure reaching Apify: a clear message instead of a generic server error.
    throw new ExtractError('UNREACHABLE', 'The Instagram backup service is unreachable right now. Try again.', undefined, `apify fetch: ${err.cause?.code || err.name}`);
  }
  if (res.status === 408) {
    throw new ExtractError('TIMEOUT', 'Instagram took too long to respond. Try again.', undefined, 'apify run exceeded sync limit');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ExtractError('EXTRACT_FAILED', 'Instagram backup service failed.', undefined, `apify ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function safeMedia(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && MEDIA_HOST.test(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}

function toItem(node, index) {
  const isVideo = node.type === 'Video' || Boolean(node.videoUrl);
  const mediaUrl = safeMedia(isVideo ? node.videoUrl : node.displayUrl);
  if (!mediaUrl) return null;
  const options = isVideo
    ? [
        { id: 'original', label: 'Original', ext: 'mp4', res: null, sizeBytes: null },
        { id: 'audio', label: 'Audio only', ext: 'mp3', res: null, sizeBytes: null },
      ]
    : [{ id: 'original', label: 'Original', ext: 'jpg', res: null, sizeBytes: null }];
  return {
    source: 'direct',
    selector: index + 1,
    mediaUrl,
    kind: isVideo ? 'video' : 'image',
    thumbnailUrl: safeMedia(node.displayUrl),
    previewUrl: isVideo ? mediaUrl : null,
    duration: node.videoDuration ?? null,
    width: node.dimensionsWidth ?? null,
    height: node.dimensionsHeight ?? null,
    options,
  };
}

/** Normalize one apify/instagram-scraper "details" result into Aperture's probe shape. */
export function normalizeApify(post) {
  if (post?.error) {
    if (post.error === 'not_found') throw new ExtractError('NOT_FOUND', 'That post doesn’t exist or was deleted.', undefined, 'apify not_found');
    if (/private|restricted/i.test(`${post.error} ${post.errorDescription}`)) {
      throw new ExtractError('PRIVATE', 'That post is private. Only public posts can be downloaded here.', undefined, `apify ${post.error}`);
    }
    throw new ExtractError('EXTRACT_FAILED', 'Couldn’t read that post.', undefined, `apify ${post.error}: ${post.errorDescription || ''}`);
  }
  const nodes = post.type === 'Sidecar' && post.childPosts?.length ? post.childPosts : [post];
  const items = nodes.map(toItem).filter(Boolean).slice(0, config.maxItemsPerPost);
  if (!items.length) throw new ExtractError('NO_VIDEO', 'No downloadable media found in that post.', undefined, 'apify returned no media');
  return {
    title: String(post.caption || '').split('\n')[0].slice(0, 160) || 'Instagram post',
    uploader: post.ownerUsername || null,
    duration: items.length === 1 ? items[0].duration : null,
    items,
  };
}

/**
 * Look up one Instagram post through Apify in a single request: run-sync-get-dataset-items starts the run,
 * waits for it and returns its dataset, so there's no status polling adding up to 2.5 s per lookup.
 * https://docs.apify.com/api/v2/act-run-sync-get-dataset-items-post
 */
export async function probeApify(url) {
  if (!apifyEnabled()) throw new ExtractError('EXTRACT_FAILED', 'Couldn’t read that post.', undefined, 'apify not configured');
  budget();
  const input = { directUrls: [url], resultsType: 'details', resultsLimit: 1, addParentData: false };
  // 4096 MB = one full CPU core (1024 was a quarter), so the run starts and scrapes faster. This actor is
  // paid per result with platform usage included, so memory costs nothing; the free plan's 16 GB cap still
  // allows 4 lookups at once.
  const items = await api(
    `/acts/${ACTOR}/run-sync-get-dataset-items?memory=4096&timeout=150&clean=0&limit=1`,
    { method: 'POST', body: JSON.stringify(input) },
    170_000,
  );
  if (!Array.isArray(items) || !items.length) throw new ExtractError('NOT_FOUND', 'That post doesn’t exist or was deleted.', undefined, 'apify empty dataset');
  return normalizeApify(items[0]);
}

export { MEDIA_HOST };
