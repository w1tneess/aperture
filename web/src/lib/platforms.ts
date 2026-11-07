// Mirrors server/src/platforms.js for instant feedback while typing. The server re-validates everything.
export const PLATFORMS = [
  { id: 'instagram', name: 'Instagram', hosts: ['instagram.com', 'instagr.am'] },
  { id: 'x', name: 'X', hosts: ['x.com', 'twitter.com', 'fxtwitter.com', 'vxtwitter.com'] },
  { id: 'facebook', name: 'Facebook', hosts: ['facebook.com', 'fb.watch', 'fb.com'] },
  { id: 'tiktok', name: 'TikTok', hosts: ['tiktok.com'] },
  { id: 'youtube', name: 'YouTube', hosts: ['youtube.com', 'youtu.be'] },
  { id: 'threads', name: 'Threads', hosts: ['threads.net', 'threads.com'] },
  { id: 'reddit', name: 'Reddit', hosts: ['reddit.com', 'redd.it'] },
  { id: 'pinterest', name: 'Pinterest', hosts: ['pinterest.com', 'pin.it'] },
] as const

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi

const clean = (u: string) => u.replace(/[),.;!?]+$/, '')

export function extractUrls(text: string): string[] {
  return [...new Set((text.match(URL_RE) ?? []).map(clean))]
}

export function extractUrl(text: string): string | null {
  return extractUrls(text)[0] ?? null
}

/** Returns a platform id, 'other' for a link on an unknown site, or null when there's no link at all. */
export function detectPlatform(text: string): string | null {
  const raw = extractUrl(text)
  if (!raw) return null
  try {
    const host = new URL(raw).hostname.toLowerCase()
    const hit = PLATFORMS.find((p) => p.hosts.some((h) => host === h || host.endsWith(`.${h}`)))
    return hit?.id ?? 'other'
  } catch {
    return null
  }
}

export const platformName = (id: string) => PLATFORMS.find((p) => p.id === id)?.name ?? 'Link'
