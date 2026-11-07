import { timeAgo } from '../lib/format'
import { platformName } from '../lib/platforms'
import { Icon } from './Icon'

export type HistoryEntry = {
  id: string
  url: string
  platform: string
  title: string
  uploader: string | null
  optionLabel: string
  at: number
}

type Props = {
  entries: HistoryEntry[]
  enabled: boolean
  onOpen: (url: string) => void
  onCopy: (url: string) => void
  onRemove: (id: string) => void
  onClear: () => void
}

export function History({ entries, enabled, onOpen, onCopy, onRemove, onClear }: Props) {
  return (
    <section aria-labelledby="history-heading">
      <div className="view-head">
        <h1 id="history-heading" className="view-title">
          History
        </h1>
        {entries.length > 0 && (
          <button
            className="btn btn-quiet btn-sm"
            onClick={() => {
              if (confirm('Clear all download history from this browser?')) onClear()
            }}
          >
            Clear all
          </button>
        )}
      </div>
      <p className="lead">
        {enabled
          ? 'Links you downloaded, kept only in this browser. Open one to fetch it again.'
          : 'History is turned off in Settings. Nothing new is being saved.'}
      </p>

      {entries.length === 0 ? (
        <div className="empty" role="status">
          <Icon name="download" size={28} />
          <p className="empty-title">Nothing here yet</p>
          <p className="empty-text">Finished downloads show up here so you can grab them again later.</p>
        </div>
      ) : (
        <ul className="history">
          {entries.map((e) => (
            <li key={e.id} className="history-row">
              <div className="history-text">
                <p className="eyebrow">
                  {[platformName(e.platform), e.uploader && `@${e.uploader.replace(/^@/, '')}`, e.optionLabel, timeAgo(e.at)]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <p className="history-title">{e.title}</p>
              </div>
              <div className="history-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => onOpen(e.url)}>
                  <Icon name="open" size={14} /> Open
                </button>
                <button className="btn-icon btn-quiet" aria-label={`Copy link for ${e.title}`} onClick={() => onCopy(e.url)}>
                  <Icon name="link" size={16} />
                </button>
                <button className="btn-icon btn-quiet" aria-label={`Remove ${e.title} from history`} onClick={() => onRemove(e.id)}>
                  <Icon name="trash" size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
