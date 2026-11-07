import type { MediaItem } from './api'

export type Quality = 'best' | '1080' | '720' | '480' | 'audio'

export type Settings = {
  quality: Quality
  audioFormat: 'mp3' | 'm4a'
  autoFetch: boolean
  quickMode: boolean
  keepHistory: boolean
  theme: 'system' | 'light' | 'dark'
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'best',
  audioFormat: 'mp3',
  autoFetch: true,
  quickMode: false,
  keepHistory: true,
  theme: 'system',
}

// Explicit order: integer-like keys ('720') would otherwise sort before 'best' in Object.keys.
export const QUALITY_ORDER: Quality[] = ['best', '1080', '720', '480', 'audio']

export const QUALITY_LABELS: Record<Quality, string> = {
  best: 'Best',
  '1080': '1080p',
  '720': '720p',
  '480': '480p',
  audio: 'Audio only',
}

/** Turn an option shown in the UI into the id the server expects (audio carries the chosen format). */
export function toJobOption(optionId: string, settings: Settings): string {
  return optionId === 'audio' && settings.audioFormat === 'm4a' ? 'audio:m4a' : optionId
}

/** Choose the option that best matches the user's default quality for one item. */
export function pickOptionId(item: MediaItem, settings: Settings): string {
  const opts = item.options
  if (!opts.length) return 'best'
  if (opts.length === 1) return opts[0].id
  if (settings.quality === 'audio') return opts.some((o) => o.id === 'audio') ? 'audio' : opts[0].id
  if (settings.quality === 'best') return opts[0].id

  const cap = Number(settings.quality)
  const sized = opts.filter((o) => o.res != null).sort((a, b) => (b.res ?? 0) - (a.res ?? 0))
  if (!sized.length) return opts[0].id
  return (sized.find((o) => (o.res ?? 0) <= cap) ?? sized[sized.length - 1]).id
}
