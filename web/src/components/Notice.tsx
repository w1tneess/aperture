import type { ApiError } from '../lib/api'
import { Icon } from './Icon'

// Hints depend on who's reading: on a public instance visitors can't change server settings.
const HINTS: Record<string, { self: string; public: string }> = {
  LOGIN_REQUIRED: {
    self: 'Export cookies from a browser where you’re logged in (a “cookies.txt” extension works) and set COOKIES_FILE in .env.',
    public: 'The platform is limiting downloads from this server right now. Try again in a few minutes, or try another post.',
  },
  PRIVATE: {
    self: 'Private posts need cookies from an account that can see them (COOKIES_FILE in .env).',
    public: 'Only public posts can be downloaded here.',
  },
  MISSING_TOOL: {
    self: 'Install the extractors on the server machine: py -m pip install -U "yt-dlp[default]" gallery-dl',
    public: 'The server is being updated. Try again shortly.',
  },
  NETWORK: {
    self: 'Start it with “Start Aperture.bat” or “npm run dev”.',
    public: 'The server may be waking up (free hosting sleeps when idle). Wait about a minute and try again.',
  },
  EXTRACT_FAILED: {
    self: 'Platforms change often. Updating usually fixes it: py -m pip install -U "yt-dlp[default]" gallery-dl',
    public: 'The platform may have changed something. These usually get fixed within a day. Try again later.',
  },
  UNREACHABLE: {
    self: 'Check the server machine’s internet connection.',
    public: 'Try again in a minute.',
  },
  TIMEOUT: { self: 'Try again. Large or slow posts sometimes time out.', public: 'Try again. Large or slow posts sometimes time out.' },
}

export function Notice({ error, onRetry, publicMode }: { error: ApiError; onRetry?: () => void; publicMode: boolean }) {
  const hint = HINTS[error.code]?.[publicMode ? 'public' : 'self']
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
