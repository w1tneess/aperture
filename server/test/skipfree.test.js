import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { noteFree, skippingFree } from '../src/extract.js';

test('Instagram goes straight to the backup after 3 free-path misses, for 10 minutes', (t) => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  t.after(() => mock.timers.reset());
  t.mock.method(console, 'warn', () => {});

  noteFree(false, 'LOGIN_REQUIRED');
  noteFree(false, 'NOT_FOUND'); // a deleted post isn't a sign of blocking
  noteFree(false);
  assert.equal(skippingFree(), false);
  noteFree(false, 'TIMEOUT');
  assert.equal(skippingFree(), true);

  mock.timers.tick(10 * 60_000);
  assert.equal(skippingFree(), false, 'tries the free path again after the window');

  noteFree(false);
  noteFree(false);
  noteFree(true); // a success resets the count
  noteFree(false);
  assert.equal(skippingFree(), false);
});
