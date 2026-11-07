import { useState } from 'react'
import { api, ApiError } from '../lib/api'

export function Gate({ onUnlocked }: { onUnlocked: () => void }) {
  const [passcode, setPasscode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  return (
    <main className="gate">
      <form
        className="gate-card"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(null)
          try {
            await api.login(passcode)
            onUnlocked()
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Couldn’t sign in.')
          } finally {
            setBusy(false)
          }
        }}
      >
        <p className="wordmark" aria-hidden="true">
          <span className="wordmark-mark" />
          stash
        </p>
        <h1 className="view-title">Enter passcode</h1>
        <label htmlFor="passcode" className="setting-help">
          This Stash server is private.
        </label>
        <input
          id="passcode"
          className="field"
          type="password"
          autoComplete="current-password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'gate-error' : undefined}
          autoFocus
        />
        {error && (
          <p id="gate-error" className="field-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary" disabled={busy || !passcode}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </main>
  )
}
