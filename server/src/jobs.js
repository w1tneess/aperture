import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { MEDIA_HOST } from './apify.js';
import { classifyError, gallerydlBaseArgs, ytdlpBaseArgs } from './extract.js';
import { tools } from './tools.js';

// Only ever create/delete inside this dedicated folder, never TMP_DIR itself.
const JOBS_ROOT = path.join(config.tmpDir, 'aperture-jobs');

// ------------------------------------------------------------------ probes

/** Probe results are cached server-side so the client only ever references items by id + index. */
const probes = new Map();

export function saveProbe(probe) {
  const id = crypto.randomUUID();
  probes.set(id, { ...probe, id, createdAt: Date.now() });
  return probes.get(id);
}

export const getProbe = (id) => probes.get(id);

// -------------------------------------------------------------------- jobs

const jobs = new Map();
const queue = [];
let running = 0;
export const events = new EventEmitter();
events.setMaxListeners(200);

export const getJob = (id) => jobs.get(id);

export function publicJob(job) {
  const { id, probeId, index, optionId, status, progress, part, speed, eta, filename, size, error, createdAt } = job;
  return { id, probeId, index, optionId, status, progress, part, speed, eta, filename, size, error, createdAt };
}

function update(job, patch) {
  Object.assign(job, patch);
  events.emit(job.id, publicJob(job));
}

const sanitize = (s) =>
  String(s || '')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function downloadName(probe, item, ext) {
  const base = [sanitize(probe.uploader), sanitize(probe.title)].filter(Boolean).join(' - ').slice(0, 110) || 'download';
  const suffix = probe.items.length > 1 ? ` (${item.selector ?? 1})` : '';
  return `${base}${suffix}.${ext}`;
}

export function activeJobsFor(ip) {
  let n = 0;
  for (const job of jobs.values()) if (job.ip === ip && ['queued', 'running', 'processing'].includes(job.status)) n++;
  return n;
}

/** Called once the browser has fetched the file: it only needs to stay around briefly for "Save again". */
export function markSaved(job) {
  if (!job.savedAt) job.savedAt = Date.now();
}

export function createJob({ probe, index, optionId, ip }) {
  const item = probe.items[index];
  const job = {
    id: crypto.randomUUID(),
    probeId: probe.id,
    index,
    optionId,
    status: 'queued',
    progress: null,
    part: 1,
    speed: null,
    eta: null,
    filename: null,
    size: null,
    error: null,
    filePath: null,
    dir: path.join(JOBS_ROOT, crypto.randomUUID()),
    createdAt: Date.now(),
    savedAt: null,
    attempt: 1,
    ip,
    _probe: probe,
    _item: item,
  };
  jobs.set(job.id, job);
  queue.push(job);
  pump();
  return job;
}

function pump() {
  while (running < config.maxConcurrent && queue.length) {
    const job = queue.shift();
    running++;
    runWithRetry(job)
      .catch((err) => {
        console.warn(`[job] ${job._probe.platform} ${job._item.source} ${job.optionId} failed: ${err.code || 'FAILED'} ${err.log || err.message}`);
        update(job, { status: 'error', error: { code: err.code || 'FAILED', message: err.message } });
      })
      .finally(() => {
        running--;
        pump();
      });
  }
}

// Failures worth one more try with a simpler format. Login/private/not-found won't change on retry.
const RETRYABLE = new Set(['EXTRACT_FAILED', 'EMPTY', 'TIMEOUT', 'FAILED', 'NO_VIDEO', 'UNREACHABLE']);

async function runWithRetry(job) {
  try {
    await execute(job);
  } catch (err) {
    if (job.attempt > 1 || !RETRYABLE.has(err.code)) throw err;
    console.warn(`[job ${job.id}] attempt 1 failed (${err.code}); retrying with fallback format`);
    job.attempt = 2;
    await fs.rm(job.dir, { recursive: true, force: true }).catch(() => {});
    update(job, { status: 'running', progress: null, part: 1 });
    await execute(job);
  }
}

function ytdlpArgs(job) {
  const { _probe: probe, _item: item, optionId } = job;
  const args = [
    ...ytdlpBaseArgs(probe.platform),
    '--newline',
    '--progress',
    '--progress-template',
    'download:PROG %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s',
    '--max-filesize',
    config.maxFilesize,
    '--no-mtime',
    '-P',
    job.dir,
    '-o',
    '%(id).60B.%(ext)s',
  ];
  if (item.selector) args.push('--playlist-items', String(item.selector));

  if (optionId === 'original' || job.attempt > 1) {
    // Retry path: the single best pre-merged file. Avoids format/merge problems that break the first try.
    if (optionId.startsWith('audio') && job.attempt > 1) args.push('-f', 'ba/b', '-x', '--audio-format', 'mp3');
    else args.push('-f', 'b/bv*+ba');
  } else if (optionId === 'audio' || optionId === 'audio:m4a') {
    const fmt = optionId === 'audio:m4a' ? 'm4a' : 'mp3';
    args.push('-f', 'ba/b', '-x', '--audio-format', fmt, '--audio-quality', '0');
  } else {
    const res = optionId.startsWith('res:') ? Number(optionId.slice(4)) : null;
    // `res` sorts by the smaller dimension, so 720 means 720p for both landscape and vertical video.
    args.push('-f', 'bv*+ba/b', '-S', res ? `res:${res},ext:mp4:m4a` : 'ext:mp4:m4a', '--merge-output-format', 'mp4');
  }
  args.push('--', probe.url);
  return args;
}

function gallerydlArgs(job) {
  const { _probe: probe, _item: item } = job;
  return [...gallerydlBaseArgs(probe.platform), '--range', String(item.selector), '-D', job.dir, '-f', 'media.{extension}', '--', probe.url];
}

const num = (s) => (s === 'NA' || s === 'None' || s === undefined ? null : Number(s));

const SIZE_UNITS = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 };
const maxBytes = () => {
  const m = /^(\d+(?:\.\d+)?)([KMG])?$/i.exec(config.maxFilesize);
  return m ? Number(m[1]) * (SIZE_UNITS[(m[2] || '').toUpperCase()] || 1) : 2 * 1024 ** 3;
};

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { windowsHide: true });
    let err = '';
    child.stderr.on('data', (c) => (err = (err + c).slice(-2000)));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(Object.assign(new Error('ffmpeg failed'), { stderr: err }))));
  });
}

/** Items from the Apify backup carry a direct Instagram CDN URL: stream it to disk with progress. */
async function executeDirect(job) {
  const url = new URL(job._item.mediaUrl);
  if (url.protocol !== 'https:' || !MEDIA_HOST.test(url.hostname)) {
    throw Object.assign(new Error('Refused an unexpected media host.'), { code: 'FAILED' });
  }
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000), headers: { 'user-agent': 'Mozilla/5.0' } });
  } catch (err) {
    // Dropped connection to Instagram's CDN: mark as retryable instead of failing outright.
    throw Object.assign(new Error('The connection to Instagram dropped. Try again.'), { code: 'FAILED', log: `cdn fetch: ${err.cause?.code || err.name}` });
  }
  if (!res.ok || !res.body) {
    throw Object.assign(new Error('Instagram’s media link expired. Fetch the post again.'), { code: res.status === 403 ? 'EXPIRED' : 'FAILED' });
  }
  const total = Number(res.headers.get('content-length')) || null;
  const limit = maxBytes();
  if (total && total > limit) throw Object.assign(new Error(`That file is larger than the ${config.maxFilesize} limit.`), { code: 'TOO_LARGE' });

  const ext = job._item.kind === 'image' ? 'jpg' : 'mp4';
  const media = path.join(job.dir, `media.${ext}`);
  let done = 0;
  let last = 0;
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      done += chunk.length;
      if (done > limit) return cb(Object.assign(new Error(`That file is larger than the ${config.maxFilesize} limit.`), { code: 'TOO_LARGE' }));
      if (Date.now() - last > 250) {
        last = Date.now();
        update(job, { progress: total ? Math.min(100, Math.round((done / total) * 1000) / 10) : null });
      }
      cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body), meter, createWriteStream(media));

  if (job.optionId.startsWith('audio') && job._item.kind === 'video') {
    update(job, { status: 'processing', progress: null });
    const fmt = job.optionId === 'audio:m4a' ? 'm4a' : 'mp3';
    const out = path.join(job.dir, `audio.${fmt}`);
    const codec = fmt === 'mp3' ? ['-codec:a', 'libmp3lame', '-q:a', '0'] : ['-c:a', 'aac', '-b:a', '192k'];
    try {
      await runFfmpeg(['-y', '-loglevel', 'error', '-i', media, '-vn', ...codec, out]);
    } catch (err) {
      if (/does not contain any stream|matches no streams|no audio/i.test(err.stderr || '')) {
        throw Object.assign(new Error('This video has no sound, so there’s no audio to save.'), { code: 'NO_AUDIO' });
      }
      throw Object.assign(new Error('Couldn’t convert the audio.'), { code: 'FAILED', log: `ffmpeg: ${(err.stderr || '').trim().split('\n').at(-1)}` });
    }
    await fs.rm(media, { force: true });
  }
}

async function execute(job) {
  await fs.mkdir(job.dir, { recursive: true });
  if (job._item.source === 'direct') {
    update(job, { status: 'running', progress: 0 });
    await executeDirect(job);
    return finish(job);
  }
  update(job, { status: 'running', progress: job._item.source === 'ytdlp' ? 0 : null });

  const isYt = job._item.source === 'ytdlp';
  const tool = isYt ? tools.ytdlp : tools.gallerydl;
  const bin = tool.cmd;
  const args = isYt ? ytdlpArgs(job) : gallerydlArgs(job);

  await new Promise((resolve, reject) => {
    const child = spawn(tool.cmd, [...tool.pre, ...args], { windowsHide: true });
    const timer = setTimeout(() => child.kill('SIGKILL'), 15 * 60_000);
    let stderr = '';
    let lastEmit = 0;
    let buf = '';

    child.stdout.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (line.startsWith('PROG ')) {
          const [, done, total, estimate, speed, eta] = line.trim().split(' ');
          const t = num(total) || num(estimate);
          const d = num(done);
          const now = Date.now();
          if (now - lastEmit < 250) continue;
          lastEmit = now;
          update(job, {
            progress: t && d != null ? Math.min(100, Math.round((d / t) * 1000) / 10) : null,
            speed: num(speed),
            eta: num(eta),
          });
        } else if (line.startsWith('[download] Destination:') && job.progress > 0) {
          update(job, { part: job.part + 1, progress: 0 });
        } else if (/^\[(Merger|ExtractAudio|VideoConvertor|FixupM3u8|VideoRemuxer)\]/.test(line)) {
          update(job, { status: 'processing', progress: null });
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-8000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(classifyError(err, isYt ? 'yt-dlp' : 'gallery-dl'));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      const err = new Error(`exit ${code ?? signal}`);
      err.stderr = stderr;
      err.killed = signal === 'SIGKILL';
      console.error(`[job ${job.id}] ${bin} failed:`, stderr.trim().split('\n').slice(-3).join(' | '));
      reject(classifyError(err, isYt ? 'yt-dlp' : 'gallery-dl'));
    });
  });

  return finish(job);
}

async function finish(job) {
  // yt-dlp exits 0 when --max-filesize skips a file, so "no file" must be checked explicitly.
  const files = (await fs.readdir(job.dir)).filter((f) => !/\.(part|ytdl|temp)$|\.part-Frag/.test(f));
  if (!files.length) {
    throw Object.assign(new Error(`Nothing was downloaded. The file may be over the ${config.maxFilesize} limit.`), {
      code: 'EMPTY',
    });
  }
  const stats = await Promise.all(files.map(async (f) => ({ f, s: await fs.stat(path.join(job.dir, f)) })));
  const { f: file, s: stat } = stats.sort((a, b) => b.s.size - a.s.size)[0];
  const ext = path.extname(file).slice(1) || 'bin';

  update(job, {
    status: 'done',
    progress: 100,
    filePath: path.join(job.dir, file),
    filename: downloadName(job._probe, job._item, ext),
    size: stat.size,
  });
}

// ----------------------------------------------------------------- cleanup

async function sweep() {
  const cutoff = Date.now() - config.jobTtlMs;
  for (const [id, probe] of probes) if (probe.createdAt < cutoff) probes.delete(id);
  for (const [id, job] of jobs) {
    const savedExpired = job.savedAt && job.savedAt < Date.now() - config.afterSaveTtlMs;
    // Queued jobs are skipped too: they're still in `queue`, and would otherwise run later into a folder nothing cleans up.
    if ((job.createdAt < cutoff || savedExpired) && !['queued', 'running', 'processing'].includes(job.status)) {
      jobs.delete(id);
      await fs.rm(job.dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function initStorage() {
  // Start clean: anything left from a previous run is orphaned.
  await fs.rm(JOBS_ROOT, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(JOBS_ROOT, { recursive: true });
  setInterval(sweep, 30_000).unref();
}
