import assert from 'node:assert/strict';

assert.equal(process.version, 'v26.10.0', 'Use the pinned Node 26.10.0 runtime');
console.log('Node runtime verified; no dependencies or caches are required.');
