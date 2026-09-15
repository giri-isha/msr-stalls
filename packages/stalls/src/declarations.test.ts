import { describe, expect, test } from 'vitest';
import {
  type Declaration,
  declarationPreview,
  declarationsFor,
  isDeclarationKey,
  needsNewVersion,
  parseDeclaration,
} from './declarations';

const d = (over: Partial<Declaration> = {}): Declaration => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  key: 'request_submission',
  requestType: null,
  version: 1,
  title: 'Submission',
  body: 'Allocation is at the sole discretion of the stall team.',
  bodyTa: null,
  isActive: true,
  isCurrent: true,
  ...over,
});

describe('which declarations a form shows', () => {
  test('the default, when the form has no variant of its own', () => {
    expect(declarationsFor([d()], 'VENDOR').map((x) => x.requestType)).toEqual([null]);
  });

  test('the variant, when it has one', () => {
    const shown = declarationsFor(
      [d(), d({ requestType: 'VENDOR', body: 'Vendor wording.' })],
      'VENDOR',
    );
    expect(shown).toHaveLength(1);
    expect(shown[0]?.body).toBe('Vendor wording.');
  });

  /** 🔴 The same consent twice in different words. A requester who ticks both
   *  has agreed to two things that may contradict, and no reading of the log
   *  afterwards can say which one they meant. */
  test('never the variant AND the default for one key', () => {
    const all = [d(), d({ requestType: 'VENDOR' })];
    expect(declarationsFor(all, 'VENDOR')).toHaveLength(1);
  });

  test('another form still gets the default', () => {
    const all = [d(), d({ requestType: 'VENDOR', body: 'Vendor wording.' })];
    expect(declarationsFor(all, 'ASHRAM')[0]?.requestType).toBeNull();
  });

  test('two keys come back in a stable order, whatever the rows arrive in', () => {
    const all = [d({ key: 'deposit_terms' }), d({ key: 'request_submission' })];
    expect(declarationsFor(all, 'VENDOR').map((x) => x.key)).toEqual([
      'deposit_terms',
      'request_submission',
    ]);
    expect(declarationsFor([...all].reverse(), 'VENDOR').map((x) => x.key)).toEqual([
      'deposit_terms',
      'request_submission',
    ]);
  });

  /** Only what is current AND active can be ticked today; the rest exists so
   *  that what was ticked yesterday can still be read. */
  test('an old version is never shown', () => {
    expect(declarationsFor([d({ isCurrent: false })], 'VENDOR')).toEqual([]);
  });

  test('a retired one is never shown', () => {
    expect(declarationsFor([d({ isActive: false })], 'VENDOR')).toEqual([]);
  });

  test('a retired variant does not fall back to the default', () => {
    // ⚠️ Switching a vendor-specific consent OFF means the vendor form asks
    // nothing for that key — not that it quietly asks the generic one instead,
    // which would be a wording nobody chose for that form.
    const all = [d(), d({ requestType: 'VENDOR', isActive: false })];
    expect(declarationsFor(all, 'VENDOR').map((x) => x.requestType)).toEqual([null]);
  });
});

describe('what needs a new version', () => {
  test('a changed body does', () => {
    expect(needsNewVersion({ body: 'a', bodyTa: null }, { body: 'b', bodyTa: null })).toBe(true);
  });

  test('changed Tamil does — it is wording somebody reads and ticks', () => {
    expect(needsNewVersion({ body: 'a', bodyTa: 'x' }, { body: 'a', bodyTa: 'y' })).toBe(true);
  });

  test('adding Tamil where there was none does', () => {
    expect(needsNewVersion({ body: 'a', bodyTa: null }, { body: 'a', bodyTa: 'y' })).toBe(true);
  });

  /** A trailing newline from a textarea is not a new version of a consent, and
   *  treating it as one fills the history with versions nobody authored. */
  test('whitespace at either end does not', () => {
    expect(needsNewVersion({ body: 'a', bodyTa: null }, { body: ' a\n', bodyTa: null })).toBe(
      false,
    );
    expect(needsNewVersion({ body: 'a', bodyTa: 'x ' }, { body: 'a', bodyTa: ' x' })).toBe(false);
  });

  test('null and empty Tamil are the same absence', () => {
    expect(needsNewVersion({ body: 'a', bodyTa: null }, { body: 'a', bodyTa: '' })).toBe(false);
  });
});

describe('the limited rich text', () => {
  test('bold and links become nodes', () => {
    expect(parseDeclaration('I agree to the **rules** and [terms](https://x.org/t).')).toEqual([
      [
        { kind: 'text', text: 'I agree to the ' },
        { kind: 'bold', text: 'rules' },
        { kind: 'text', text: ' and ' },
        { kind: 'link', text: 'terms', href: 'https://x.org/t' },
        { kind: 'text', text: '.' },
      ],
    ]);
  });

  test('a blank line starts a paragraph; a single newline does not', () => {
    expect(parseDeclaration('one\ntwo\n\nthree')).toEqual([
      [{ kind: 'text', text: 'one two' }],
      [{ kind: 'text', text: 'three' }],
    ]);
  });

  /** 🔴 This text is authored by somebody pasting from a Word document and
   *  rendered onto the page that records what they agreed to. */
  test('markup in the body is text, not markup', () => {
    expect(parseDeclaration('<script>alert(1)</script> & co')).toEqual([
      [{ kind: 'text', text: '<script>alert(1)</script> & co' }],
    ]);
  });

  /** ⚠️ `https` is in the pattern, so anything else never becomes a link — and
   *  stays VISIBLE as its own text rather than vanishing. A broken link
   *  somebody can see gets fixed; one that silently disappears does not. */
  test('a javascript: href is not a link, and does not disappear', () => {
    const nodes = parseDeclaration('[click](javascript:alert(1))').flat();
    expect(nodes.every((n) => n.kind === 'text')).toBe(true);
    expect(nodes.map((n) => n.text).join('')).toContain('javascript:alert(1)');
  });

  test('http, without the s, is not a link either', () => {
    expect(
      parseDeclaration('[x](http://x.org)')
        .flat()
        .every((n) => n.kind === 'text'),
    ).toBe(true);
  });

  /** ⚠️ One scan for both markers. Run as two passes, the bold pass reaches
   *  inside a link's label and splits the link in half. */
  test('bold inside a link label does not break the link', () => {
    const nodes = parseDeclaration('[the **rules**](https://x.org/r)').flat();
    expect(nodes).toEqual([{ kind: 'link', text: 'the **rules**', href: 'https://x.org/r' }]);
  });

  test('an unclosed marker is left alone', () => {
    expect(parseDeclaration('**not bold')).toEqual([[{ kind: 'text', text: '**not bold' }]]);
  });

  test('the preview flattens the markers and trims to length', () => {
    expect(declarationPreview('I agree to the **rules** and [terms](https://x.org/t).')).toBe(
      'I agree to the rules and terms.',
    );
    expect(declarationPreview('a'.repeat(200))).toHaveLength(140);
    expect(declarationPreview('a'.repeat(200)).endsWith('…')).toBe(true);
  });
});

describe('the key an admin may type', () => {
  test.each(['request_submission', 'deposit_terms', 'abc', 'a_1'])('%s is fine', (k) => {
    expect(isDeclarationKey(k)).toBe(true);
  });

  test.each(['Request', 'ab', 'with space', '1leading', 'trailing-dash', ''])('%s is not', (k) => {
    expect(isDeclarationKey(k)).toBe(false);
  });
});
