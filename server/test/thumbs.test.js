import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { thumbnail } from '../src/thumbs.js';

let server;
let base;
const hits = {};

before(async () => {
  server = http.createServer((req, res) => {
    hits[req.url] = (hits[req.url] || 0) + 1;
    if (req.url === '/ok.jpg') return res.writeHead(200, { 'content-type': 'image/jpeg' }).end('jpegbytes');
    if (req.url === '/page') return res.writeHead(200, { 'content-type': 'text/html' }).end('<html>');
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('fetches an image once and serves repeats from memory', async () => {
  const [a, b] = await Promise.all([thumbnail(`${base}/ok.jpg`), thumbnail(`${base}/ok.jpg`)]);
  const c = await thumbnail(`${base}/ok.jpg`);
  assert.equal(a.type, 'image/jpeg');
  assert.equal(String(a.body), 'jpegbytes');
  assert.equal(b, a);
  assert.equal(c, a);
  assert.equal(hits['/ok.jpg'], 1);
});

test('failures resolve to null and are retried next time', async () => {
  assert.equal(await thumbnail(`${base}/missing.jpg`), null);
  assert.equal(await thumbnail(`${base}/missing.jpg`), null);
  assert.equal(hits['/missing.jpg'], 2);
  assert.equal(await thumbnail(`${base}/page`), null); // not an image
  assert.equal(await thumbnail('http://127.0.0.1:1/unreachable.jpg'), null); // never rejects
});
