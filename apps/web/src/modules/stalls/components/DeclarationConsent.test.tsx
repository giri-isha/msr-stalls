import type { Declaration } from '@msr/stalls';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { DeclarationConsent, allTicked } from './DeclarationConsent';

const d = (id: string, body: string, over: Partial<Declaration> = {}): Declaration => ({
  id,
  key: id,
  formType: null,
  version: 1,
  title: id,
  body,
  bodyTa: null,
  isActive: true,
  isCurrent: true,
  ...over,
});

describe('the consent block', () => {
  /** 🔴 One tick PER declaration. `recordConsent` writes a row each, so a
   *  single tick over three would log three agreements from one gesture — a
   *  record claiming more than the reader did. */
  test('draws one tick per declaration, each labelled by its own wording', () => {
    render(
      <DeclarationConsent
        declarations={[d('a', 'First wording.'), d('b', 'Second wording.')]}
        ticked={new Set()}
        onToggle={() => {}}
      />,
    );
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getByText('First wording.')).toBeInTheDocument();
    expect(screen.getByText('Second wording.')).toBeInTheDocument();
  });

  test('reports the id that was ticked', async () => {
    const onToggle = vi.fn();
    render(
      <DeclarationConsent
        declarations={[d('a', 'Wording.')]}
        ticked={new Set()}
        onToggle={onToggle}
      />,
    );
    await userEvent.click(screen.getByRole('checkbox'));
    expect(onToggle).toHaveBeenCalledWith('a', true);
  });

  test('an already-ticked declaration reports the untick', async () => {
    const onToggle = vi.fn();
    render(
      <DeclarationConsent
        declarations={[d('a', 'Wording.')]}
        ticked={new Set(['a'])}
        onToggle={onToggle}
      />,
    );
    await userEvent.click(screen.getByRole('checkbox'));
    expect(onToggle).toHaveBeenCalledWith('a', false);
  });

  /** ⚠️ The wording is the LABEL, not a paragraph near it. Clicking the text
   *  has to tick the box — that is the whole point of the plate, and on a phone
   *  a 16px target beside five lines of legal text is the alternative. */
  test('the wording is the tick-box label', async () => {
    const onToggle = vi.fn();
    render(
      <DeclarationConsent
        declarations={[d('a', 'Clickable wording.')]}
        ticked={new Set()}
        onToggle={onToggle}
      />,
    );
    await userEvent.click(screen.getByText('Clickable wording.'));
    expect(onToggle).toHaveBeenCalledWith('a', true);
  });

  test('Tamil wording is drawn beside the English, marked as Tamil', () => {
    render(
      <DeclarationConsent
        declarations={[d('a', 'English.', { bodyTa: 'தமிழ்.' })]}
        ticked={new Set()}
        onToggle={() => {}}
      />,
    );
    const tamil = screen.getByText('தமிழ்.');
    expect(tamil.closest('[lang="ta"]')).not.toBeNull();
  });

  /** A form with nothing to agree to renders nothing and gates nothing — the
   *  FSSAI and staff case until the team authors wording. */
  test('renders nothing when there are no declarations', () => {
    const { container } = render(
      <DeclarationConsent declarations={[]} ticked={new Set()} onToggle={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(allTicked([], new Set())).toBe(true);
  });

  test('allTicked is false until every one is ticked', () => {
    const all = [d('a', 'A.'), d('b', 'B.')];
    expect(allTicked(all, new Set())).toBe(false);
    expect(allTicked(all, new Set(['a']))).toBe(false);
    expect(allTicked(all, new Set(['a', 'b']))).toBe(true);
  });
});
