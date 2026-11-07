import type { TrackedJob } from '../hooks/useJobs'
import { saveFile } from '../hooks/useJobs'
import { formatBytes, formatDuration } from '../lib/format'
import { platformName } from '../lib/platforms'
import { Icon } from './Icon'

type Props = {
  jobs: TrackedJob[]
  onRetry: (job: TrackedJob) => void
  onDismiss: (id: string) => void
  onClearFinished: () => void
}

function statusText(job: TrackedJob): string {
  switch (job.status) {
    case 'queued':
      return 'Waiting in line…'
    case 'running': {
      const parts: string[] = []
      if (job.part > 1) parts.push(`Part ${job.part}`)
      parts.push(job.progress != null ? `${Math.floor(job.progress)}%` : 'Downloading…')
      if (job.speed) parts.push(`${formatBytes(job.speed)}/s`)
      if (job.eta) parts.push(`${formatDuration(job.eta)} left`)
      return parts.join(' · ')
    }
    case 'processing':
      return job.optionId.startsWith('audio') ? 'Converting audio…' : 'Merging video and audio…'
    case 'done':
      return `Saved · ${formatBytes(job.size)}`
    case 'error':
      return job.error?.message ?? 'Failed.'
  }
}

function Progress({ job }: { job: TrackedJob }) {
  if (job.status === 'done' || job.status === 'error') return null
  const determinate = job.status === 'running' && job.progress != null
  return (
    <div
      className={`bar${determinate ? '' : ' bar-indeterminate'}`}
      role="progressbar"
      aria-label={`Progress for ${job.title}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? Math.floor(job.progress ?? 0) : undefined}
    >
      <span style={determinate ? { width: `${job.progress}%` } : undefined} />
    </div>
  )
}

export function Downloads({ jobs, onRetry, onDismiss, onClearFinished }: Props) {
  if (!jobs.length) return null
  const finished = jobs.some((j) => j.status === 'done' || j.status === 'error')

  return (
    <section className="panel" aria-labelledby="downloads-heading">
      <div className="panel-head">
        <h2 id="downloads-heading" className="panel-title">
          Downloads
        </h2>
        {finished && (
          <button className="btn btn-quiet btn-sm" onClick={onClearFinished}>
            Clear finished
          </button>
        )}
      </div>
      <ul className="jobs">
        {jobs.map((job) => (
          <li key={job.id} className={`job job-${job.status}`}>
            <div className="job-main">
              <span className="job-icon" aria-hidden="true">
                <Icon name={job.status === 'done' ? 'check' : job.status === 'error' ? 'alert' : 'download'} size={16} />
              </span>
              <div className="job-text">
                <p className="job-name" title={job.filename ?? job.title}>
                  {job.filename ?? job.title}
                </p>
                <p className="job-status mono">
                  <span className="job-tag">{platformName(job.platform)}</span>
                  <span className="job-tag">{job.optionLabel}</span>
                  <span>{statusText(job)}</span>
                </p>
              </div>
              <div className="job-actions">
                {job.status === 'done' && (
                  <button className="btn btn-quiet btn-sm" onClick={() => saveFile(job.id)}>
                    Save again
                  </button>
                )}
                {job.status === 'error' && (
                  <button className="btn btn-quiet btn-sm" onClick={() => onRetry(job)}>
                    <Icon name="retry" size={14} /> Retry
                  </button>
                )}
                {(job.status === 'done' || job.status === 'error') && (
                  <button className="btn-icon btn-quiet" aria-label={`Remove ${job.title} from list`} onClick={() => onDismiss(job.id)}>
                    <Icon name="close" size={16} />
                  </button>
                )}
              </div>
            </div>
            <Progress job={job} />
          </li>
        ))}
      </ul>
    </section>
  )
}
