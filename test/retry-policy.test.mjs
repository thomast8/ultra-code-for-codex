import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRetryPolicy } from '../src/retry-policy.mjs';

test('defaults an omitted options object and an omitted count', () => {
  assert.deepEqual(resolveRetryPolicy(), { maxRetries: 3 });
  assert.deepEqual(resolveRetryPolicy({}), { maxRetries: 3 });
});

test('defaults null and undefined counts', () => {
  assert.deepEqual(resolveRetryPolicy({ maxRetries: null }), { maxRetries: 3 });
  assert.deepEqual(resolveRetryPolicy({ maxRetries: undefined }), { maxRetries: 3 });
});

test('preserves positive retry counts', () => {
  assert.deepEqual(resolveRetryPolicy({ maxRetries: 1 }), { maxRetries: 1 });
  assert.deepEqual(resolveRetryPolicy({ maxRetries: 7 }), { maxRetries: 7 });
});
