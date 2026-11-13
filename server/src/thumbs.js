/**
 * Preview images, fetched once per upstream URL. The probe route starts these as soon as a post is read,
 * so the image is usually ready by the time the browser asks for it instead of costing another round trip
 * to the platform's CDN.
 */
const MAX_BYTES = 15 * 1024 * 1024; // one image
const BUDGET_BYTES = 64 * 1024 * 1024; // everything cached
const TTL_MS = 30 * 60_000;
const cache = new Map(); // url -> { at, size, promise }, oldest first
let total = 0;

async function download(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'user-agent': 'Mozilla/5.0 (Aperture personal downloader)' },
    });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.startsWith('image/') || Number(res.headers.get('content-length') || 0) > MAX_BYTES) return null;
    const body = Buffer.from(await res.arrayBuffer());
    return body.length > MAX_BYTES ? null : { type, body };
  } catch {
    return null;
  }
}

function drop(url) {
  const entry = cache.get(url);
  if (!entry) return;
  total -= entry.size;
  cache.delete(url);
}

/** Resolves to { type, body }, or null when the image can't be fetched. Never rejects. */
export function thumbnail(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  drop(url);
  const entry = { at: Date.now(), size: 0, promise: null };
  entry.promise = download(url).then((img) => {
    if (cache.get(url) !== entry) return img; // evicted while downloading
    if (!img) {
      cache.delete(url); // failures aren't cached: the next request tries again
      return null;
    }
    entry.size = img.body.length;
    total += entry.size;
    for (const key of cache.keys()) {
      if (total <= BUDGET_BYTES) break;
      if (key !== url) drop(key);
    }
    return img;
  });
  cache.set(url, entry);
  return entry.promise;
}
