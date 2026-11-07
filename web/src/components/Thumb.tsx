import { useState } from 'react'
import type { MediaItem } from '../lib/api'
import { formatDuration } from '../lib/format'
import { Icon } from './Icon'

type Props = { item: MediaItem; fit?: 'contain' | 'cover'; label: string }

export function Thumb({ item, fit = 'contain', label }: Props) {
  const [broken, setBroken] = useState(false)
  const ratio = item.width && item.height ? `${item.width} / ${item.height}` : undefined
  const kindIcon = item.kind === 'image' ? 'image' : item.kind === 'audio' ? 'music' : 'play'

  return (
    <div className={`thumb thumb-${fit}`} style={fit === 'contain' && ratio ? { aspectRatio: ratio } : undefined}>
      {item.thumbnail && !broken ? (
        <img src={item.thumbnail} alt={label} loading="lazy" decoding="async" onError={() => setBroken(true)} />
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
