import type { StallRequestType } from './reference';

/**
 * Consent declarations — the wording a requester ticks.
 *
 * ── Why this is data ────────────────────────────────────────────────────────
 * 🔴 The disclaimer used to be a constant in `forms.ts`, and the consent was a
 * single `agreed_at` timestamp on the request. Together those record THAT
 * somebody agreed and never WHAT they agreed to: the day a stall is in dispute,
 * the only answer available is whatever the constant says today, which is not
 * what it said the evening they ticked it. Editing a line of legal text
 * silently rewrote history for every request already submitted.
 *
 * So: versions are immutable, editing writes a new one, and each consent points
 * at the exact version that was on screen.
 *
 * ── The rules that must stay pure ───────────────────────────────────────────
 * Which version a form shows, and what counts as a change worth versioning.
 * Both are decided in more than one place — the public form, the API that
 * validates a submission, the backoffice screen that previews — so they live
 * here and take plain values.
 */

/** One version, as a screen or a validator reads it. */
export interface Declaration {
  id: string;
  key: string;
  /** `null` is the default, shown by any form with no variant of its own. */
  requestType: StallRequestType | null;
  version: number;
  title: string;
  body: string;
  bodyTa: string | null;
  isActive: boolean;
  isCurrent: boolean;
}

/**
 * The declarations a given form shows, in key order.
 *
 * ⚠️ The SPECIFIC variant wins over the default, per key — never both. A
 * vendor form carrying a vendor-specific `request_submission` must not also
 * show the generic one: that is the same consent twice with different words,
 * and a requester who ticks both has agreed to two things that may contradict.
 *
 * ⚠️ Retired versions are dropped, and so are old ones. Only what is `current`
 * AND `active` can be ticked today; everything else exists so that what was
 * ticked yesterday can still be read.
 */
export function declarationsFor(
  all: readonly Declaration[],
  requestType: StallRequestType,
): Declaration[] {
  const live = all.filter((d) => d.isCurrent && d.isActive);
  const keys = [...new Set(live.map((d) => d.key))].sort();
  return keys
    .map(
      (key) =>
        live.find((d) => d.key === key && d.requestType === requestType) ??
        live.find((d) => d.key === key && d.requestType === null),
    )
    .filter((d): d is Declaration => d !== undefined);
}

/**
 * Whether an edit needs a new version, or is a change to the same one.
 *
 * ⚠️ The WORDING is what a consent is. Re-titling a declaration, or switching
 * it off, changes what the backoffice sees and not what anybody agreed to — so
 * those edit the row. Changing a single character of `body` or `bodyTa` means
 * the next requester ticks something different from the last one, and that has
 * to be a different row or the log is a lie.
 *
 * Trimmed before comparing: a trailing newline from a textarea is not a new
 * version of a consent, and treating it as one fills the history with versions
 * nobody authored.
 */
export function needsNewVersion(
  current: Pick<Declaration, 'body' | 'bodyTa'>,
  next: Pick<Declaration, 'body' | 'bodyTa'>,
): boolean {
  return (
    current.body.trim() !== next.body.trim() ||
    (current.bodyTa ?? '').trim() !== (next.bodyTa ?? '').trim()
  );
}

/** A key an admin may type: lower case, digits and underscores. */
export const DECLARATION_KEY = /^[a-z][a-z0-9_]{2,63}$/;

export function isDeclarationKey(key: string): boolean {
  return DECLARATION_KEY.test(key);
}

/* ── The limited rich text ──────────────────────────────────────────────────*/

/**
 * What a declaration body may contain.
 *
 * 🔴 This text is rendered into a public page that is also the legal record of
 * what somebody agreed to, and it is authored by a person pasting from a Word
 * document. Storing HTML and trusting it is how a paste puts a `<script>` on
 * the consent page; storing HTML and stripping it on the way out is how the
 * stored text and the shown text stop being the same string, which is exactly
 * what must never happen to a consent.
 *
 * So the body is PLAIN TEXT with three markers, and the renderer builds
 * elements from them rather than parsing markup:
 *
 *   **bold**              → <strong>
 *   [label](https://…)    → <a>, https only
 *   a blank line          → a paragraph break
 *
 * Anything else is text, including `<` and `&`. There is no escape hatch, and
 * that is the feature.
 */
export type DeclarationNode =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'link'; text: string; href: string };

/** One paragraph's worth of nodes, per paragraph. */
export function parseDeclaration(body: string): DeclarationNode[][] {
  return body
    .split(/\n\s*\n/)
    .map((para) => parseInline(para.replace(/\s*\n\s*/g, ' ').trim()))
    .filter((nodes) => nodes.length > 0);
}

// ⚠️ One expression with both markers, scanned left to right, rather than bold
// first and links second. Run separately, the bold pass would reach inside a
// link's label and split the link in half.
const INLINE = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g;

function parseInline(text: string): DeclarationNode[] {
  const out: DeclarationNode[] = [];
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > at) out.push({ kind: 'text', text: text.slice(at, m.index) });
    if (m[1] !== undefined) out.push({ kind: 'bold', text: m[1] });
    // ⚠️ `https` only, and it is in the pattern rather than checked after: a
    // `javascript:` href on a page that exists to record consent is the worst
    // possible place for one, and an unmatched link stays visible AS ITS OWN
    // TEXT rather than vanishing — a broken link somebody can see gets fixed.
    else if (m[2] !== undefined && m[3] !== undefined) {
      out.push({ kind: 'link', text: m[2], href: m[3] });
    }
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) });
  return out;
}

/** The body as one line of plain text — for a list's preview column, and for
 *  anywhere the markers would be noise rather than formatting. */
export function declarationPreview(body: string, max = 140): string {
  const flat = parseDeclaration(body)
    .flat()
    .map((n) => n.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
