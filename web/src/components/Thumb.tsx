import { useState } from 'react'
import type { MediaItem } from '../lib/api'
import { formatDuration } from '../lib/format'
import { Icon } from './Icon'

type Props = { item: MediaItem; fit?: 'contain' | 'cover'; label: string }

/**
 * Preview image. In "contain" mode the frame shrinks to the image itself, so a vertical reel shows as a
 * tall card instead of a narrow strip inside a wide grey box. Until the image loads, a 16:9 placeholder
 * (or the known aspect ratio) holds the space so the layout doesn't jump.
 */
export function Thumb({ item, fit = 'contain', label }: Props) {
  const [broken, setBroken] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const ratio = item.width && item.height ? `${item.width} / ${item.height}` : '16 / 9'
  const kindIcon = item.kind === 'image' ? 'image' : item.kind === 'audio' ? 'music' : 'play'
  const showImage = Boolean(item.thumbnail) && !broken
  const sized = fit === 'contain' && showImage && loaded

  return (
    <div
      className={`thumb thumb-${fit}${sized ? ' is-sized' : ''}`}
      style={fit === 'contain' && !sized ? { aspectRatio: ratio } : undefined}
    >
      {showImage ? (
        <img
          src={item.thumbnail ?? undefined}
          alt={label}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="thumb-empty" role="img" aria-label={`${label} (no preview)`}>
          <Icon name={kindIcon} size={28} />
        </div>
      )}
      <span className="thumb-badge">
        <Icon name={kindIcon} size={12} />
        {item.kind === 'image' ? 'Photo' : formatDuration(item.duration) || 'Video'}
      </span>
    </div>
  )
}
