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

async function api(path, init = {}) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      signal: AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${config.apifyToken}`, 'content-type': 'application/json', ...init.headers },
    });
  } catch (err) {
    // Network failure or timeout reaching Apify: a clear message instead of a generic server error.
    throw new ExtractError('UNREACHABLE', 'The Instagram backup service is unreachable right now. Try again.', undefined, `apify fetch: ${err.cause?.code || err.name}`);
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

/** Look up one Instagram post through Apify: start a run, wait for it, read its dataset. */
export async function probeApify(url) {
  if (!apifyEnabled()) throw new ExtractError('EXTRACT_FAILED', 'Couldn’t read that post.', undefined, 'apify not configured');
  budget();
  const input = { directUrls: [url], resultsType: 'details', resultsLimit: 1, addParentData: false };
  const { data: run } = await api(`/acts/${ACTOR}/runs?memory=1024&timeout=150`, { method: 'POST', body: JSON.stringify(input) });

  const deadline = Date.now() + 160_000;
  let status = run.status;
  while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
    if (Date.now() > deadline) {
      await api(`/actor-runs/${run.id}/abort`, { method: 'POST' }).catch(() => {});
      throw new ExtractError('TIMEOUT', 'Instagram took too long to respond. Try again.', undefined, 'apify run timed out');
    }
    await new Promise((r) => setTimeout(r, 2500));
    status = (await api(`/actor-runs/${run.id}`)).data.status;
  }
  if (status !== 'SUCCEEDED') throw new ExtractError('EXTRACT_FAILED', 'Couldn’t read that post.', undefined, `apify run ${status}`);

  const items = await api(`/datasets/${run.defaultDatasetId}/items?clean=0&limit=1`);
  if (!items.length) throw new ExtractError('NOT_FOUND', 'That post doesn’t exist or was deleted.', undefined, 'apify empty dataset');
  return normalizeApify(items[0]);
}

export { MEDIA_HOST };
