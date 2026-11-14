import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, jobEventsUrl, jobFileUrl, type Job } from '../lib/api'

export type JobMeta = {
  title: string
  platform: string
  thumbnail: string | null
  optionLabel: string
  url: string
}

export type TrackedJob = Job & JobMeta

export function saveFile(jobId: string) {
  // The server responds with Content-Disposition: attachment, so this saves without navigating away.
  const a = document.createElement('a')
  a.href = jobFileUrl(jobId)
  a.download = ''
  a.rel = 'noopener'
  document.body.append(a)
  a.click()
  a.remove()
}

export function useJobs({ onFinished }: { onFinished?: (job: TrackedJob) => void } = {}) {
  const [jobs, setJobs] = useState<TrackedJob[]>([])
  const streams = useRef(new Map<string, EventSource>())
  const onFinishedRef = useRef(onFinished)
  const pendingSeq = useRef(0)
  const waiters = useRef<(() => void)[]>([])
  // Wake every download waiting for a free slot; the ones that still don't fit wait again.
  const freeSlot = useCallback(() => waiters.current.splice(0).forEach((wake) => wake()), [])
  useEffect(() => {
    onFinishedRef.current = onFinished
  })

  const patch = useCallback((id: string, data: Partial<TrackedJob>) => {
    setJobs((list) => list.map((j) => (j.id === id ? { ...j, ...data } : j)))
  }, [])

  const follow = useCallback(
    (job: TrackedJob) => {
      const es = new EventSource(jobEventsUrl(job.id))
      let failures = 0
      streams.current.set(job.id, es)

      es.onmessage = (event) => {
        failures = 0
        const data = JSON.parse(event.data) as Job
        patch(job.id, data)
        if (data.status === 'done' || data.status === 'error') {
          es.close()
          streams.current.delete(job.id)
          if (data.status === 'done') saveFile(job.id)
          onFinishedRef.current?.({ ...job, ...data })
          freeSlot()
        }
      }
      es.onerror = () => {
        // CLOSED means the browser gave up for good (e.g. a 404 after a server restart): it won't reconnect.
        if (es.readyState !== EventSource.CLOSED && ++failures < 3) return
        es.close()
        streams.current.delete(job.id)
        patch(job.id, { status: 'error', error: { code: 'LOST', message: 'Lost connection to the server.' } })
        freeSlot()
      }
    },
    [patch, freeSlot],
  )

  /**
   * Shows the download in the list at once, then creates it on the server. The server caps running
   * downloads per visitor (3 on a public instance), so "Download all" on a big carousel would mostly be
   * refused: those wait as "Waiting in line…" and are created as earlier downloads finish. Never throws;
   * a failure becomes an error row with Retry.
   */
  const start = useCallback(
    async (probeId: string, index: number, optionId: string, meta: JobMeta) => {
      const tempId = `pending-${++pendingSeq.current}`
      const base = { probeId, index, optionId, part: 1, progress: null, speed: null, eta: null, filename: null, size: null }
      setJobs((list) => [{ ...base, ...meta, id: tempId, status: 'queued', error: null, createdAt: Date.now() }, ...list])
      for (;;) {
        try {
          const tracked = { ...(await api.createJob(probeId, index, optionId)), ...meta }
          setJobs((list) => list.map((j) => (j.id === tempId ? tracked : j)))
          follow(tracked)
          return
        } catch (err) {
          if (err instanceof ApiError && err.code === 'BUSY') {
            // A slot frees when one of this tab's downloads ends; the timer covers downloads from other tabs.
            await new Promise<void>((resolve) => {
              waiters.current.push(resolve)
              setTimeout(resolve, 15_000)
            })
            continue
          }
          const message = err instanceof ApiError ? err.message : 'Couldn’t start the download.'
          patch(tempId, { status: 'error', error: { code: 'START', message } })
          return
        }
      }
    },
    [follow, patch],
  )

  const retry = useCallback(
    (job: TrackedJob) => {
      setJobs((list) => list.filter((j) => j.id !== job.id))
      // Only the display fields: spreading the whole old job would overwrite the new job's id and status.
      const { title, platform, thumbnail, optionLabel, url } = job
      void start(job.probeId, job.index, job.optionId, { title, platform, thumbnail, optionLabel, url })
    },
    [start],
  )

  const dismiss = useCallback((id: string) => setJobs((list) => list.filter((j) => j.id !== id)), [])
  const clearFinished = useCallback(
    () => setJobs((list) => list.filter((j) => j.status !== 'done' && j.status !== 'error')),
    [],
  )

  useEffect(() => {
    const open = streams.current
    return () => open.forEach((es) => es.close())
  }, [])

  return { jobs, start, retry, dismiss, clearFinished }
}
