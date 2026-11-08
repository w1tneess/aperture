import { useCallback, useEffect, useRef, useState } from 'react'
import { Batch } from './components/Batch'
import { Downloads } from './components/Downloads'
import { Gate } from './components/Gate'
import { History, type HistoryEntry } from './components/History'
import { Icon } from './components/Icon'
import { Logo } from './components/Logo'
import { LinkForm } from './components/LinkForm'
import { Notice } from './components/Notice'
import { ResultSkeleton, ResultView } from './components/ResultView'
import { SettingsView } from './components/SettingsView'
import { useInstallPrompt } from './hooks/useInstallPrompt'
import { useJobs, type TrackedJob } from './hooks/useJobs'
import { useStoredState } from './hooks/useStoredState'
import { api, ApiError, type AppInfo, type MediaItem, type Probe, type Session } from './lib/api'
import { extractUrl } from './lib/platforms'
import { DEFAULT_SETTINGS, pickOptionId, QUALITY_LABELS, toJobOption, type Settings } from './lib/settings'

type Tab = 'get' | 'batch' | 'history' | 'settings'
const TABS: { id: Tab; label: string }[] = [
  { id: 'get', label: 'Get' },
  { id: 'batch', label: 'Batch' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' },
]

export default function App() {
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    api
      .session()
      .then(setSession)
      .catch(() => setSession({ required: false, authed: true })) // server down: let the app show its own error
  }, [])

  if (!session) return null
  if (session.required && !session.authed) return <Gate onUnlocked={() => setSession({ required: true, authed: true })} />
  return <Aperture />
}

// crypto.randomUUID only exists in secure contexts (https/localhost); a phone on http://192.168.x.x has none.
const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

const listNames = (names: string[]) =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return Boolean(el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)))
}

function Aperture() {
  const [settings, setSettings] = useStoredState<Settings>('aperture.settings', DEFAULT_SETTINGS)
  const [history, setHistory] = useStoredState<HistoryEntry[]>('aperture.history', [])
  const [tab, setTab] = useState<Tab>('get')
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [probe, setProbe] = useState<Probe | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [info, setInfo] = useState<AppInfo | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fetchSeq = useRef(0)
  const install = useInstallPrompt()

  useEffect(() => {
    api.info().then(setInfo).catch(() => {})
  }, [])

  // ---- theme
  useEffect(() => {
    const root = document.documentElement
    if (settings.theme === 'system') delete root.dataset.theme
    else root.dataset.theme = settings.theme
  }, [settings.theme])

  // ---- toast
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  const onFinished = useCallback(
    (job: TrackedJob) => {
      if (job.status === 'error') {
        setAnnouncement(`Download failed: ${job.error?.message ?? ''}`)
        return
      }
      setAnnouncement(`Saved ${job.filename ?? job.title}`)
      if (!settings.keepHistory) return
      setHistory((list) =>
        [
          {
            id: newId(),
            url: job.url,
            platform: job.platform,
            title: job.title,
            uploader: null,
            optionLabel: job.optionLabel,
            at: Date.now(),
          },
          ...list.filter((e) => e.url !== job.url),
        ].slice(0, 200),
      )
    },
    [settings.keepHistory, setHistory],
  )

  const { jobs, start, retry, dismiss, clearFinished } = useJobs({ onFinished })

  const download = useCallback(
    async (p: Probe, item: MediaItem, optionId: string) => {
      const option = item.options.find((o) => o.id === optionId)
      const optionLabel =
        optionId === 'audio' ? settings.audioFormat.toUpperCase() : (option?.label.replace(/^Best · /, '') ?? optionId)
      try {
        await start(p.probeId, item.index, toJobOption(optionId, settings), {
          title: p.title,
          platform: p.platform,
          thumbnail: item.thumbnail,
          optionLabel,
          url: p.url,
        })
      } catch (err) {
        setToast(err instanceof ApiError ? err.message : 'Couldn’t start the download.')
      }
    },
    [settings, start],
  )

  const downloadAll = useCallback(
    async (p: Probe) => {
      await Promise.all(p.items.map((item) => download(p, item, pickOptionId(item, settings))))
      return p.items.length
    },
    [download, settings],
  )

  const fetchLink = useCallback(
    async (text: string) => {
      const link = extractUrl(text) ?? text.trim()
      const seq = ++fetchSeq.current
      setTab('get')
      setUrl(link)
      setError(null)
      setProbe(null)
      setLoading(true)
      try {
        const result = await api.probe(link)
        if (seq !== fetchSeq.current) return
        setProbe(result)
        if (settings.quickMode) {
          setToast(`Quick mode: downloading at ${QUALITY_LABELS[settings.quality]}`)
          void downloadAll(result)
        }
      } catch (err) {
        if (seq !== fetchSeq.current) return
        setError(err instanceof ApiError ? err : new ApiError('UNKNOWN', 'Something went wrong.', 0))
      } finally {
        if (seq === fetchSeq.current) setLoading(false)
      }
    },
    [settings.quickMode, settings.quality, downloadAll],
  )

  // ---- links shared into the installed app (?url= / ?text=), handled once on load
  const handledShare = useRef(false)
  useEffect(() => {
    if (handledShare.current) return
    handledShare.current = true
    const params = new URLSearchParams(window.location.search)
    const shared = [params.get('url'), params.get('text'), params.get('title')].find((v) => v && extractUrl(v))
    if (shared) {
      window.history.replaceState(null, '', window.location.pathname)
      void fetchLink(shared)
    }
  }, [fetchLink])

  // ---- paste anywhere on the page, "/" to focus the link box
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return
      const text = e.clipboardData?.getData('text') ?? ''
      if (!extractUrl(text)) return
      e.preventDefault()
      if (settings.autoFetch) void fetchLink(text)
      else {
        setTab('get')
        setUrl(text)
        requestAnimationFrame(() => inputRef.current?.focus())
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !isTyping(e.target) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setTab('get')
        requestAnimationFrame(() => inputRef.current?.focus())
      }
    }
    document.addEventListener('paste', onPaste)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('paste', onPaste)
      document.removeEventListener('keydown', onKey)
    }
  }, [fetchLink, settings.autoFetch])

  const copy = async (text: string) => {
    try {
      // navigator.clipboard is undefined on plain-http LAN addresses, hence the guard and the fallback.
      if (navigator.clipboard) await navigator.clipboard.writeText(text)
      else {
        const area = Object.assign(document.createElement('textarea'), { value: text })
        document.body.append(area)
        area.select()
        const ok = document.execCommand('copy')
        area.remove()
        if (!ok) throw new Error('copy failed')
      }
      setToast('Link copied')
    } catch {
      setToast('Couldn’t copy. Your browser blocked clipboard access.')
    }
  }

  const active = jobs.filter((j) => j.status !== 'done' && j.status !== 'error').length
  const darkNow =
    settings.theme === 'dark' ||
    (settings.theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="shell topbar-inner">
          <button className="wordmark" onClick={() => setTab('get')} aria-label="Aperture home">
            <Logo />
            aperture
          </button>
          <nav className="tabs" aria-label="Sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                className="tab"
                aria-current={tab === t.id ? 'page' : undefined}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {t.id === 'get' && active > 0 && <span className="count">{active}</span>}
                {t.id === 'history' && history.length > 0 && <span className="count">{history.length}</span>}
              </button>
            ))}
          </nav>
          <div className="topbar-actions">
            {install && (
              <button className="btn btn-ghost btn-sm" onClick={install}>
                <Icon name="download" size={14} /> Install app
              </button>
            )}
            <button
              className="btn-icon btn-quiet theme-toggle"
              aria-label={darkNow ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={() => setSettings((s) => ({ ...s, theme: darkNow ? 'light' : 'dark' }))}
            >
              <Icon name={darkNow ? 'sun' : 'moon'} />
            </button>
          </div>
        </div>
      </header>

      <main id="main" className="shell main">
        {tab === 'get' && (
          <section aria-labelledby="get-heading">
            <h1 id="get-heading" className="hero-title">
              Paste a link. <span className="hero-muted">Keep the post.</span>
            </h1>
            <p className="lead">
              Reels, videos, photos and carousels from{' '}
              {listNames(info?.platforms?.map((p) => p.name) ?? ['Instagram', 'X', 'Facebook', 'Pinterest'])}, saved
              straight to this device.
            </p>
            <LinkForm
              value={url}
              onChange={setUrl}
              onSubmit={fetchLink}
              busy={loading}
              autoFetch={settings.autoFetch}
              inputRef={inputRef}
              enabled={info?.platforms ?? null}
              extraHosts={info?.extraHosts ?? []}
            />
            <div className="result-slot">
              {loading && <ResultSkeleton />}
              {error && <Notice error={error} publicMode={Boolean(info?.publicMode)} onRetry={() => fetchLink(url)} />}
              {probe && (
                <ResultView
                  key={probe.probeId}
                  probe={probe}
                  settings={settings}
                  onDownload={(item, optionId) => download(probe, item, optionId)}
                  onCopy={copy}
                />
              )}
              {!loading && !error && !probe && (
                <div className="get-empty">
                  <ol className="steps" aria-label="How it works">
                    <li>
                      <span className="step-n mono" aria-hidden="true">01</span>
                      <strong>Copy the link</strong>
                      <span>On the post, tap Share, then Copy link.</span>
                    </li>
                    <li>
                      <span className="step-n mono" aria-hidden="true">02</span>
                      <strong>Paste it here</strong>
                      <span>Press Ctrl+V anywhere, or share straight to Aperture on Android.</span>
                    </li>
                    <li>
                      <span className="step-n mono" aria-hidden="true">03</span>
                      <strong>Save the file</strong>
                      <span>Pick a quality and it downloads to this device.</span>
                    </li>
                  </ol>
                  <p className="tip mono">
                    <kbd>Ctrl</kbd>+<kbd>V</kbd> anywhere · <kbd>/</kbd> to focus · default{' '}
                    {QUALITY_LABELS[settings.quality]}
                    {settings.quickMode ? ' · quick mode on' : ''}
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        {tab === 'batch' && <Batch settings={settings} onProbe={downloadAll} enabled={info?.platforms ?? null} />}

        {tab === 'history' && (
          <History
            entries={history}
            enabled={settings.keepHistory}
            onOpen={fetchLink}
            onCopy={copy}
            onRemove={(id) => setHistory((list) => list.filter((e) => e.id !== id))}
            onClear={() => setHistory([])}
          />
        )}

        {tab === 'settings' && (
          <SettingsView settings={settings} onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))} />
        )}

        {(tab === 'get' || tab === 'batch') && (
          <Downloads jobs={jobs} onRetry={retry} onDismiss={dismiss} onClearFinished={clearFinished} />
        )}
      </main>

      <footer className="shell footer mono">
        <p>
          Download only what you have the right to keep. Files are deleted from the server within{' '}
          {info?.fileLifetimeMinutes ?? 30} minutes. Nothing is stored after that.
        </p>
        {(info?.contactUrl || info?.repoUrl) && (
          <p className="footer-links">
            {info?.repoUrl && (
              <a href={info.repoUrl} target="_blank" rel="noopener noreferrer">
                Source code
              </a>
            )}
            {info?.repoUrl && (
              <a href={`${info.repoUrl}/issues/new/choose`} target="_blank" rel="noopener noreferrer">
                Report a problem
              </a>
            )}
            {info?.contactUrl && (
              <a href={info.contactUrl} target="_blank" rel="noopener noreferrer">
                Copyright / takedown
              </a>
            )}
          </p>
        )}
      </footer>

      <div className="toast-region" role="status" aria-live="polite">
        {toast && <p className="toast">{toast}</p>}
      </div>
      <div className="visually-hidden" aria-live="polite">
        {announcement}
      </div>
    </>
  )
}
