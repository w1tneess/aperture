import { useState } from 'react'
import type { MediaItem } from '../lib/api'
import { formatDuration } from '../lib/format'
import { Icon } from './Icon'

type Props = { item: MediaItem; fit?: 'contain' | 'cover'; label: string }

/**
 * Preview image. In "contain" mode the frame shrinks to the image itself, so a vertical reel shows as a
 * tall card instead of a narrow strip inside a wide grey box. Until the image loads, a 16:9 placeholder
 * (or the known aspect ratio) holds the space so the layout doesn't jump. Videos with a preview get a
 * play button that swaps the image for a player in the same frame; nothing streams until it's pressed.
 */
export function Thumb({ item, fit = 'contain', label }: Props) {
  const [broken, setBroken] = useState(false)
  const [loaded, setLoaded] = useState<string | null>(null) // the image's own aspect ratio once loaded
  const [playing, setPlaying] = useState(false)
  const [noPreview, setNoPreview] = useState(false)
  const ratio = loaded ?? (item.width && item.height ? `${item.width} / ${item.height}` : '16 / 9')
  const kindIcon = item.kind === 'image' ? 'image' : item.kind === 'audio' ? 'music' : 'play'
  const showImage = Boolean(item.thumbnail) && !broken
  const sized = fit === 'contain' && showImage && Boolean(loaded) && !playing
  const canPlay = Boolean(item.preview) && !noPreview
  // While playing, the frame keeps the image's shape and size (460px cap, as in styles.css) so a tall reel
  // doesn't turn into a wide black box.
  const frame =
    fit !== 'contain' || sized
      ? undefined
      : playing
        ? { aspectRatio: ratio, width: `min(100%, calc(460px * ${ratio}))`, marginInline: 'auto' }
        : { aspectRatio: ratio }

  return (
    <div className={`thumb thumb-${fit}${sized ? ' is-sized' : ''}${playing ? ' is-playing' : ''}`} style={frame}>
      {playing && item.preview ? (
        <video
          src={item.preview}
          poster={item.thumbnail ?? undefined}
          controls
          autoPlay
          playsInline
          preload="auto"
          aria-label={label}
          onError={() => {
            setPlaying(false)
            setNoPreview(true)
          }}
        />
      ) : showImage ? (
        <img
          src={item.thumbnail ?? undefined}
          alt={label}
          // The single-result preview is the first thing on screen: load it right away. Gallery tiles stay lazy.
          loading={fit === 'contain' ? 'eager' : 'lazy'}
          fetchPriority={fit === 'contain' ? 'high' : 'auto'}
          decoding="async"
          onLoad={(e) => setLoaded(`${e.currentTarget.naturalWidth} / ${e.currentTarget.naturalHeight}`)}
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="thumb-empty" role="img" aria-label={`${label} (no preview)`}>
          <Icon name={kindIcon} size={28} />
        </div>
      )}
      {canPlay && !playing && (
        <button type="button" className="thumb-play" aria-label={`Play ${label}`} onClick={() => setPlaying(true)}>
          <Icon name="play" size={fit === 'contain' ? 28 : 22} />
        </button>
      )}
      {!playing && (
        <span className="thumb-badge">
          <Icon name={kindIcon} size={12} />
          {item.kind === 'image' ? 'Photo' : formatDuration(item.duration) || 'Video'}
        </span>
      )}
    </div>
  )
}
