import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractUrl, resolveUrl } from '../src/platforms.js';

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
