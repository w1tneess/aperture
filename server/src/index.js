import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { z } from 'zod';
import { config } from './config.js';
import { ExtractError, probe } from './extract.js';
import { activeJobsFor, createJob, events, getJob, getProbe, initStorage, markSaved, publicJob, saveProbe } from './jobs.js';
import { PLATFORMS, resolveUrl } from './platforms.js';
import { resolveTools, tools } from './tools.js';
import { hasInstagramLogin, initCookies } from './cookies.js';
import { apifyEnabled } from './apify.js';
import { startAutoUpdate } from './updater.js';

const app = express();
if (config.trustProxy) app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    // Aperture is usually served over plain http on a home network (e.g. your phone -> http://192.168.x.x:8787).
    // Helmet's default upgrade-insecure-requests would rewrite every request to https and break the page,
    // and HSTS would pin https on that address. Put it behind an https reverse proxy if you expose it publicly.
    contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
    strictTransportSecurity: false,
    crossOriginOpenerPolicy: false, // ignored by browsers on http anyway; avoids console noise
  }),
);
app.use(express.json({ limit: '16kb' }));
app.use(cookieParser());

const limiter = (limit) => rateLimit({ windowMs: 60_000, limit, standardHeaders: 'draft-7', legacyHeaders: false });

const fail = (res, status, code, message, detail) =>
  res.status(status).json({ error: { code, message, ...(detail && !config.isProd ? { detail } : {}) } });

// ------------------------------------------------------------ passcode gate

const SESSION_COOKIE = 'aperture_session';
const sessionToken = crypto.createHmac('sha256', config.sessionSecret).update(`v1:${config.passcode}`).digest('hex');

function isAuthed(req) {
  if (!config.passcode) return true;
  const value = String(req.cookies?.[SESSION_COOKIE] || '');
  return value.length === sessionToken.length && crypto.timingSafeEqual(Buffer.from(value), Buffer.from(sessionToken));
}

app.get('/api/session', (req, res) => res.json({ required: Boolean(config.passcode), authed: isAuthed(req) }));

app.post(
  '/api/session',
  rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false }),
  (req, res) => {
    const parsed = z.object({ passcode: z.string().min(1).max(200) }).safeParse(req.body);
    if (!parsed.success) return fail(res, 422, 'VALIDATION', 'Enter the passcode.');
    // Hash both sides so the comparison is constant-time regardless of length.
    const a = crypto.createHash('sha256').update(parsed.data.passcode).digest();
    const b = crypto.createHash('sha256').update(config.passcode).digest();
    if (!config.passcode || !crypto.timingSafeEqual(a, b)) return fail(res, 401, 'BAD_PASSCODE', 'Wrong passcode.');
    res.cookie(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure,
      maxAge: 30 * 24 * 60 * 60_000,
    });
    res.json({ required: true, authed: true });
  },
);

app.use('/api', (req, res, next) => (isAuthed(req) ? next() : fail(res, 401, 'AUTH_REQUIRED', 'Passcode required.')));

// ------------------------------------------------------------------ routes

app.get('/api/info', (_req, res) => {
  const enabled = PLATFORMS.filter((p) => !config.enabledPlatforms || config.enabledPlatforms.includes(p.id));
  res.json({
    name: config.appName,
    platforms: enabled.map(({ id, name }) => ({ id, name })),
    instagramLogin: hasInstagramLogin(),
    instagramBackup: apifyEnabled(),
    publicMode: config.publicMode,
    maxDurationMinutes: Math.round(config.maxDurationSec / 60),
    maxFilesize: config.maxFilesize,
    fileLifetimeMinutes: Math.round(config.jobTtlMs / 60_000),
    contactUrl: config.contactUrl || null,
    repoUrl: config.repoUrl || null,
    extractors: { ytdlp: tools.ytdlp.version, gallerydl: tools.gallerydl.version },
  });
});

app.get('/api/platforms', (_req, res) => {
  res.json({ platforms: PLATFORMS.map(({ id, name, hosts }) => ({ id, name, hosts })), extraHosts: config.extraHosts });
});

app.post('/api/probe', limiter(config.probeLimitPerMin), async (req, res) => {
  const parsed = z.object({ url: z.string().min(1).max(2048) }).safeParse(req.body);
  if (!parsed.success) return fail(res, 422, 'VALIDATION', 'Paste a link first.');

  const target = resolveUrl(parsed.data.url, config.extraHosts, config.enabledPlatforms);
  if ('error' in target) return fail(res, 422, 'BAD_URL', target.error);

  try {
    const result = await probe(target);
    const saved = saveProbe({ ...result, url: target.url, platform: target.platform });
    res.json({
      probeId: saved.id,
      url: saved.url,
      platform: saved.platform,
      title: saved.title,
      uploader: saved.uploader,
      duration: saved.duration,
      items: saved.items.map((item, index) => ({
        index,
        kind: item.kind,
        thumbnail: item.thumbnailUrl ? `/api/thumb/${saved.id}/${index}` : null,
        duration: item.duration,
        width: item.width,
        height: item.height,
        options: item.options,
      })),
    });
  } catch (err) {
    if (err instanceof ExtractError) {
      console.warn(`[probe] ${target.platform} ${err.code}: ${err.log || err.message}`);
      const status = err.code === 'MISSING_TOOL' ? 500 : err.code === 'TIMEOUT' ? 504 : 422;
      return fail(res, status, err.code, err.message, err.detail);
    }
    console.error('[probe] unexpected', err);
    return fail(res, 500, 'INTERNAL', 'Something went wrong on the server.');
  }
});

// Thumbnails are proxied because platform CDNs block cross-site embedding (e.g. Instagram's CORP header).
// The URL comes from the extractor's own output, never from the client, so this can't be used as an open proxy.
app.get('/api/thumb/:probeId/:index', limiter(240), async (req, res) => {
  const p = getProbe(req.params.probeId);
  const item = p?.items[Number(req.params.index)];
  if (!item?.thumbnailUrl) return res.sendStatus(404);
  try {
    const upstream = await fetch(item.thumbnailUrl, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'user-agent': 'Mozilla/5.0 (Aperture personal downloader)' },
    });
    const type = upstream.headers.get('content-type') || '';
    const length = Number(upstream.headers.get('content-length') || 0);
    if (!upstream.ok || !type.startsWith('image/') || length > 15 * 1024 * 1024) return res.sendStatus(502);
    const body = Buffer.from(await upstream.arrayBuffer());
    if (body.length > 15 * 1024 * 1024) return res.sendStatus(502);
    res.set({ 'content-type': type, 'cache-control': 'private, max-age=1800' }).send(body);
  } catch {
    res.sendStatus(502);
  }
});

const JobInput = z.object({
  probeId: z.string().uuid(),
  index: z.number().int().min(0).max(100),
  optionId: z.string().regex(/^(best|original|audio|audio:m4a|res:\d{2,4})$/),
});

app.post('/api/jobs', limiter(60), (req, res) => {
  const parsed = JobInput.safeParse(req.body);
  if (!parsed.success) return fail(res, 422, 'VALIDATION', 'Invalid download request.');
  const { probeId, index, optionId } = parsed.data;

  const p = getProbe(probeId);
  if (!p) return fail(res, 410, 'EXPIRED', 'That preview expired. Fetch the link again.');
  const item = p.items[index];
  if (!item) return fail(res, 404, 'NOT_FOUND', 'That item doesn’t exist.');
  const base = optionId.startsWith('audio') ? 'audio' : optionId;
  if (!item.options.some((o) => o.id === base)) return fail(res, 422, 'BAD_OPTION', 'That quality isn’t available.');
  if (item.duration && item.duration > config.maxDurationSec) {
    return fail(res, 422, 'TOO_LONG', `Videos longer than ${Math.round(config.maxDurationSec / 60)} minutes aren’t supported here.`);
  }
  if (activeJobsFor(req.ip) >= config.maxJobsPerIp) {
    return fail(res, 429, 'BUSY', `You already have ${config.maxJobsPerIp} downloads running. Wait for one to finish.`);
  }

  res.status(201).json(publicJob(createJob({ probe: p, index, optionId, ip: req.ip })));
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  return job ? res.json(publicJob(job)) : fail(res, 404, 'NOT_FOUND', 'Download not found.');
});

app.get('/api/jobs/:id/events', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return fail(res, 404, 'NOT_FOUND', 'Download not found.');

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const onUpdate = (data) => {
    send(data);
    if (data.status === 'done' || data.status === 'error') cleanup();
  };
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);
  const cleanup = () => {
    clearInterval(heartbeat);
    events.off(job.id, onUpdate);
    res.end();
  };
  req.on('close', cleanup);
  events.on(job.id, onUpdate);
  onUpdate(publicJob(job));
});

app.get('/api/jobs/:id/file', (req, res) => {
  const job = getJob(req.params.id);
  if (!job || job.status !== 'done' || !job.filePath) return fail(res, 404, 'NOT_FOUND', 'File not ready or expired.');
  res.download(job.filePath, job.filename, { dotfiles: 'deny' }, (err) => {
    if (err) {
      if (!res.headersSent) fail(res, 410, 'EXPIRED', 'That file expired. Download it again.');
      return;
    }
    markSaved(job);
  });
});

app.use('/api', (_req, res) => fail(res, 404, 'NOT_FOUND', 'Unknown endpoint.'));

// --------------------------------------------------- built frontend (prod)

const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') return fail(res, 400, 'BAD_JSON', 'Malformed request.');
  console.error('[server] unhandled', err);
  fail(res, 500, 'INTERNAL', 'Something went wrong on the server.');
});

await initStorage();
await resolveTools();
await initCookies();
startAutoUpdate();
app.listen(config.port, config.host, () => {
  console.log(`Aperture server on http://${config.host}:${config.port}`);
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(config.host);
  if (config.publicMode) console.log('ℹ  PUBLIC_MODE on: stricter limits; personal cookies off (Instagram-only cookies allowed).');
  if (!loopback && !config.passcode && !config.publicMode) {
    console.warn('⚠  Listening beyond localhost without APP_PASSCODE. Anyone on the network can use this server.');
  }
  if (apifyEnabled()) console.log(`✓ Instagram backup via Apify (max ${config.apifyDailyLimit} lookups/day)`);
  if (!hasInstagramLogin() && !apifyEnabled()) console.log('ℹ  No Instagram login cookies: many Instagram posts will fail (see README).');
});
