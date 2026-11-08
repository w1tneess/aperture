import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeApify } from '../src/apify.js';

const CDN = 'https://scontent-sin6-1.cdninstagram.com/v/t50/abc.mp4?x=1';
const IMG = 'https://instagram.fsin10-1.fna.fbcdn.net/v/t51/abc.jpg';

test('single video post becomes one video item with original + audio', () => {
  const r = normalizeApify({ type: 'Video', videoUrl: CDN, displayUrl: IMG, caption: 'Hello\nworld', ownerUsername: 'naomipq', videoDuration: 8.7 });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].kind, 'video');
  assert.equal(r.items[0].source, 'direct');
  assert.deepEqual(r.items[0].options.map((o) => o.id), ['original', 'audio']);
  assert.equal(r.title, 'Hello');
  assert.equal(r.uploader, 'naomipq');
});

test('carousel (Sidecar) becomes one item per child, photos and videos', () => {
  const r = normalizeApify({
    type: 'Sidecar',
    displayUrl: IMG,
    childPosts: [{ type: 'Image', displayUrl: IMG }, { type: 'Video', videoUrl: CDN, displayUrl: IMG }],
  });
  assert.deepEqual(r.items.map((i) => i.kind), ['image', 'video']);
  assert.deepEqual(r.items.map((i) => i.selector), [1, 2]);
});

test('media on non-Instagram hosts is refused (no arbitrary fetches)', () => {
  assert.throws(() => normalizeApify({ type: 'Video', videoUrl: 'https://evil.example/x.mp4', displayUrl: 'http://169.254.169.254/' }), { code: 'NO_VIDEO' });
  assert.throws(() => normalizeApify({ type: 'Video', videoUrl: 'https://cdninstagram.com.evil.example/x.mp4' }), { code: 'NO_VIDEO' });
});

test('Apify errors map to clear codes', () => {
  assert.throws(() => normalizeApify({ error: 'not_found', errorDescription: 'Post does not exist' }), { code: 'NOT_FOUND' });
  assert.throws(() => normalizeApify({ error: 'restricted_page', errorDescription: 'Private' }), { code: 'PRIVATE' });
});
