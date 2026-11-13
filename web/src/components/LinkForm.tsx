import { useState, type RefObject } from 'react'
import { detectPlatform, extractUrl, PLATFORMS, platformName } from '../lib/platforms'
import { Icon } from './Icon'

type Props = {
  value: string
  onChange: (value: string) => void
  onSubmit: (text: string) => void
  busy: boolean
  autoFetch: boolean
  inputRef: RefObject<HTMLInputElement | null>
  /** Platforms this server accepts; falls back to the full list until /api/info loads. */
  enabled: { id: string; name: string }[] | null
  /** Extra hostnames the server allows (EXTRA_HOSTS), e.g. vimeo.com on a self-hosted instance. */
  extraHosts?: string[]
}

export function LinkForm({ value, onChange, onSubmit, busy, autoFetch, inputRef, enabled, extraHosts = [] }: Props) {
  const [note, setNote] = useState<string | null>(null)
  const platform = detectPlatform(value)
  const chips = enabled ?? PLATFORMS.map(({ id, name }) => ({ id, name }))
  const allowedExtra = (text: string) => {
    try {
      const host = new URL(extractUrl(text) ?? '').hostname.toLowerCase()
      return extraHosts.some((h) => host === h || host.endsWith(`.${h}`))
    } catch {
      return false
    }
  }
  const isEnabled = (id: string | null) => id !== null && chips.some((c) => c.id === id)
  const isSupported = (text: string) => isEnabled(detectPlatform(text)) || allowedExtra(text)

  const hint = !value.trim()
    ? note
    : platform === null
      ? 'No link found in that text yet.'
      : platform === 'other'
        ? allowedExtra(value)
          ? null
          : 'That site isn’t one of the ones above.'
        : !isEnabled(platform)
          ? `${platformName(platform)} isn’t supported here. It blocks downloads from this server.`
          : null

  async function pasteFromClipboard() {
    setNote(null)
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable') // plain-http LAN address
      const text = await navigator.clipboard.readText()
      onChange(text)
      if (autoFetch && isSupported(text)) onSubmit(text)
      else inputRef.current?.focus()
    } catch {
      inputRef.current?.focus()
      setNote(
        window.matchMedia?.('(hover: none)').matches
          ? 'Clipboard access was blocked. Long-press the box and choose Paste instead.'
          : 'Clipboard access was blocked. Press Ctrl+V (⌘V on Mac) in the box instead.',
      )
    }
  }

  return (
    <form
      className="linkform"
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) onSubmit(value)
      }}
    >
      <label htmlFor="link-input" className="visually-hidden">
        Post link
      </label>
      <div className="linkbar">
        <input
          id="link-input"
          ref={inputRef}
          type="text"
          inputMode="url"
          enterKeyHint="go"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="https://www.instagram.com/reel/…"
          value={value}
          aria-describedby="link-hint"
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text')
            if (autoFetch && isSupported(text)) {
              e.preventDefault()
              onChange(text)
              onSubmit(text)
            }
          }}
        />
        {value && (
          <button
            type="button"
            className="btn-icon btn-quiet linkbar-clear"
            aria-label="Clear link"
            onClick={() => {
              onChange('')
              inputRef.current?.focus()
            }}
          >
            <Icon name="close" />
          </button>
        )}
        <div className="linkbar-actions">
          {/* Empty box: Paste is the next step, so it gets the primary style until there's a link to fetch. */}
          <button type="button" className={`btn ${value.trim() ? 'btn-ghost' : 'btn-primary'}`} onClick={pasteFromClipboard}>
            <Icon name="paste" /> Paste
          </button>
          <button type="submit" className={`btn ${value.trim() ? 'btn-primary' : 'btn-ghost'}`} disabled={busy || !value.trim()}>
            {busy ? 'Reading…' : 'Fetch'} {!busy && <Icon name="arrow" />}
          </button>
        </div>
      </div>

      <ul className="platforms" aria-label="Supported sites">
        {chips.map((p) => (
          <li key={p.id} className={platform === p.id ? 'is-active' : undefined} aria-current={platform === p.id || undefined}>
            {p.name}
          </li>
        ))}
      </ul>
      <p id="link-hint" className="hint" role="status">
        {hint}
      </p>
    </form>
  )
}
