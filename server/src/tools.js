import { execFile } from 'node:child_process';

/**
 * Locate yt-dlp / gallery-dl / ffmpeg at startup.
 * On Windows, `pip install` often puts yt-dlp.exe in a Scripts folder that isn't on PATH,
 * so after the plain command we fall back to running the Python module (`py -m yt_dlp`).
 */
const PYTHONS = process.platform === 'win32' ? ['py', 'python', 'python3'] : ['python3', 'python'];

function probe(tool, flag = '--version') {
  return new Promise((resolve) => {
    execFile(tool.cmd, [...tool.pre, flag], { timeout: 20_000, windowsHide: true }, (err, stdout) =>
      resolve(err ? null : String(stdout).trim().split('\n')[0]),
    );
  });
}

async function find(override, bin, pyModule) {
  const candidates = override
    ? [{ cmd: override, pre: [] }]
    : [{ cmd: bin, pre: [] }, ...PYTHONS.map((py) => ({ cmd: py, pre: ['-m', pyModule] }))];
  for (const tool of candidates) {
    const version = await probe(tool);
    if (version) return { ...tool, version };
  }
  // Not found: keep the plain name so calls fail with ENOENT and the UI shows the install hint.
  return { cmd: override || bin, pre: [], version: null };
}

export const tools = {
  ytdlp: { cmd: 'yt-dlp', pre: [], version: null },
  gallerydl: { cmd: 'gallery-dl', pre: [], version: null },
};

export async function resolveTools() {
  const [ytdlp, gallerydl, ffmpeg] = await Promise.all([
    find(process.env.YTDLP_PATH, 'yt-dlp', 'yt_dlp'),
    find(process.env.GALLERYDL_PATH, 'gallery-dl', 'gallery_dl'),
    probe({ cmd: 'ffmpeg', pre: [] }, '-version'), // ffmpeg uses a single dash
  ]);
  tools.ytdlp = ytdlp;
  tools.gallerydl = gallerydl;

  const show = (name, t) =>
    t.version
      ? console.log(`✓ ${name} ${t.version}${t.pre.length ? ` (via ${t.cmd} ${t.pre.join(' ')})` : ''}`)
      : console.warn(`✗ ${name} not found. Install it: py -m pip install -U yt-dlp gallery-dl`);
  show('yt-dlp', ytdlp);
  show('gallery-dl', gallerydl);
  if (!ffmpeg) console.warn('✗ ffmpeg not found. HD video merging and MP3 need it (Windows: winget install Gyan.FFmpeg).');
}
