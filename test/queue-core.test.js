const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateWait } = require('../src/services/queue-core');

test('estimates queue workload across counter capacity and remaining service time', () => {
  const now = new Date('2026-01-01T10:10:00Z');
  const result = calculateWait([
    { status: 'serving', startedAt: new Date('2026-01-01T10:05:00Z') },
    { status: 'waiting', startedAt: null },
    { status: 'waiting', startedAt: null },
  ], 10, 2, now);

  assert.deepEqual(result, { waitMinutes: 13, waitingCount: 2, servingCount: 1 });
});

test('returns zero wait for an empty queue', () => {
  assert.deepEqual(calculateWait([], 8, 1), {
    waitMinutes: 0,
    waitingCount: 0,
    servingCount: 0,
  });
});
