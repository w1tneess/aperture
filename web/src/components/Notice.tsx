import type { ApiError } from '../lib/api'
import { Icon } from './Icon'

const HINTS: Record<string, string> = {
  LOGIN_REQUIRED:
    'Export cookies from a browser where you’re logged in (a “cookies.txt” extension works), then start the server with COOKIES_FILE pointing at it.',
  PRIVATE: 'Private posts need cookies from an account that follows the person.',
  MISSING_TOOL: 'Install yt-dlp and gallery-dl on the machine running the server: pip install -U yt-dlp gallery-dl',
  NETWORK: 'Start it with “npm run dev” in the project folder.',
  EXTRACT_FAILED: 'Platforms change often. Updating usually fixes it: pip install -U yt-dlp gallery-dl',
}

export function Notice({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const hint = HINTS[error.code]
  return (
    <div className="notice" role="alert">
      <span className="notice-icon" aria-hidden="true">
        <Icon name="alert" />
      </span>
      <div className="notice-text">
        <p className="notice-title">{error.message}</p>
        {hint && <p className="notice-hint">{hint}</p>}
      </div>
      {onRetry && (
        <button className="btn btn-ghost btn-sm" onClick={onRetry}>
          <Icon name="retry" size={14} /> Try again
        </button>
      )}
    </div>
  )
}
