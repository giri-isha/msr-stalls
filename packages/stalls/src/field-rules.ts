import type { FieldType } from './forms';

/**
 * What a question ACCEPTS, as rows rather than as a constant.
 *
 * ── What changed ────────────────────────────────────────────────────────────
 * 🔴 A form field carried `min` and `max`, they applied to a `number` and
 * nothing else, and every other limit was either hard-coded in the contract or
 * not checked at all. An admin could append a "GST Number" question and had no
 * way to say it is fifteen characters; a plug count could be given as `abc` and
 * the refusal came from Zod naming `numStallsRequested` in a body the requester
 * never saw. The volunteering module solved the same problem with a rule
 * registry — `packages/volunteering/src/fieldRules.ts` — where a field declares
 * its kind and its limits once and ONE function checks it on the client and on
 * the server.
 *
 * This is that registry, adapted to a module whose forms are already data: the
 * rule does not live in code keyed by field name, it lives on the field ROW, so
 * a coordinator retunes it on the Form Builder rather than in a pull request.
 *
 * ── The one thing that is not free ──────────────────────────────────────────
 * ⚠️ `checkFieldValue` is the only place a limit is applied, and both sides
 * call it. A page that checked and an API that did not is a form somebody can
 * submit by hand with a 4000-character "Pincode"; an API that checked and a
 * page that did not is a refusal arriving after two pages of typing.
 *
 * 🔴 There is no `edition` date window, and its absence is not an oversight.
 * The volunteering registry resolves one against the active edition's start and
 * end dates; `StallEdition` has a year and a name and no dates at all, so the
 * mode would resolve to "unbounded" every time and read on screen as a limit
 * that is quietly doing nothing. Fixed dates and a window that rolls with today
 * are what this module can honestly offer.
 */

/**
 * What kind of value a question holds. Decides both the message vocabulary and
 * which limits mean anything.
 *
 * ⚠️ Derived from the field's TYPE rather than stored beside it. Two spellings
 * of "this is a number" is how a field ends up typed `number` and checked as
 * text — which is exactly the drift the one-registry rule exists to stop.
 */
export type RuleKind =
  | 'text'
  | 'int'
  | 'decimal'
  | 'email'
  | 'phone'
  | 'date'
  | 'choice'
  | 'boolean'
  | 'upload'
  | 'list'
  /** A field that asks nothing — a display block. No rule can apply to it. */
  | 'none';

/**
 * How a date question's accepted window is decided.
 *
 * ⚠️ A discriminated union, stored as JSON on the row rather than as six
 * columns, because the two modes carry different things and a `min_days` column
 * sitting beside a `min_date` column invites a row that has filled in both.
 */
export type DateWindow =
  /** Pinned to explicit ISO days. Either end may be absent. */
  | { mode: 'fixed'; min?: string; max?: string }
  /** Relative to today, in days. Negative reaches into the past. */
  | { mode: 'rolling'; minDays?: number; maxDays?: number };

/**
 * The limits one question carries.
 *
 * ⚠️ `min` and `max` are read THREE ways, decided by the field's type: the
 * value for a number, the digit count for a telephone number, and how many for
 * a file or appliance list. They are one pair of columns because they were one
 * pair of columns before this existed, and splitting them would have meant a
 * data migration to say something the type already says. `ruleKindOf` is what
 * every reader goes through.
 */
export interface FieldRuleValues {
  min: number | null;
  max: number | null;
  /** text — the shortest and longest the answer may be. */
  minLen: number | null;
  maxLen: number | null;
  /** number — digits allowed after the point. Null or 0 is a whole number. */
  decimals: number | null;
  /** text — a regular expression the answer must match, as a STRING so the rule
   *  survives JSON on its way to the browser. */
  pattern: string | null;
  /** What the pattern is asking for, in words: "fifteen characters, like
   *  22AAAAA0000A1Z5". The message quotes this, never the expression. */
  patternHint: string | null;
  /** date — the days the question accepts. */
  window: DateWindow | null;
}

/** A question, as far as its limits are concerned. */
export interface RuledField extends FieldRuleValues {
  label: string;
  type: FieldType;
  required: boolean;
}

export function ruleKindOf(type: FieldType, decimals?: number | null): RuleKind {
  switch (type) {
    case 'text':
    case 'textarea':
      return 'text';
    case 'email':
      return 'email';
    case 'tel':
      return 'phone';
    case 'number':
      return decimals && decimals > 0 ? 'decimal' : 'int';
    case 'date':
      return 'date';
    case 'select':
    case 'radio':
    case 'zone':
      return 'choice';
    case 'checkbox':
      return 'boolean';
    case 'file':
      return 'upload';
    case 'files':
    case 'appliances':
      return 'list';
    case 'display':
      return 'none';
  }
}

/* ── Which limits a question may carry ──────────────────────────────────────*/

/**
 * The knobs the Form Builder draws for a type.
 *
 * 🔴 Read by the screen (which draws only these) and by `checkRuleShape` (which
 * refuses the rest). A length limit saved against a checkbox is not a harmless
 * unused column: it shows on the builder next time as a rule the form is
 * enforcing, and it enforces nothing.
 */
export type RuleKnob = 'bounds' | 'length' | 'decimals' | 'pattern' | 'window' | 'count' | 'digits';

export function ruleKnobsFor(type: FieldType): readonly RuleKnob[] {
  switch (ruleKindOf(type)) {
    case 'text':
      return ['length', 'pattern'];
    case 'email':
      return ['length'];
    case 'phone':
      return ['digits'];
    case 'int':
    case 'decimal':
      return ['bounds', 'decimals'];
    case 'date':
      return ['window'];
    case 'list':
      return ['count'];
    default:
      return [];
  }
}

export function supportsRule(type: FieldType, knob: RuleKnob): boolean {
  return ruleKnobsFor(type).includes(knob);
}

/** A question with every limit cleared. What an appended field starts as, and
 *  what a retyped field is reset to — see `clearedRulesFor`. */
export const NO_RULES: FieldRuleValues = {
  min: null,
  max: null,
  minLen: null,
  maxLen: null,
  decimals: null,
  pattern: null,
  patternHint: null,
  window: null,
};

/**
 * The limits that survive a change of type.
 *
 * 🔴 Applied on every write that changes `fieldType`. A "Number of helpers"
 * question capped at 50 and then retyped to `text` would keep a `max` of 50
 * that now means nothing — or worse, means something else: `max` is a digit
 * count on a `tel` and a file count on a `files`, so the same 50 would silently
 * become "at most fifty files". A limit whose meaning changed under it is not a
 * limit anybody set, so it is dropped and the builder is where it is set again.
 */
export function clearedRulesFor(
  was: FieldType,
  now: FieldType,
  rules: FieldRuleValues,
): FieldRuleValues {
  const before = ruleKnobsFor(was);
  const after = ruleKnobsFor(now);
  /** A limit survives only where the SAME knob applies on both sides. */
  const kept = (knob: RuleKnob) => before.includes(knob) && after.includes(knob);
  // ⚠️ `min`/`max` are checked knob by knob rather than as one pair, because
  // the three knobs that use them mean different things: a `max` of 50 on a
  // number is fifty helpers and on a `files` it is fifty photographs.
  const bounded = kept('bounds') || kept('digits') || kept('count');
  return {
    min: bounded ? rules.min : null,
    max: bounded ? rules.max : null,
    minLen: kept('length') ? rules.minLen : null,
    maxLen: kept('length') ? rules.maxLen : null,
    decimals: kept('decimals') ? rules.decimals : null,
    pattern: kept('pattern') ? rules.pattern : null,
    patternHint: kept('pattern') ? rules.patternHint : null,
    window: kept('window') ? rules.window : null,
  };
}

/* ── Date helpers ───────────────────────────────────────────────────────────*/
// ISO strings throughout. Dates here are calendar days, never instants, so
// arithmetic goes through UTC midnight and comparison is plain string order.

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The date part of an ISO value, or null when it is not one. */
export function isoDay(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const day = raw.slice(0, 10);
  if (!ISO_DAY.test(day)) return null;
  // Round-tripping rejects 2026-02-31, which the regex alone accepts and which
  // Date happily rolls forward to March 3rd.
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10) === day ? day : null;
}

export function shiftDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Today, as a calendar day. Injected everywhere below rather than read, so a
 *  rolling window is testable and the server and the page can be told to agree
 *  on the day when they straddle midnight. */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * A window's concrete bounds. Either end may be absent, which means unbounded
 * at that end — a `rolling` window with neither day set accepts any date, and
 * says so on the builder rather than pretending to a limit.
 */
export function resolveWindow(w: DateWindow, today: string): { min?: string; max?: string } {
  if (w.mode === 'fixed') return { min: w.min, max: w.max };
  return {
    min: w.minDays === undefined ? undefined : shiftDays(today, w.minDays),
    max: w.maxDays === undefined ? undefined : shiftDays(today, w.maxDays),
  };
}

/* ── The checker ────────────────────────────────────────────────────────────*/

/**
 * Presence, before any kind-specific reading.
 *
 * 🔴 `false` is blank ONLY on a checkbox. An unticked box is an unanswered
 * question — that is the whole of the consent gate on all four forms — but a
 * `select` can perfectly well be answered "No", and `wantsThembu` on the ashram
 * form is exactly that: a YES/NO picker whose No arrives as `false`. Treating
 * every `false` as blank made answering No indistinguishable from not
 * answering, so an ashram department that did not want a thembu could not
 * submit at all.
 *
 * `0` is never blank. "How many stalls" answered zero is a wrong answer for the
 * bounds below to catch, not a missing one — and the local welfare form's plug
 * and pass counts are required fields whose honest answer is usually 0.
 */
export function isBlankAnswer(v: unknown, type: FieldType): boolean {
  if (v === undefined || v === null) return true;
  // A `file` answer is a key; the empty string is "nothing uploaded", not a
  // file named "". `files` falls through to the array case below.
  if (typeof v === 'boolean') return type === 'checkbox' ? v === false : false;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const PHONE_CHARS = /^[+\d\s()-]+$/;

/**
 * A JSON scalar. Every kind that reads a value below holds one of these.
 *
 * This exists because the branches read `String(raw)`, and `String()` is happy
 * to stringify anything: `{}` becomes `"[object Object]"` — fifteen characters,
 * so it clears a `minLen` of 10 — and `[1,2]` becomes `"1,2"`. A body sending
 * an object where a string belongs would otherwise be accepted and written.
 */
const isScalar = (raw: unknown): raw is string | number | boolean =>
  typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean';

/**
 * What is wrong with one answer, or null when nothing is.
 *
 * ⚠️ Takes plain values, so it runs identically in the browser before a
 * round-trip and on the server as the thing that actually enforces.
 *
 * ⚠️ Presence is NOT checked here. `validateAgainstForm` owns that, because
 * whether a question was asked at all depends on answers to questions above it
 * — see `fieldIsAsked` — and a limit must not report on a question nobody was
 * shown. A blank answer passes every limit; a blank REQUIRED answer is caught
 * one level up.
 */
export function checkFieldValue(
  field: RuledField,
  raw: unknown,
  today: string = todayISO(),
): string | null {
  const L = field.label;
  const kind = ruleKindOf(field.type, field.decimals);
  if (kind === 'none' || kind === 'boolean' || kind === 'choice' || kind === 'upload') return null;
  if (isBlankAnswer(raw, field.type)) return null;

  // ⚠️ `list` is handled BEFORE the scalar guard below, and that order is the
  // whole point of the kind: a `files` answer is an array of upload keys, and
  // "must be a single value" is the wrong thing to say about one.
  if (kind === 'list') {
    if (!Array.isArray(raw)) return `${L} must be a list.`;
    if (field.min !== null && raw.length < field.min) {
      return `${L} needs at least ${field.min}.`;
    }
    if (field.max !== null && raw.length > field.max) {
      return `${L} takes at most ${field.max}.`;
    }
    return null;
  }

  // Before any limit is applied: a list or an object is not a value that failed
  // a rule, it is the wrong shape, and saying so beats reporting a length.
  if (!isScalar(raw)) return `${L} must be a single value.`;
  const s = String(raw).trim();

  switch (kind) {
    case 'text': {
      if (field.minLen !== null && s.length < field.minLen) {
        return `${L} must be at least ${field.minLen} characters.`;
      }
      if (field.maxLen !== null && s.length > field.maxLen) {
        // The count is the useful half of this message: somebody pasting a
        // paragraph into a remark wants to know by how much they are over.
        return `${L} must be ${field.maxLen} characters or fewer (currently ${s.length}).`;
      }
      if (field.pattern !== null && !safeMatch(field.pattern, s)) {
        return field.patternHint
          ? `${L} must be ${field.patternHint}.`
          : `${L} is not in the expected format.`;
      }
      return null;
    }

    case 'int':
    case 'decimal': {
      // Numbers arrive as strings from every form and as numbers from the API,
      // so both are read here.
      const n = Number(s);
      if (s === '' || !Number.isFinite(n)) {
        return kind === 'int' ? `${L} must be a whole number.` : `${L} must be a number.`;
      }
      if (kind === 'int' && !Number.isInteger(n)) return `${L} must be a whole number.`;
      if (kind === 'decimal' && field.decimals !== null) {
        const dot = s.indexOf('.');
        if (dot >= 0 && s.length - dot - 1 > field.decimals) {
          return `${L} must have at most ${field.decimals} decimal places.`;
        }
      }
      if (field.min !== null && n < field.min) return `${L} must be at least ${field.min}.`;
      if (field.max !== null && n > field.max) return `${L} must be at most ${field.max}.`;
      return null;
    }

    case 'email': {
      if (field.maxLen !== null && s.length > field.maxLen) {
        return `${L} must be ${field.maxLen} characters or fewer.`;
      }
      if (!EMAIL.test(s)) return `${L} doesn’t look like an email address.`;
      return null;
    }

    case 'phone': {
      if (!PHONE_CHARS.test(s)) {
        return `${L} may only contain digits, spaces, brackets, + and -.`;
      }
      // A digit COUNT, not a numbering plan. A vendor from outside India gives
      // a longer number and a landline a shorter one, and neither is a mistake.
      const digits = s.replace(/\D/g, '').length;
      const lo = field.min ?? 8;
      const hi = field.max ?? 15;
      if (digits < lo || digits > hi) return `${L} must be ${lo} to ${hi} digits.`;
      return null;
    }

    case 'date': {
      const day = isoDay(raw);
      if (!day) return `${L} must be a date.`;
      const w = field.window === null ? undefined : resolveWindow(field.window, today);
      if (w?.min && day < w.min) {
        return w.max
          ? `${L} must fall between ${w.min} and ${w.max}.`
          : `${L} cannot be before ${w.min}.`;
      }
      if (w?.max && day > w.max) {
        return w.min
          ? `${L} must fall between ${w.min} and ${w.max}.`
          : `${L} cannot be after ${w.max}.`;
      }
      return null;
    }

    default:
      return null;
  }
}

/**
 * Whether a stored pattern matches, without letting a bad one throw.
 *
 * ⚠️ An admin types the expression. `new RegExp` on an unbalanced bracket
 * throws, and a throw inside the validator is a 500 on a form submission rather
 * than a message about a field. `checkRuleShape` refuses one on the way in;
 * this is what keeps a row that got past an older build from taking the form
 * down with it — an unreadable pattern asks nothing.
 */
function safeMatch(pattern: string, s: string): boolean {
  try {
    return new RegExp(pattern).test(s);
  } catch {
    return true;
  }
}

/* ── The limits themselves ──────────────────────────────────────────────────*/

/**
 * What is wrong with the RULE, as opposed to with an answer to it.
 *
 * 🔴 Checked where the builder saves, not where a requester submits. A maximum
 * below the minimum is a question nobody can answer, and the place to find that
 * out is the screen that set it — not a vendor's third attempt at a form that
 * refuses every value.
 */
export function checkRuleShape(type: FieldType, rules: FieldRuleValues): string | null {
  const knobs = ruleKnobsFor(type);
  const has = (k: RuleKnob) => knobs.includes(k);

  if (rules.min !== null && rules.max !== null && rules.max < rules.min) {
    return has('digits')
      ? 'The most digits cannot be fewer than the fewest.'
      : has('count')
        ? 'The most cannot be fewer than the fewest.'
        : 'The maximum cannot be below the minimum.';
  }
  if (rules.minLen !== null && rules.maxLen !== null && rules.maxLen < rules.minLen) {
    return 'The longest cannot be shorter than the shortest.';
  }
  if (rules.minLen !== null && rules.minLen < 0) return 'A length cannot be negative.';
  if (rules.maxLen !== null && rules.maxLen < 1)
    return 'The longest answer must allow at least one character.';
  if ((has('digits') || has('count')) && rules.min !== null && rules.min < 0) {
    return 'A count cannot be negative.';
  }
  if (rules.decimals !== null && (rules.decimals < 0 || rules.decimals > 6)) {
    return 'Decimal places must be between 0 and 6.';
  }
  if (rules.pattern !== null) {
    if (rules.pattern.length > 400) return 'That pattern is too long.';
    try {
      new RegExp(rules.pattern);
    } catch {
      return 'That pattern is not a valid expression.';
    }
    // A pattern with nothing said about it produces "is not in the expected
    // format", which tells a requester to guess. The hint is what the message
    // quotes, so it is part of the rule rather than decoration.
    if (!rules.patternHint || rules.patternHint.trim() === '') {
      return 'Say what the pattern is asking for, so the message can quote it.';
    }
  }
  const w = rules.window;
  if (w) {
    if (w.mode === 'fixed') {
      if (w.min !== undefined && isoDay(w.min) === null) return 'The earliest date is not a date.';
      if (w.max !== undefined && isoDay(w.max) === null) return 'The latest date is not a date.';
      if (w.min !== undefined && w.max !== undefined && w.max < w.min) {
        return 'The latest date cannot fall before the earliest.';
      }
    } else if (w.minDays !== undefined && w.maxDays !== undefined && w.maxDays < w.minDays) {
      return 'The end of the window cannot fall before its start.';
    }
  }
  return null;
}

/* ── Saying what a rule admits ──────────────────────────────────────────────*/

/**
 * What a question accepts, in a phrase.
 *
 * Shown under the control while it is clean, so the limit is known before it is
 * hit rather than after — and on the builder row, so a coordinator scanning a
 * form can see which questions carry one without opening each.
 */
export function ruleHintFor(field: RuledField, today: string = todayISO()): string | null {
  switch (ruleKindOf(field.type, field.decimals)) {
    case 'int':
    case 'decimal':
      if (field.min !== null && field.max !== null) return `${field.min}–${field.max}`;
      if (field.max !== null) return `At most ${field.max}`;
      if (field.min !== null) return `At least ${field.min}`;
      return null;
    case 'text': {
      const parts: string[] = [];
      if (field.minLen !== null && field.maxLen !== null) {
        parts.push(`${field.minLen}–${field.maxLen} characters`);
      } else if (field.maxLen !== null) parts.push(`Up to ${field.maxLen} characters`);
      else if (field.minLen !== null) parts.push(`At least ${field.minLen} characters`);
      if (field.patternHint) parts.push(field.patternHint);
      return parts.length ? parts.join(' · ') : null;
    }
    case 'email':
      return field.maxLen === null ? null : `Up to ${field.maxLen} characters`;
    case 'phone': {
      if (field.min === null && field.max === null) return null;
      return `${field.min ?? 8}–${field.max ?? 15} digits`;
    }
    case 'date': {
      if (!field.window) return null;
      const w = resolveWindow(field.window, today);
      if (!w.min && !w.max) return null;
      if (w.min && w.max) return `${w.min} to ${w.max}`;
      return w.min ? `From ${w.min}` : `Up to ${w.max}`;
    }
    case 'list':
      if (field.min !== null && field.max !== null) return `${field.min}–${field.max}`;
      if (field.max !== null) return `Up to ${field.max}`;
      if (field.min !== null) return `At least ${field.min}`;
      return null;
    default:
      return null;
  }
}

/* ── Which types a question may be given ────────────────────────────────────*/

/**
 * What an answer to this type IS, once it is stored.
 *
 * 🔴 This is what makes a built-in's Answer Type editable at all. A built-in's
 * answer lands in a typed column on `stall_request` — `stall_name` is text,
 * `num_stalls_requested` is an integer — so the old rule was "a built-in cannot
 * be retyped", full stop, and a coordinator who wanted "Items Selling" to be a
 * paragraph box rather than a one-line one had to ask an engineer.
 *
 * The column does not care whether the control is an input, a paragraph box or
 * a dropdown. It cares what arrives. So the rule is the SHAPE, not the type:
 * any type whose answer is a string may replace any other on a field whose
 * column holds a string, and a number stays a number.
 *
 * ⚠️ `zone`, `appliances` and `file` are each their own shape although two of
 * them do produce strings. A `zone` resolves its choices from the edition's
 * bays at render time and an `appliances` is a repeating editor wired to its
 * own table; a `file` answer is a media-store key minted for one upload
 * purpose, and letting the cheque question become a text box would take a typed
 * value into a column `isOurKey` then refuses — a bank form nobody can submit.
 */
export type ValueShape =
  | 'text'
  | 'number'
  | 'boolean'
  | 'zone'
  | 'file'
  | 'files'
  | 'rows'
  | 'none';

export function valueShapeOf(type: FieldType): ValueShape {
  switch (type) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'tel':
    case 'select':
    case 'radio':
    case 'date':
      return 'text';
    case 'number':
      return 'number';
    case 'checkbox':
      return 'boolean';
    case 'zone':
      return 'zone';
    case 'file':
      return 'file';
    case 'files':
      return 'files';
    case 'appliances':
      return 'rows';
    case 'display':
      return 'none';
  }
}

/** Whether these two types may stand in for one another on a field whose
 *  answer already has somewhere to go. */
export function sameValueShape(a: FieldType, b: FieldType): boolean {
  return valueShapeOf(a) === valueShapeOf(b);
}
