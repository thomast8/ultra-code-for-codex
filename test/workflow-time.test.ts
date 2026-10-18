import { describe, expect, it } from 'vitest';
import { reviewIntervals } from '../src/runtime/review-timing.js';
import { runTiming } from '../src/ui/workflow-time.js';
import { runFixture, taskFixture } from './panel-ui-dashboard-fixture.js';

describe('workflow timing', () => {
  it('separates the reported transcript worker, unclaimed wait and recorded lead review', () => {
    const run = runFixture({
      createdAt: 0,
      finishedAt: 433_151,
      tasks: [taskFixture({ startedAt: 4, finishedAt: 172_108, state: 'completed' })],
      leadReviews: [{ handoffId: 'review', startedAt: 431_660, finishedAt: 433_147 }],
    });
    expect(runTiming(run, 999_999)).toEqual({ workers: 172_104, waiting: 259_560, review: 1487 });
  });

  it('counts parallel workers once and excludes overlapping reviews from waiting', () => {
    const run = runFixture({
      createdAt: 0,
      tasks: [taskFixture({ startedAt: 1000, finishedAt: 5000 }), taskFixture({ startedAt: 3000 })],
      leadReviews: [{ handoffId: 'review', startedAt: 4000, finishedAt: null }],
    });
    expect(runTiming(run, 7000)).toEqual({ workers: 6000, review: 3000, waiting: 1000 });
  });

  it('does not invent lead timing for snapshots without journal timing', () => {
    expect(runTiming(runFixture(), 5000)).toEqual({ workers: 4000, waiting: null, review: null });
  });

  it('marks unknown worker termination and uncertain waiting without hiding known review', () => {
    const run = runFixture({
      tasks: [taskFixture({ state: 'needs_reconciliation' })],
      leadReviews: [],
    });
    expect(runTiming(run, 5000)).toEqual({ workers: null, waiting: null, review: 0 });
  });

  it('counts queued time as waiting and clips intervals to the run lifetime', () => {
    const run = runFixture({
      createdAt: 2000,
      finishedAt: 6000,
      tasks: [taskFixture({ startedAt: null })],
      leadReviews: [{ handoffId: 'review', startedAt: 4000, finishedAt: 9000 }],
    });
    expect(runTiming(run, 10000)).toEqual({ workers: 0, waiting: 2000, review: 2000 });
  });
});

it('reconstructs historical review intervals, interruption and readback from journal events', () => {
  const events = [
    { type: 'handoff.claimed', timestamp: 10, reference: 'one' },
    { type: 'lead.result', timestamp: 20, reference: 'one' },
    { type: 'handoff.claimed', timestamp: 30, reference: 'two' },
    { type: 'run.reconciliation_required', timestamp: 40, reference: null },
    { type: 'worker.readback_claimed', timestamp: 50, reference: 'two' },
    { type: 'worker.readback_resolved', timestamp: 60, reference: 'two' },
    { type: 'handoff.claimed', timestamp: 70, reference: 'three' },
    { type: 'handoff.claimed', timestamp: 80, reference: null },
  ];
  expect(reviewIntervals(events)).toEqual([
    { handoffId: 'one', startedAt: 10, finishedAt: 20 },
    { handoffId: 'two', startedAt: 30, finishedAt: 40 },
    { handoffId: 'two', startedAt: 50, finishedAt: 60 },
    { handoffId: 'three', startedAt: 70, finishedAt: null },
  ]);
});
