import { describe, expect, test } from 'vitest';
import {
  DEFAULT_TEMPLATES,
  PLACEHOLDERS,
  TEMPLATE_KEYS,
  placeholdersIn,
  renderTemplate,
} from './templates';

describe('renderTemplate', () => {
  test('fills placeholders and tolerates spaces inside the braces', () => {
    const { text, missing } = renderTemplate('Hi {{ name }}, stall {{stall}}.', {
      name: 'Priya',
      stall: 'C1-1',
    });
    expect(text).toBe('Hi Priya, stall C1-1.');
    expect(missing).toEqual([]);
  });

  test('a missing value renders empty and is reported, never left as braces', () => {
    const { text, missing } = renderTemplate('Ref {{reference}} / {{nope}}', { reference: 'X' });
    expect(text).toBe('Ref X / ');
    expect(missing).toEqual(['nope']);
  });

  test('numbers render; null and empty count as missing', () => {
    const { text, missing } = renderTemplate('{{n}}|{{e}}|{{z}}', { n: 3, e: '', z: null });
    expect(text).toBe('3||');
    expect(missing.sort()).toEqual(['e', 'z']);
  });
});

describe('DEFAULT_TEMPLATES', () => {
  test('exists for every key', () => {
    expect(Object.keys(DEFAULT_TEMPLATES).sort()).toEqual([...TEMPLATE_KEYS].sort());
  });

  test('uses only placeholders its key allows', () => {
    for (const key of TEMPLATE_KEYS) {
      const used = placeholdersIn(
        `${DEFAULT_TEMPLATES[key].subject}\n${DEFAULT_TEMPLATES[key].body}`,
      );
      for (const p of used) expect(PLACEHOLDERS[key], `${key} uses ${p}`).toContain(p);
    }
  });

  test('the selection templates carry the bank form link for vendors and local welfare, and not for ashram', () => {
    expect(placeholdersIn(DEFAULT_TEMPLATES.SELECTION_VENDOR.body)).toContain('bankFormUrl');
    expect(placeholdersIn(DEFAULT_TEMPLATES.SELECTION_LOCAL_WELFARE.body)).toContain('bankFormUrl');
    expect(placeholdersIn(DEFAULT_TEMPLATES.SELECTION_ASHRAM.body)).not.toContain('bankFormUrl');
  });
});
