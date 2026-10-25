import { jest } from '@jest/globals';
import { fieldComparison } from '../app/fiction/field-comparison.js';
const form = (name) => ({
  name,
  description: 'A description.',
  data: { motive: 'A motive.' },
});
describe('explicit reference field acceptance', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    let id = 0;
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      configurable: true,
      value: () => `comparison-${++id}`,
    });
  });
  test('an edit made during generation starts unchecked even when text returned to the seed', () => {
    const apply = jest.fn();
    const root = fieldComparison({
      fields: ['name', 'description'],
      before: form('Seed'),
      proposal: { ...form('Candidate'), description: 'Candidate description.' },
      getCurrent: () => form('Seed'),
      changed: (key) => key === 'name',
      onApply: apply,
    });
    document.body.append(root);
    const checks = root.querySelectorAll('input[type=checkbox]');
    expect(checks[0].checked).toBe(false);
    expect(checks[1].checked).toBe(true);
    root.querySelector('button').click();
    expect(apply).toHaveBeenCalledWith(
      { ...form('Seed'), description: 'Candidate description.' },
      ['description'],
    );
  });
  test('later edits cannot be overwritten by a stale comparison', () => {
    let current = form('Seed');
    const apply = jest.fn();
    const root = fieldComparison({
      fields: ['name'],
      before: current,
      proposal: form('Candidate'),
      getCurrent: () => current,
      onApply: apply,
    });
    document.body.append(root);
    current = form('A later edit');
    root.querySelector('button').click();
    expect(apply).not.toHaveBeenCalled();
    expect(root.querySelector('[role=alert]').textContent).toContain(
      'changed after comparison',
    );
  });
  test('restore selects untouched fields while preserving later edits', () => {
    const accepted = {
      ...form('Candidate'),
      description: 'Candidate description.',
    };
    const current = { ...accepted, name: 'Later name' };
    const apply = jest.fn();
    const root = fieldComparison({
      fields: ['name', 'description'],
      before: accepted,
      proposal: form('Seed'),
      getCurrent: () => current,
      onApply: apply,
      applyLabel: 'Restore selected previous fields',
    });
    document.body.append(root);
    root.querySelector('button').click();
    expect(apply).toHaveBeenCalledWith({ ...form('Later name') }, [
      'description',
    ]);
  });
});
