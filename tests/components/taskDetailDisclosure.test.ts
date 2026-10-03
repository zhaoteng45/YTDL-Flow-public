import { expect, it } from 'vitest';
import { nextTaskDetailView } from '../../src/components/taskDetailDisclosure';
it('opens useful diagnostics when the task cannot be configured and retains a prior selection when appropriate', () => {
  expect(nextTaskDetailView(undefined, false)).toBe('diagnostics');
  expect(nextTaskDetailView('options', false)).toBe('diagnostics');
  expect(nextTaskDetailView('diagnostics', true)).toBe('diagnostics');
  expect(nextTaskDetailView(undefined, true)).toBe('options');
});
