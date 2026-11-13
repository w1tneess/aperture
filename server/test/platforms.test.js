import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractUrl, isBlocked, resolveUrl } from '../src/platforms.js';

test('detects each supported platform', () => {
  const cases = {
    'https://www.instagram.com/reel/C0abc123/': 'instagram',
    'https://x.com/user/status/1234567890': 'x',
    'https://twitter.com/user/status/1234567890': 'x',
    'https://www.facebook.com/watch/?v=123': 'facebook',
    'https://fb.watch/abcDEF/': 'facebook',
    'https://vm.tiktok.com/ZMabc/': 'tiktok',
    'https://youtu.be/dQw4w9WgXcQ': 'youtube',
    'https://www.threads.net/@user/post/abc': 'threads',
    'https://old.reddit.com/r/videos/comments/abc/x/': 'reddit',
    'https://pin.it/abc': 'pinterest',
  };
  for (const [url, platform] of Object.entries(cases)) {
    assert.equal(resolveUrl(url).platform, platform, url);
  }
});

test('pulls the link out of shared text', () => {
  assert.equal(extractUrl('lol look https://x.com/a/status/1). nice'), 'https://x.com/a/status/1');
  assert.equal(resolveUrl('Check this out: https://www.instagram.com/p/abc/ 🔥').platform, 'instagram');
});

test('rejects lookalike, unlisted and unsafe hosts', () => {
  assert.ok('error' in resolveUrl('https://instagram.com.evil.example/p/abc'));
  assert.ok('error' in resolveUrl('https://notinstagram.com/p/abc'));
  assert.ok('error' in resolveUrl('http://127.0.0.1:8080/admin'));
  assert.ok('error' in resolveUrl('https://user:pw@x.com/a'));
  assert.ok('error' in resolveUrl('file:///etc/passwd'));
  assert.ok('error' in resolveUrl('javascript:alert(1)'));
  assert.ok('error' in resolveUrl(''));
});

test('EXTRA_HOSTS opts additional sites in', () => {
  assert.equal(resolveUrl('https://vimeo.com/123', ['vimeo.com']).platform, 'other');
  assert.ok('error' in resolveUrl('https://vimeo.com/123'));
});

test('disabled platforms are rejected with a clear reason', () => {
  const enabled = ['instagram', 'x', 'facebook', 'pinterest'];
  assert.equal(resolveUrl('https://www.instagram.com/reel/abc/', [], enabled).platform, 'instagram');
  const yt = resolveUrl('https://youtu.be/dQw4w9WgXcQ', [], enabled);
  assert.ok('error' in yt && /YouTube/.test(yt.error));
  assert.ok('error' in resolveUrl('https://www.tiktok.com/@a/video/1', [], enabled));
});

test('Instagram video flagged has_audio:false is known silent; hidden audio is not', async () => {
  const { normalizeYtdlp } = await import('../src/extract.js');
  const silent = normalizeYtdlp({ formats: [
    { format_id: '0', ext: 'mp4', vcodec: null, acodec: 'none', url: 'u' },
    { format_id: 'dash-1v', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 1280, width: 720 },
  ] });
  assert.equal(silent.items[0].knownSilent, true);
  const hidden = normalizeYtdlp({ formats: [
    { format_id: '0', ext: 'mp4', vcodec: null, acodec: null, url: 'u' },
    { format_id: 'dash-1v', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 1280, width: 720 },
  ] });
  assert.equal(hidden.items[0].knownSilent, false);
});

test('Instagram photos without video become direct image items; foreign hosts are refused', async () => {
  const { normalizeYtdlp } = await import('../src/extract.js');
  const cdn = (n) => `https://scontent-ord5-1.cdninstagram.com/v/t51/${n}.jpg?x=1`;
  const r = normalizeYtdlp({
    _type: 'playlist',
    entries: [
      { formats: [], thumbnails: [{ url: cdn('small') }, { url: cdn('big') }] },
      { formats: [{ format_id: 'dash-1v', vcodec: 'avc1', acodec: 'none', height: 1280, width: 720 }] },
      { formats: [], thumbnails: [{ url: 'https://evil.example/x.jpg' }] },
    ],
  }, { photos: true });
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].kind, 'image');
  assert.equal(r.items[0].source, 'direct');
  assert.equal(r.items[0].mediaUrl, cdn('big'));
  assert.equal(r.items[1].kind, 'video');
});

test('blocks links named in a takedown list', () => {
  const blocked = ['instagram.com/reel/c0abc123'];
  assert.equal(isBlocked('https://www.instagram.com/reel/C0abc123/?igsh=x', blocked), true);
  assert.equal(isBlocked('https://www.instagram.com/reel/Other999/', blocked), false);
  assert.equal(isBlocked('https://x.com/a/status/1', []), false);
  // percent-encoded (even double-encoded) ids can't dodge the list; malformed escapes don't throw
  assert.equal(isBlocked('https://www.instagram.com/reel/%43%30abc123/', blocked), true);
  assert.equal(isBlocked('https://www.instagram.com/reel/%2543%2530abc123/', blocked), true);
  assert.equal(isBlocked('https://www.instagram.com/reel/%E0%A4%A/', blocked), false);
  // resolved URL/id from the extractor (after a short-link redirect)
  assert.equal(isBlocked('https://www.instagram.com/reel/C0abc123/ C0abc123', ['c0abc123']), true);
  assert.equal(isBlocked(undefined, blocked), false);
});

test('video preview: a single-file MP4 with sound, smallest at 360p or more', async () => {
  const { previewOf } = await import('../src/extract.js');
  const f = (format_id, height, acodec, extra = {}) => ({
    format_id, width: height, height, acodec, vcodec: 'h264', ext: 'mp4', protocol: 'https', url: `https://cdn.test/${format_id}.mp4`, ...extra,
  });
  const formats = [
    f('dash-1080', 1080, 'none'),
    f('hls-720', 720, 'aac', { protocol: 'm3u8_native' }),
    f('240', 240, 'aac'),
    f('720', 720, 'aac'),
    f('480', 480, 'aac'),
    f('1080-silent', 1080, 'none'),
  ];
  assert.equal(previewOf({ formats }), 'https://cdn.test/480.mp4');
  // Instagram logged out: plain MP4s report unknown audio; still better than nothing.
  assert.equal(previewOf({ formats: [f('dash-a', 720, 'none'), f('8', 640, null)] }), 'https://cdn.test/8.mp4');
  assert.equal(previewOf({ formats: [f('hls', 720, 'aac', { protocol: 'm3u8_native' })] }), null);
  assert.equal(previewOf({ formats: [f('x', 720, 'aac', { url: 'http://insecure.test/x.mp4' })] }), null);
});
