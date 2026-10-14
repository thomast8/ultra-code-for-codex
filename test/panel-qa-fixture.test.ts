import { expect, it } from 'vitest';
import { workflowSnapshot } from '../src/ui/snapshots.js';
import { qaRuns } from './panel-qa-fixture.js';

it('builds a QA fixture the panel accepts as a real workflow snapshot', () => {
  const runs = qaRuns(10_000_000);
  const parsed = workflowSnapshot.safeParse({ runs, cursor: 1 });
  expect(parsed.error?.issues).toBeUndefined();
  expect(runs.map((run) => run.title)).toContain('QA fixture · Preserve an explicit zero');
  const lead = runs.find((run) => run.id === 'qa-zero');
  expect(lead?.result).toMatchObject({ readyPr: expect.stringMatching(/^https:/) });
});
