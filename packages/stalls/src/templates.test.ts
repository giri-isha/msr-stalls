import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_KEYS,
  TEMPLATE_PLACEHOLDERS,
  renderTemplate,
  unknownPlaceholders,
} from './templates';

describe('default templates', () => {
  it('seeds one template per key', () => {
    expect(DEFAULT_TEMPLATES.map((t) => t.key).sort()).toEqual([...TEMPLATE_KEYS].sort());
  });

  it('uses only placeholders the module can fill', () => {
    for (const t of DEFAULT_TEMPLATES) {
      expect(unknownPlaceholders(`${t.subject}\n${t.body}`)).toEqual([]);
    }
  });

  it('never offers the vendor letter to an ashram department', () => {
    const vendorLetter = DEFAULT_TEMPLATES.find((t) => t.key === 'SELECTION_VENDOR');
    expect(vendorLetter?.appliesTo).not.toContain('ASHRAM');
    expect(vendorLetter?.body).toContain('{{bankFormUrl}}');
  });

  it('keeps the bank-form link out of the ashram letter', () => {
    const ashram = DEFAULT_TEMPLATES.find((t) => t.key === 'SELECTION_ASHRAM');
    expect(ashram?.body).not.toContain('bankFormUrl');
  });
});

describe('renderTemplate', () => {
  it('substitutes what it is given', () => {
    expect(
      renderTemplate('Hi {{requesterName}}, stall {{stallNumbers}}.', {
        requesterName: 'Priya',
        stallNumbers: 'C1-4, C1-5',
      }),
    ).toBe('Hi Priya, stall C1-4, C1-5.');
  });

  it('tolerates spacing inside the braces', () => {
    expect(renderTemplate('{{ stallName }}', { stallName: 'Green Leaf' })).toBe('Green Leaf');
  });

  it('empties a placeholder it cannot fill rather than leaking braces', () => {
    expect(renderTemplate('Fee: {{feeTotal}}', {})).toBe('Fee: ');
  });

  it('leaves text with no placeholders untouched', () => {
    expect(renderTemplate('No variables here.', { stallName: 'x' })).toBe('No variables here.');
  });
});

describe('unknownPlaceholders', () => {
  it('names a typo so the editor can warn before the mail goes out', () => {
    expect(unknownPlaceholders('Hi {{requestorName}} and {{stallName}}')).toEqual([
      'requestorName',
    ]);
  });

  it('reports each unknown name once', () => {
    expect(unknownPlaceholders('{{oops}} {{oops}}')).toEqual(['oops']);
  });

  it('knows every documented placeholder', () => {
    const all = TEMPLATE_PLACEHOLDERS.map((p) => `{{${p.key}}}`).join(' ');
    expect(unknownPlaceholders(all)).toEqual([]);
  });
});
