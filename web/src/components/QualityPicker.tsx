import type { MediaItem } from '../lib/api'
import { formatBytes } from '../lib/format'

type Props = {
  item: MediaItem
  name: string
  selected: string
  audioFormat: string
  onSelect: (id: string) => void
}

const extFor = (id: string, ext: string, audioFormat: string) => (id === 'audio' ? audioFormat : ext).toUpperCase()

export function QualityPicker({ item, name, selected, audioFormat, onSelect }: Props) {
  if (item.options.length === 1) {
    const only = item.options[0]
    return (
      <p className="quality-single">
        <span>{only.label}</span>
        <span className="mono">{extFor(only.id, only.ext, audioFormat)}</span>
        {only.sizeBytes ? <span className="mono">{formatBytes(only.sizeBytes)}</span> : null}
      </p>
    )
  }

  return (
    <fieldset className="quality">
      <legend className="eyebrow">Quality</legend>
      {item.options.map((o) => (
        <label key={o.id} className="quality-row">
          <input
            type="radio"
            name={name}
            value={o.id}
            checked={selected === o.id}
            onChange={() => onSelect(o.id)}
          />
          <span className="quality-dot" aria-hidden="true" />
          <span className="quality-label">{o.label}</span>
          <span className="quality-meta mono">{extFor(o.id, o.ext, audioFormat)}</span>
          <span className="quality-meta mono quality-size">{o.sizeBytes ? `~${formatBytes(o.sizeBytes)}` : ''}</span>
        </label>
      ))}
    </fieldset>
  )
}

/** Compact variant for gallery tiles. */
export function QualitySelect({ item, selected, audioFormat, onSelect, label }: Omit<Props, 'name'> & { label: string }) {
  if (item.options.length < 2) {
    return <span className="mono tile-ext">{extFor(item.options[0]?.id ?? '', item.options[0]?.ext ?? '', audioFormat)}</span>
  }
  return (
    <select className="tile-select" aria-label={label} value={selected} onChange={(e) => onSelect(e.target.value)}>
      {item.options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
