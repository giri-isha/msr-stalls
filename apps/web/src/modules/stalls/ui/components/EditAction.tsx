import { Btn } from '../ui';
import { Icon } from '../icons';
import { IconBtn } from './IconBtn';

/**
 * The control that opens an edit dialog on a record.
 *
 * ── Why every edit on these screens is a dialog ──────────────────────────────
 * A row used to BE a form: fields in the cells, each saving on its own blur or
 * tick. That reads as though a list is a spreadsheet, and it is not — it costs
 * a counter correcting an entry three requests, the middle one a figure nobody
 * meant, and `Equipment`'s CounterDialog has the note about the half-typed
 * "12" that left the counter as a 1. A row is a RECORD: it shows what is true,
 * and changing it is a deliberate act with a Cancel.
 *
 * ⚠️ One helper rather than a pencil spelled out at every call site. The point
 * of moving them all behind a dialog is that a row reads the same way
 * everywhere, so the control that opens the dialog has to be the same control
 * everywhere — or the screens drift apart in the dimension just unified. It
 * was already true of Admin's eight tables; this is the same control, in `ui/`
 * so Finance, Onboarding and whatever comes next reach for it too.
 */
export function EditBtn({
  what,
  writable = true,
  onClick,
}: {
  /** What is being edited, for the accessible name: "Edit A3". Never bare
   *  "Edit" — a table of twenty pencils would announce twenty identical
   *  buttons, and the row is the only thing telling them apart. */
  what: string;
  writable?: boolean;
  onClick: () => void;
}) {
  return <IconBtn label={`Edit ${what}`} glyph='pencil' disabled={!writable} onClick={onClick} />;
}

/**
 * The footer every edit dialog wears: cancel, then the primary save.
 *
 * ⚠️ Cancel carries no glyph and Save does — see the action convention in
 * `ui/icons.tsx`. The asymmetry is what makes the committing button findable
 * without reading either label.
 */
export function DialogButtons({
  onClose,
  onSave,
  disabled,
  save = 'Save',
}: {
  onClose: () => void;
  onSave: () => void;
  disabled?: boolean;
  /** For a dialog that CREATES rather than edits: "Add bay", "Create". */
  save?: string;
}) {
  return (
    <>
      <Btn onClick={onClose}>Cancel</Btn>
      <Btn kind='primary' disabled={disabled} onClick={onSave}>
        <Icon name={save === 'Save' ? 'check' : 'plus'} size={14} />
        {save}
      </Btn>
    </>
  );
}

/**
 * The control that opens a CREATION dialog, on a panel's header.
 *
 * ⚠️ The counterpart to `EditBtn`, and worded rather than a bare `+`. A pencil
 * on a row is unambiguous — the row says what it edits — but a lone plus at
 * the top of a screen with eight tables on it does not say which table it adds
 * to, and on the Admin screen that is a real question.
 */
export function AddBtn({
  what,
  writable = true,
  onClick,
}: {
  /** The thing being made, lower case: "bay", "fine", "custom field". */
  what: string;
  writable?: boolean;
  onClick: () => void;
}) {
  return (
    <Btn kind='primary' disabled={!writable} onClick={onClick}>
      <Icon name='plus' size={14} />
      Add {what}
    </Btn>
  );
}
