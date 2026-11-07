import type { MediaItem } from './api'

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return ''
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export function timeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`
  return new Date(ts).toLocaleDateString()
}

export function summarizeItems(items: MediaItem[]): string {
  const photos = items.filter((i) => i.kind === 'image').length
  const videos = items.length - photos
  const parts = []
  if (videos) parts.push(`${videos} video${videos > 1 ? 's' : ''}`)
  if (photos) parts.push(`${photos} photo${photos > 1 ? 's' : ''}`)
  return parts.join(', ')
}
