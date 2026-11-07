import { execFile } from 'node:child_process';
import { config } from './config.js';
import { tools } from './tools.js';

export class ExtractError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

/** Run a tool with an argument array. No shell is involved, so user input can't inject commands. */
export function run(tool, args, { timeout = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(tool.cmd, [...tool.pre, ...args], { timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = String(stderr || '');
        return reject(err);
      }
      resolve(String(stdout));
    });
  });
}

export function ytdlpBaseArgs() {
  const args = ['--ignore-config', '--no-warnings', '--socket-timeout', '20', '--no-playlist'];
  if (config.cookiesFile) args.push('--cookies', config.cookiesFile);
  return args;
}

export function gallerydlBaseArgs() {
  const args = ['--config-ignore'];
  if (config.cookiesFile) args.push('--cookies', config.cookiesFile);
  return args;
}

/** Map extractor stderr to a short, user-facing message. Raw stderr is never sent in production. */
export function classifyError(err, tool) {
  // Only stderr: err.message from execFile contains the full command line (e.g. "--socket-timeout"),
  // which would make every failure look like a timeout.
  const text = String(err?.stderr || '');
  const detail = config.isProd ? undefined : lastLine(err?.stderr || err?.message);

  if (err?.code === 'ENOENT') {
    return new ExtractError('MISSING_TOOL', `${tool} isn’t installed on the server. See the README.`, detail);
  }
  if (/unable to connect|tunnel connection failed|name or service not known|getaddrinfo|connection refused|network is unreachable|no route to host/i.test(text)) {
    return new ExtractError('UNREACHABLE', 'The server couldn’t reach that platform. Check its internet connection.', detail);
  }
  if (err?.killed || /timed out|read timeout|timeout error/i.test(text)) {
    return new ExtractError('TIMEOUT', 'The platform took too long to respond. Try again.', detail);
  }
  if (/no video|there's no video|no media found|no formats/i.test(text)) {
    return new ExtractError('NO_VIDEO', 'No downloadable media found in that post.', detail);
  }
  if (/private|followers only|this account is private/i.test(text)) {
    return new ExtractError('PRIVATE', 'That post is private. Add a cookies file from an account that can see it.', detail);
  }
  if (/log ?in|sign ?in|cookies|authenticat|rate.?limit|429|checkpoint/i.test(text)) {
    return new ExtractError(
      'LOGIN_REQUIRED',
      'The platform asked for a login. Add a cookies file (see README) and try again.',
      detail,
    );
  }
  if (/unsupported url/i.test(text)) {
    return new ExtractError('UNSUPPORTED', 'That link type isn’t supported (try the post’s direct link).', detail);
  }
  if (/404|not found|unavailable|removed|deleted|does not exist/i.test(text)) {
    return new ExtractError('NOT_FOUND', 'That post is unavailable or was deleted.', detail);
  }
  if (/larger than max-filesize|File is larger/i.test(text)) {
    return new ExtractError('TOO_LARGE', `That file is larger than the ${config.maxFilesize} limit.`, detail);
  }
  return new ExtractError('EXTRACT_FAILED', 'Couldn’t read that post. The link may be wrong or the platform changed.', detail);
}

function lastLine(text) {
  const lines = String(text || '').trim().split('\n').filter(Boolean);
  return lines.at(-1)?.slice(0, 300);
}

// ---------------------------------------------------------------- yt-dlp

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'avif']);

const resOf = (f) => {
  if (f.width && f.height) return Math.min(f.width, f.height);
  return f.height || null;
};

const bytesOf = (f) => f?.filesize || f?.filesize_approx || null;

function buildVideoOptions(entry) {
  const formats = Array.isArray(entry.formats) && entry.formats.length ? entry.formats : [entry];
  const videos = formats.filter((f) => f.vcodec && f.vcodec !== 'none');
  const audioOnly = formats.filter((f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'));
  // Direct-file links often report no codec info at all; assume they may carry audio.
  const anyAudio = formats.some((f) => (f.acodec && f.acodec !== 'none') || f.acodec == null);
  const bestAudio = audioOnly.sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

  const resolutions = [...new Set(videos.map(resOf).filter((r) => r && r >= 144))].sort((a, b) => b - a);

  const sizeFor = (res) => {
    const candidates = videos.filter((f) => !res || resOf(f) === res).sort((a, b) => (b.tbr || 0) - (a.tbr || 0));
    const v = bytesOf(candidates[0]);
    if (!v) return null;
    const needsAudio = candidates[0]?.acodec === 'none';
    return v + (needsAudio ? bytesOf(bestAudio) || 0 : 0);
  };

  const options = [];
  options.push({
    id: 'best',
    label: resolutions[0] ? `Best · ${resolutions[0]}p` : 'Best quality',
    ext: 'mp4',
    res: resolutions[0] || null,
    sizeBytes: sizeFor(resolutions[0]),
  });
  for (const res of resolutions.slice(1, 5)) {
    options.push({ id: `res:${res}`, label: `${res}p`, ext: 'mp4', res, sizeBytes: sizeFor(res) });
  }
  if (anyAudio) {
    options.push({ id: 'audio', label: 'Audio only', ext: 'mp3', res: null, sizeBytes: bytesOf(bestAudio) });
  }
  return options;
}

function pickThumb(entry) {
  if (entry.thumbnail) return entry.thumbnail;
  const thumbs = Array.isArray(entry.thumbnails) ? entry.thumbnails.filter((t) => t?.url) : [];
  return thumbs.at(-1)?.url || null;
}

export function normalizeYtdlp(info) {
  const isList = info._type === 'playlist';
  const entries = (isList ? info.entries || [] : [info]).filter(Boolean).slice(0, config.maxItemsPerPost);
  const items = entries.map((e, i) => {
    const isImage = IMAGE_EXT.has(String(e.ext || '').toLowerCase());
    return {
      source: 'ytdlp',
      selector: isList ? e.playlist_index || i + 1 : null,
      kind: isImage ? 'image' : 'video',
      thumbnailUrl: pickThumb(e) || (isImage ? e.url : null),
      duration: e.duration ?? null,
      width: e.width ?? null,
      height: e.height ?? null,
      options: isImage
        ? [{ id: 'original', label: 'Original', ext: e.ext, res: null, sizeBytes: bytesOf(e) }]
        : buildVideoOptions(e),
    };
  });
  const first = entries[0] || {};
  return {
    title: info.title || info.description?.slice(0, 120) || first.title || 'Untitled',
    uploader: info.uploader || info.channel || first.uploader || first.channel || null,
    duration: isList ? null : info.duration ?? null,
    items,
  };
}

export async function probeYtdlp(url) {
  const args = [...ytdlpBaseArgs(), '--dump-single-json', '--playlist-end', String(config.maxItemsPerPost), '--', url];
  try {
    const out = await run(tools.ytdlp, args, { timeout: 60_000 });
    const result = normalizeYtdlp(JSON.parse(out));
    if (!result.items.length) throw new ExtractError('NO_VIDEO', 'No downloadable media found in that post.');
    return result;
  } catch (err) {
    throw err instanceof ExtractError ? err : classifyError(err, 'yt-dlp');
  }
}

// ---------------------------------------------------------------- gallery-dl

export function normalizeGallerydl(messages) {
  // gallery-dl -j prints [[2, dirMeta], [3, fileUrl, fileMeta], ...]. Type 3 = a downloadable file.
  const files = messages.filter((m) => Array.isArray(m) && m[0] === 3).slice(0, config.maxItemsPerPost);
  const meta = files[0]?.[2] || messages.find((m) => m[0] === 2)?.[1] || {};

  const items = files.map(([, fileUrl, kw], i) => {
    const ext = String(kw.extension || '').toLowerCase();
    const isImage = IMAGE_EXT.has(ext);
    return {
      source: 'gallerydl',
      selector: i + 1,
      kind: isImage ? 'image' : 'video',
      thumbnailUrl: isImage ? fileUrl : kw.display_url || kw.thumbnail || null,
      duration: kw.duration ?? kw.video_duration ?? null,
      width: kw.width ?? null,
      height: kw.height ?? null,
      options: [{ id: 'original', label: 'Original', ext: ext || 'bin', res: null, sizeBytes: kw.filesize || null }],
    };
  });

  const author = meta.author || meta.user || meta.owner || {};
  const text = meta.description || meta.content || meta.title || meta.caption || '';
  return {
    title: String(text).split('\n')[0].slice(0, 160) || 'Untitled post',
    uploader: meta.username || author.nick || author.name || author.username || meta.fullname || null,
    duration: null,
    items,
  };
}

export async function probeGallerydl(url) {
  const args = [...gallerydlBaseArgs(), '--resolve-json', '--range', `1-${config.maxItemsPerPost}`, '--', url];
  let out;
  try {
    out = await run(tools.gallerydl, args, { timeout: 45_000 });
  } catch (err) {
    throw classifyError(err, 'gallery-dl');
  }
  let messages;
  try {
    messages = JSON.parse(out);
  } catch {
    throw new ExtractError('EXTRACT_FAILED', 'Couldn’t read that post.');
  }
  const result = normalizeGallerydl(Array.isArray(messages) ? messages : []);
  if (!result.items.length) throw new ExtractError('NO_VIDEO', 'No downloadable media found in that post.');
  return result;
}

/**
 * Pick the best extractor result for a link.
 * - yt-dlp gives real quality choices and audio extraction for video.
 * - gallery-dl handles photos and mixed carousels, which yt-dlp skips.
 * For photo-capable platforms both run in parallel; gallery-dl wins only if it found photos.
 */
export async function probe({ url, images }) {
  if (!images) {
    try {
      return await probeYtdlp(url);
    } catch (err) {
      if (!['NO_VIDEO', 'UNSUPPORTED', 'EXTRACT_FAILED'].includes(err.code)) throw err;
      return probeGallerydl(url).catch(() => Promise.reject(err));
    }
  }

  const [yt, gd] = await Promise.allSettled([probeYtdlp(url), probeGallerydl(url)]);
  const gdHasImages = gd.status === 'fulfilled' && gd.value.items.some((i) => i.kind === 'image');
  if (gdHasImages) return gd.value;
  if (yt.status === 'fulfilled') return yt.value;
  if (gd.status === 'fulfilled') return gd.value;
  // Prefer the more specific error (e.g. LOGIN_REQUIRED over a generic failure).
  const errs = [yt.reason, gd.reason];
  return Promise.reject(errs.find((e) => e?.code && e.code !== 'EXTRACT_FAILED' && e.code !== 'NO_VIDEO') || yt.reason);
}
