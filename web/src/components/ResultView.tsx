import { useState } from 'react'
import type { MediaItem, Probe } from '../lib/api'
import { formatDuration, summarizeItems } from '../lib/format'
import { platformName } from '../lib/platforms'
import { pickOptionId, type Settings } from '../lib/settings'
import { Icon } from './Icon'
import { QualityPicker, QualitySelect } from './QualityPicker'
import { Thumb } from './Thumb'

type Props = {
  probe: Probe
  settings: Settings
  onDownload: (item: MediaItem, optionId: string) => void
  onCopy: (url: string) => void
}

function Meta({ probe }: { probe: Probe }) {
  const parts = [platformName(probe.platform), probe.uploader && `@${probe.uploader.replace(/^@/, '')}`]
  const duration = probe.items.length === 1 ? formatDuration(probe.items[0].duration ?? probe.duration) : ''
  if (duration) parts.push(duration)
  if (probe.items.length > 1) parts.push(summarizeItems(probe.items))
  return <p className="eyebrow">{parts.filter(Boolean).join(' · ')}</p>
}

export function ResultView({ probe, settings, onDownload, onCopy }: Props) {
  const [choice, setChoice] = useState<Record<number, string>>(() =>
    Object.fromEntries(probe.items.map((item) => [item.index, pickOptionId(item, settings)])),
  )
  const select = (index: number) => (id: string) => setChoice((c) => ({ ...c, [index]: id }))

  if (probe.items.length === 1) {
    const item = probe.items[0]
    return (
      <article className="result" aria-labelledby="result-title">
        <Thumb item={item} label={`Preview of ${probe.title}`} />
        <div className="result-body">
          <Meta probe={probe} />
          <h2 id="result-title" className="result-title">
            {probe.title}
          </h2>
          <QualityPicker
            item={item}
            name={`quality-${probe.probeId}`}
            selected={choice[item.index]}
            audioFormat={settings.audioFormat}
            onSelect={select(item.index)}
          />
          <div className="result-actions">
            <button className="btn btn-primary btn-lg" onClick={() => onDownload(item, choice[item.index])}>
              <Icon name="download" /> Download
            </button>
            <button className="btn btn-ghost btn-lg" onClick={() => onCopy(probe.url)}>
              <Icon name="link" /> Copy link
            </button>
          </div>
        </div>
      </article>
    )
  }

  return (
    <article className="result result-gallery" aria-labelledby="result-title">
      <header className="gallery-head">
        <div>
          <Meta probe={probe} />
          <h2 id="result-title" className="result-title">
            {probe.title}
          </h2>
        </div>
        <div className="result-actions">
          <button
            className="btn btn-primary"
            onClick={() => probe.items.forEach((item) => onDownload(item, choice[item.index]))}
          >
            <Icon name="download" /> Download all {probe.items.length}
          </button>
          <button className="btn btn-ghost" onClick={() => onCopy(probe.url)}>
            <Icon name="link" /> Copy link
          </button>
        </div>
      </header>
      <ol className="tiles">
        {probe.items.map((item) => (
          <li key={item.index} className="tile">
            <Thumb item={item} fit="cover" label={`Item ${item.index + 1}`} />
            <div className="tile-foot">
              <span className="mono tile-num">{String(item.index + 1).padStart(2, '0')}</span>
              <QualitySelect
                item={item}
                selected={choice[item.index]}
                audioFormat={settings.audioFormat}
                onSelect={select(item.index)}
                label={`Quality for item ${item.index + 1}`}
              />
              <button
                className="btn-icon btn-ghost"
                aria-label={`Download item ${item.index + 1}`}
                onClick={() => onDownload(item, choice[item.index])}
              >
                <Icon name="download" />
              </button>
            </div>
          </li>
        ))}
      </ol>
    </article>
  )
}

export function ResultSkeleton() {
  return (
    <div className="result skeleton" aria-busy="true" aria-label="Reading post">
      <div className="sk sk-thumb" />
      <div className="result-body">
        <div className="sk sk-line" style={{ width: '40%' }} />
        <div className="sk sk-line sk-title" />
        <div className="sk sk-line" style={{ width: '70%' }} />
        <div className="sk sk-block" />
      </div>
    </div>
  )
}
