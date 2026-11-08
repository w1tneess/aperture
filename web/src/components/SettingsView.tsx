import { QUALITY_LABELS, QUALITY_ORDER, type Quality, type Settings } from '../lib/settings'

type Props = { settings: Settings; onChange: (patch: Partial<Settings>) => void }

function Segmented<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  help,
}: {
  legend: string
  name: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  help?: string
}) {
  return (
    <fieldset className="setting">
      <legend className="setting-label">{legend}</legend>
      {help && <p className="setting-help">{help}</p>}
      <div className="segmented">
        {options.map((o) => (
          <label key={o.value}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function Toggle({ label, help, checked, onChange }: { label: string; help: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true" />
      <span className="toggle-text">
        <span className="setting-label">{label}</span>
        <span className="setting-help">{help}</span>
      </span>
    </label>
  )
}

export function SettingsView({ settings, onChange }: Props) {
  return (
    <section aria-labelledby="settings-heading">
      <div className="view-head">
        <h1 id="settings-heading" className="view-title">
          Settings
        </h1>
      </div>
      <p className="lead">Saved in this browser. They shape what happens when you paste a link.</p>

      <div className="settings">
        <Segmented<Quality>
          legend="Default quality"
          name="quality"
          value={settings.quality}
          help="Pre-selected for every post. If a post doesn’t have it, the closest lower option is used."
          options={QUALITY_ORDER.map((q) => ({ value: q, label: QUALITY_LABELS[q] }))}
          onChange={(quality) => onChange({ quality })}
        />
        <Segmented
          legend="Audio format"
          name="audioFormat"
          value={settings.audioFormat}
          help="MP3 plays everywhere. M4A keeps the original quality and is smaller."
          options={[
            { value: 'mp3', label: 'MP3' },
            { value: 'm4a', label: 'M4A' },
          ]}
          onChange={(audioFormat) => onChange({ audioFormat })}
        />

        <fieldset className="setting">
          <legend className="setting-label">Behaviour</legend>
          <Toggle
            label="Fetch on paste"
            help="Read the post as soon as a supported link is pasted."
            checked={settings.autoFetch}
            onChange={(autoFetch) => onChange({ autoFetch })}
          />
          <Toggle
            label="Quick mode"
            help="Skip the preview and start downloading at your default quality right away."
            checked={settings.quickMode}
            onChange={(quickMode) => onChange({ quickMode })}
          />
          <Toggle
            label="Keep history"
            help="Remember finished downloads in this browser."
            checked={settings.keepHistory}
            onChange={(keepHistory) => onChange({ keepHistory })}
          />
        </fieldset>

        <Segmented
          legend="Theme"
          name="theme"
          value={settings.theme}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          onChange={(theme) => onChange({ theme })}
        />

        <div className="setting setting-note">
          <p className="setting-label">On your phone</p>
          <p className="setting-help">
            In Chrome on Android, open the menu and choose <em>Add to Home screen</em> (in Brave: <em>Install app</em>).
            Aperture then appears in your share sheet, so you can share a post from Instagram, X or TikTok straight to
            it.
          </p>
        </div>
      </div>
    </section>
  )
}
