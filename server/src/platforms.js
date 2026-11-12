// Single source of truth for which hosts the server will touch.
// Anything not listed here (or in EXTRA_HOSTS) is rejected before any extractor runs.
export const PLATFORMS = [
  { id: 'instagram', name: 'Instagram', hosts: ['instagram.com', 'instagr.am'], images: true },
  { id: 'x', name: 'X', hosts: ['x.com', 'twitter.com', 'fxtwitter.com', 'vxtwitter.com'], images: true },
  { id: 'facebook', name: 'Facebook', hosts: ['facebook.com', 'fb.watch', 'fb.com'], images: true },
  { id: 'tiktok', name: 'TikTok', hosts: ['tiktok.com'], images: true },
  { id: 'youtube', name: 'YouTube', hosts: ['youtube.com', 'youtu.be'], images: false },
  { id: 'threads', name: 'Threads', hosts: ['threads.net', 'threads.com'], images: true },
  { id: 'reddit', name: 'Reddit', hosts: ['reddit.com', 'redd.it'], images: true },
  { id: 'pinterest', name: 'Pinterest', hosts: ['pinterest.com', 'pin.it'], images: true },
];

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`]+/i;

/** Pull the first http(s) link out of pasted text like "look at this https://… 🔥". */
export function extractUrl(text) {
  const match = String(text ?? '').match(URL_IN_TEXT);
  return match ? match[0].replace(/[),.;!?]+$/, '') : null;
}

function hostMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/**
 * Validate and classify a pasted link.
 * @returns {{ url: string, platform: string, images: boolean } | { error: string }}
 */
export function resolveUrl(input, extraHosts = [], enabled = null) {
  const raw = extractUrl(input);
  if (!raw) return { error: 'Paste a link that starts with http:// or https://.' };

  let url;
  try {
    url = new URL(raw);
  } catch {
    return { error: 'That doesn’t look like a valid link.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { error: 'Only http and https links are supported.' };
  }
  if (url.username || url.password) {
    return { error: 'Links with embedded credentials are not allowed.' };
  }

  const hostname = url.hostname.toLowerCase();
  const platform = PLATFORMS.find((p) => p.hosts.some((h) => hostMatches(hostname, h)));
  if (platform) {
    if (enabled && !enabled.includes(platform.id)) {
      return { error: `${platform.name} isn’t supported here. It blocks downloads from this server.` };
    }
    return { url: url.toString(), platform: platform.id, images: platform.images };
  }

  if (extraHosts.some((h) => hostMatches(hostname, h))) {
    return { url: url.toString(), platform: 'other', images: false };
  }
  return { error: 'That site isn’t on the supported list.' };
}

// Takedowns: a link is blocked when it contains any BLOCKED_LINKS entry (best as a bare post id: matches /p/ and /reel/, x.com and twitter.com).
// shortcut: short links (pin.it, fb.watch, t.co) are checked before redirects, so they slip past; resolve them first if that gets abused.
export const isBlocked = (url, blocked = []) => blocked.some((b) => url.toLowerCase().includes(b));
