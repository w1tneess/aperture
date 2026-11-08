export type MediaOption = {
  id: string
  label: string
  ext: string
  res: number | null
  sizeBytes: number | null
}

export type MediaItem = {
  index: number
  kind: 'video' | 'image' | 'audio'
  thumbnail: string | null
  duration: number | null
  width: number | null
  height: number | null
  options: MediaOption[]
}

export type Probe = {
  probeId: string
  url: string
  platform: string
  title: string
  uploader: string | null
  duration: number | null
  items: MediaItem[]
}

export type JobStatus = 'queued' | 'running' | 'processing' | 'done' | 'error'

export type Job = {
  id: string
  probeId: string
  index: number
  optionId: string
  status: JobStatus
  progress: number | null
  part: number
  speed: number | null
  eta: number | null
  filename: string | null
  size: number | null
  error: { code: string; message: string } | null
  createdAt: number
}

export type Session = { required: boolean; authed: boolean }

export type AppInfo = {
  name: string
  platforms: { id: string; name: string }[]
  instagramLogin: boolean
  instagramBackup: boolean
  extraHosts: string[]
  publicMode: boolean
  maxDurationMinutes: number
  maxFilesize: string
  fileLifetimeMinutes: number
  contactUrl: string | null
  repoUrl: string | null
  extractors: { ytdlp: string | null; gallerydl: string | null }
}

export class ApiError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    })
  } catch {
    throw new ApiError('NETWORK', 'Can’t reach the Aperture server. Is it running?', 0)
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(
      body?.error?.code ?? 'HTTP',
      body?.error?.message ?? `Request failed (${res.status}).`,
      res.status,
    )
  }
  return body as T
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

export const api = {
  session: () => request<Session>('/api/session'),
  info: () => request<AppInfo>('/api/info'),
  login: (passcode: string) => request<Session>('/api/session', post({ passcode })),
  probe: (url: string) => request<Probe>('/api/probe', post({ url })),
  createJob: (probeId: string, index: number, optionId: string) =>
    request<Job>('/api/jobs', post({ probeId, index, optionId })),
}

export const jobEventsUrl = (id: string) => `/api/jobs/${encodeURIComponent(id)}/events`
export const jobFileUrl = (id: string) => `/api/jobs/${encodeURIComponent(id)}/file`
