// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { humanizeKey, resultSummary, StructuredValue } from '../src/ui/result-value.js';

afterEach(cleanup);

const leadResult = {
  summary: 'Explicit zero is preserved; isolated fixture ready PR verified and left unmerged.',
  testCases: 9,
  coveragePercent: 100,
  workerAcceptancePreserved: 'incomplete',
  merged: false,
  notes: null,
  readyPr: 'https://github.com/thomast8/ultra-code-for-codex/pull/2',
  files: ['src/retry.ts', 'test/retry.test.ts'],
  gates: [{ name: 'lint', passed: true }],
};

it('humanizes camelCase and snake_case keys with known acronyms', () => {
  expect(humanizeKey('testCases')).toBe('Test cases');
  expect(humanizeKey('readyPr')).toBe('Ready PR');
  expect(humanizeKey('worker_acceptance_preserved')).toBe('Worker acceptance preserved');
  expect(humanizeKey('apiURL')).toBe('API URL');
});

it('summarises results as prose instead of serialised JSON', () => {
  expect(resultSummary(leadResult)).toEqual({ text: leadResult.summary, key: 'summary' });
  expect(resultSummary('Done.')).toEqual({ text: 'Done.', key: null });
  expect(resultSummary({ count: 2, note: 'First string wins' })).toEqual({
    text: 'First string wins',
    key: 'note',
  });
  expect(resultSummary({ count: 2 })).toEqual({ text: '1 field reported', key: null });
  expect(resultSummary([1, 2])).toEqual({ text: '2 items reported', key: null });
  expect(resultSummary(null)).toBeNull();
  expect(resultSummary(42)).toEqual({ text: '42', key: null });
});

it('renders structured values as labelled facts, links and lists', () => {
  render(createElement(StructuredValue, { value: leadResult, omit: 'summary' }));
  expect(screen.queryByText(leadResult.summary)).toBeNull();
  expect(screen.getByText('Test cases').nextSibling?.textContent).toBe('9');
  expect(screen.getByText('Coverage percent').nextSibling?.textContent).toBe('100%');
  expect(screen.getByText('Merged').nextSibling?.textContent).toBe('No');
  expect(screen.getByText('Notes').nextSibling?.textContent).toBe('—');
  const link = screen.getByRole('link', {
    name: 'github.com/thomast8/ultra-code-for-codex/pull/2',
  });
  expect(link.getAttribute('href')).toBe(leadResult.readyPr);
  expect(screen.getByText('src/retry.ts').tagName).toBe('LI');
  expect(screen.getByText('Passed').nextSibling?.textContent).toBe('Yes');
  expect(document.body.textContent).not.toContain('{');
  expect(document.body.textContent).not.toContain('"');
});

it('renders plain, multi-line, empty and unsafe values without markup leaks', () => {
  const { rerender } = render(createElement(StructuredValue, { value: 'line one\nline two' }));
  expect(document.querySelector('.result-text')?.textContent).toBe('line one\nline two');
  rerender(createElement(StructuredValue, { value: { items: [], uri: 'javascript:alert(1)' } }));
  expect(screen.getByText('None')).toBeDefined();
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.getByText('javascript:alert(1)')).toBeDefined();
  rerender(createElement(StructuredValue, { value: [] }));
  expect(screen.getByText('None')).toBeDefined();
  rerender(createElement(StructuredValue, { value: { ratio: 1234.5, ok: true } }));
  expect(screen.getByText('1,234.5')).toBeDefined();
});
