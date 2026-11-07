import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { classifyError, gallerydlBaseArgs, ytdlpBaseArgs } from './extract.js';
import { tools } from './tools.js';

// Only ever create/delete inside this dedicated folder, never TMP_DIR itself.
const JOBS_ROOT = path.join(config.tmpDir, 'stash-jobs');

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

export function createJob({ probe, index, optionId }) {
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
    execute(job)
      .catch((err) => update(job, { status: 'error', error: { code: err.code || 'FAILED', message: err.message } }))
      .finally(() => {
        running--;
        pump();
      });
  }
}

function ytdlpArgs(job) {
  const { _probe: probe, _item: item, optionId } = job;
  const args = [
    ...ytdlpBaseArgs(),
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

  if (optionId === 'original') {
    args.push('-f', 'b');
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
  return [...gallerydlBaseArgs(), '--range', String(item.selector), '-D', job.dir, '-f', 'media.{extension}', '--', probe.url];
}

const num = (s) => (s === 'NA' || s === 'None' || s === undefined ? null : Number(s));

async function execute(job) {
  await fs.mkdir(job.dir, { recursive: true });
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
    if (job.createdAt < cutoff && job.status !== 'running' && job.status !== 'processing') {
      jobs.delete(id);
      await fs.rm(job.dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function initStorage() {
  // Start clean: anything left from a previous run is orphaned.
  await fs.rm(JOBS_ROOT, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(JOBS_ROOT, { recursive: true });
  setInterval(sweep, 60_000).unref();
}
