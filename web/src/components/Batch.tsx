import { useState } from 'react'
import { api, ApiError, type Probe } from '../lib/api'
import { detectPlatform, extractUrls, platformName } from '../lib/platforms'
import { QUALITY_LABELS, type Settings } from '../lib/settings'
import { Icon } from './Icon'

type Row = { url: string; state: 'waiting' | 'reading' | 'queued' | 'error'; note?: string }

type Props = {
  settings: Settings
  onProbe: (probe: Probe) => Promise<number>
}

const CONCURRENCY = 2

export function Batch({ settings, onProbe }: Props) {
  const [text, setText] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [running, setRunning] = useState(false)

  const urls = extractUrls(text)
  const supported = urls.filter((u) => {
    const p = detectPlatform(u)
    return p && p !== 'other'
  })

  const setRow = (url: string, patch: Partial<Row>) =>
    setRows((list) => list.map((r) => (r.url === url ? { ...r, ...patch } : r)))

  async function runAll() {
    if (!supported.length) return
    setRunning(true)
    setRows(supported.map((url) => ({ url, state: 'waiting' })))
    const queue = [...supported]

    const worker = async () => {
      for (let url = queue.shift(); url; url = queue.shift()) {
        setRow(url, { state: 'reading' })
        try {
          const probe = await api.probe(url)
          const count = await onProbe(probe)
          setRow(url, { state: 'queued', note: `${probe.title} · ${count} file${count === 1 ? '' : 's'}` })
        } catch (err) {
          setRow(url, { state: 'error', note: err instanceof ApiError ? err.message : 'Failed.' })
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    setRunning(false)
  }

  return (
    <section aria-labelledby="batch-heading">
      <div className="view-head">
        <h1 id="batch-heading" className="view-title">
          Batch
        </h1>
      </div>
      <p className="lead">
        Paste several links (one per line, or a whole chat message). Each post downloads at your default quality:{' '}
        <strong>{QUALITY_LABELS[settings.quality]}</strong>.
      </p>

      <label htmlFor="batch-input" className="visually-hidden">
        Links to download
      </label>
      <textarea
        id="batch-input"
        className="batch-input"
        rows={7}
        spellCheck={false}
        placeholder={'https://www.instagram.com/p/…\nhttps://x.com/…/status/…\nhttps://www.tiktok.com/@…/video/…'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="batch-bar">
        <p className="mono hint-inline" role="status">
          {urls.length
            ? `${supported.length} of ${urls.length} link${urls.length === 1 ? '' : 's'} supported`
            : 'No links yet'}
        </p>
        <button className="btn btn-primary" disabled={running || !supported.length} onClick={runAll}>
          <Icon name="download" /> {running ? 'Working…' : `Download ${supported.length || ''}`.trim()}
        </button>
      </div>

      {rows.length > 0 && (
        <ul className="batch-rows">
          {rows.map((r) => (
            <li key={r.url} className={`batch-row batch-${r.state}`}>
              <span className="mono job-tag">{platformName(detectPlatform(r.url) ?? '')}</span>
              <span className="batch-url" title={r.url}>
                {r.note ?? r.url}
              </span>
              <span className="mono batch-state">
                {r.state === 'waiting' ? 'Waiting' : r.state === 'reading' ? 'Reading…' : r.state === 'queued' ? 'Queued' : 'Failed'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
