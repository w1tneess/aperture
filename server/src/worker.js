import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { tools } from './tools.js';

/**
 * Persistent Python probe worker (see probe_worker.py). It keeps yt-dlp and gallery-dl imported, which
 * removes ~0.7 CPU-seconds of startup from every probe: the difference between ~10 s and ~2 s on a
 * 0.1-CPU host. If it can't start, or its extractor versions differ from the CLI tools, callers fall
 * back to spawning the CLI as before, so behaviour never gets worse than without it.
 */

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'probe_worker.py');
const POOL_THREADS = 8; // probe_worker.py's default thread pool size
const PYTHONS = process.platform === 'win32' ? ['py', 'python', 'python3'] : ['python3', 'python'];

let state = { proc: null, ready: null, pending: new Map(), nextId: 1 };
let settings = null;
let disabled = false;
let recentCrashes = [];

export class WorkerUnavailable extends Error {}

function pythonCandidates() {
  const list = [];
  if (tools.ytdlp.pre[0] === '-m') list.push(tools.ytdlp.cmd); // yt-dlp already runs via this Python
  if (process.env.PYTHON) list.push(process.env.PYTHON);
  list.push(...PYTHONS);
  return [...new Set(list)];
}

function startWith(python) {
  return new Promise((resolve) => {
    const st = { proc: null, ready: null, pending: new Map(), nextId: 1, stuck: 0 };
    let proc;
    try {
      proc = spawn(python, ['-X', 'utf8', SCRIPT, JSON.stringify(settings)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      return resolve(null);
    }
    st.proc = proc;
    proc.stdin.on('error', () => {}); // a write after the worker died; the exit handler reports it
    let buf = '';
    let settled = false;
    const done = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const timer = setTimeout(() => {
      proc.kill();
      done(null);
    }, 60_000);

    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if ('ready' in msg) {
          clearTimeout(timer);
          if (!msg.ready) {
            done(null);
            continue;
          }
          if (msg.ytdlp !== tools.ytdlp.version || msg.gallerydl !== tools.gallerydl.version) {
            // A different Python than the CLI tools: its extractors could be stale. Use the CLI instead.
            console.warn(`[worker] ${python} has yt-dlp ${msg.ytdlp} / gallery-dl ${msg.gallerydl}, CLI has ${tools.ytdlp.version} / ${tools.gallerydl.version}; not using it`);
            proc.kill();
            done(null);
            continue;
          }
          done({ st, python });
          continue;
        }
        const p = st.pending.get(msg.id);
        if (!p) {
          st.stuck--; // a timed-out probe finally finished, freeing its thread
          continue;
        }
        st.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.out);
        else p.reject(Object.assign(new Error('extractor failed'), { stderr: msg.stderr || '' }));
      }
    });
    // Libraries may write warnings here; keep the pipe drained but quiet.
    proc.stderr.resume();
    proc.on('error', () => done(null));
    proc.on('exit', () => {
      clearTimeout(timer);
      done(null);
      for (const p of st.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new WorkerUnavailable('probe worker exited'));
      }
      st.pending.clear();
      if (state === st) onCrash();
    });
  });
}

function onCrash() {
  state = { proc: null, ready: null, pending: new Map(), nextId: 1 };
  const now = Date.now();
  recentCrashes = recentCrashes.filter((t) => now - t < 10 * 60_000).concat(now);
  if (recentCrashes.length >= 3) {
    disabled = true;
    console.warn('[worker] probe worker keeps exiting; using the extractor CLIs for probes');
  }
}

async function ensure() {
  if (disabled || !settings) throw new WorkerUnavailable('probe worker disabled');
  if (!state.ready) {
    const mine = state;
    mine.ready = (async () => {
      for (const python of pythonCandidates()) {
        const started = await startWith(python);
        if (started) {
          if (state !== mine) {
            started.st.proc.stdin.end(); // restarted meanwhile; this one is stale
            return false;
          }
          started.st.ready = mine.ready;
          state = started.st; // same object the exit handler compares against
          console.log(`✓ probe worker ready (${python}): extractors stay loaded between probes`);
          return true;
        }
      }
      disabled = true;
      console.warn('ℹ  probe worker unavailable; probes will spawn the extractor CLIs (slower)');
      return false;
    })();
  }
  const ok = await state.ready;
  if (!ok || !state.proc) throw new WorkerUnavailable('probe worker unavailable');
  return state;
}

/** Start (or restart, e.g. after an extractor update) the worker. Cookie paths must be final by now. */
export async function startWorker(cookieSettings) {
  settings = { range: `1-${config.maxItemsPerPost}`, ...cookieSettings };
  stopWorker();
  disabled = false;
  recentCrashes = [];
  await ensure().catch(() => {});
}

/** Reload the worker with the same settings, e.g. after pip upgraded the extractors. */
export async function restartWorker() {
  if (settings) await startWorker(settings);
}

export function stopWorker() {
  const old = state;
  state = { proc: null, ready: null, pending: new Map(), nextId: 1 };
  if (old.proc) old.proc.stdin.end();
}

/**
 * Run one probe in the worker. Resolves with the JSON text the CLI would print; rejects like run()
 * (err.stderr / err.killed) so classifyError works unchanged, or with WorkerUnavailable.
 */
export async function workerProbe(tool, url, args, timeout) {
  const st = await ensure();
  return new Promise((resolve, reject) => {
    const id = st.nextId++;
    const timer = setTimeout(() => {
      st.pending.delete(id);
      reject(Object.assign(new Error('probe timed out'), { killed: true, stderr: '' }));
      // A timed-out probe keeps its worker thread busy. Once every thread is stuck, new probes would only
      // queue up and time out too: restart the worker (repeated crashes fall back to the CLIs).
      if (++st.stuck >= POOL_THREADS) {
        console.warn('[worker] every probe thread is stuck; restarting the probe worker');
        st.proc.kill();
      }
    }, timeout);
    st.pending.set(id, { resolve, reject, timer });
    st.proc.stdin.write(`${JSON.stringify({ id, tool, url, args })}\n`);
  });
}
