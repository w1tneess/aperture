// Runs the API (with auto-reload) and the Vite dev server together. Ctrl+C stops both.
import { spawn } from 'node:child_process';

// On Windows `npm` is npm.cmd, which Node only runs through a shell (Node 20.12+ security change).
const opts = { stdio: 'inherit', shell: process.platform === 'win32' };
const webHost = process.env.WEB_HOST || '127.0.0.1';

const procs = [
  spawn('npm', ['run', 'dev', '--prefix', 'server'], opts),
  spawn('npm', ['run', 'dev', '--prefix', 'web', '--', '--host', webHost], opts),
];

let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  procs.forEach((p) => p.kill());
  process.exit(code);
};
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
procs.forEach((p) => p.on('exit', (code) => code && stop(code)));
