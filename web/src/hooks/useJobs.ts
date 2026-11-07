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
        }
      }
      es.onerror = () => {
        if (++failures < 3) return
        es.close()
        streams.current.delete(job.id)
        patch(job.id, { status: 'error', error: { code: 'LOST', message: 'Lost connection to the server.' } })
      }
    },
    [patch],
  )

  const start = useCallback(
    async (probeId: string, index: number, optionId: string, meta: JobMeta) => {
      const job = await api.createJob(probeId, index, optionId)
      const tracked = { ...job, ...meta }
      setJobs((list) => [tracked, ...list])
      follow(tracked)
      return tracked
    },
    [follow],
  )

  const retry = useCallback(
    async (job: TrackedJob) => {
      setJobs((list) => list.filter((j) => j.id !== job.id))
      try {
        await start(job.probeId, job.index, job.optionId, job)
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'Couldn’t restart the download.'
        setJobs((list) => [{ ...job, status: 'error', error: { code: 'RETRY', message } }, ...list])
      }
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
