import { useState, type RefObject } from 'react'
import { detectPlatform, PLATFORMS } from '../lib/platforms'
import { Icon } from './Icon'

type Props = {
  value: string
  onChange: (value: string) => void
  onSubmit: (text: string) => void
  busy: boolean
  autoFetch: boolean
  inputRef: RefObject<HTMLInputElement | null>
}

const isSupported = (text: string) => {
  const p = detectPlatform(text)
  return p !== null && p !== 'other'
}

export function LinkForm({ value, onChange, onSubmit, busy, autoFetch, inputRef }: Props) {
  const [note, setNote] = useState<string | null>(null)
  const platform = detectPlatform(value)

  const hint = !value.trim()
    ? note
    : platform === null
      ? 'No link found in that text yet.'
      : platform === 'other'
        ? 'That site isn’t one of the ones above. It only works if the server allows it.'
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
      setNote('Clipboard access was blocked. Press Ctrl+V (⌘V on Mac) in the box instead.')
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
          <button type="button" className="btn btn-ghost" onClick={pasteFromClipboard}>
            <Icon name="paste" /> Paste
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
            {busy ? 'Reading…' : 'Fetch'} {!busy && <Icon name="arrow" />}
          </button>
        </div>
      </div>

      <ul className="platforms" aria-label="Supported sites">
        {PLATFORMS.map((p) => (
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
