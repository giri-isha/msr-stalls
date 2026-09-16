# The Form Builder drives every public form

## The problem

Four of the seven public forms are rows. Three are JSX.

`BankForm.tsx` holds a 29-entry `FIELDS` constant. `FssaiForm.tsx` and
`StaffRegistration.tsx` hold their questions inline. Rewording a label, adding
the Tamil beside it, marking a field optional, or ceasing to ask a question at
all is a code change and a redeploy — the exact problem the Form Builder was
built to end, still live on the form that collects an account number and the one
that collects a government ID.

The four request forms stopped having that problem when forms became rows. These
three did not, because three things about them are genuinely different.

## What makes them different

**They have files, and `FieldType` has none.** The bank form takes a cancelled
cheque, a PAN card and a GST certificate. The FSSAI form is *nothing but* an
upload, up to five pages. Staff registration wants a profile photo and both
sides of an Aadhaar. No request form takes a file, so the type never existed.

⚠️ Uploads here are not generic. `presignUpload` writes into a folder chosen by
`purpose`, and `isOurKey` refuses any key that is not a UUID under that exact
folder. That check is what stops a vendor posting back a key they did not mint —
including another vendor's cancelled cheque — and having it filed as their own.
A builder-authored file field has no purpose to belong to, and inventing one
shared bucket would retire that guarantee for every upload at once.

**Their built-ins land on three different tables.** On a request form a
built-in's `name` is a column on `stall_request`, and `LOCKED_ON_BUILT_IN`
exists because renaming or retyping one posts an answer the submit path cannot
file. Here the target is `StallBankDetail`, `StallFssaiCertificate` or
`StallVendorStaff` — so "which column does this name mean" is a question with
three different answers depending on the form.

**Staff registration is per person, and custom values are per request.**
`StallCustomFieldValue` is unique on `(request_id, custom_field_id)`. Eight
people register against one coupon and share a request, so an appended question
on that form would have seven of its eight answers collapse into the first
person's row. This is the same shape as the consent bug the previous spec fixed,
and it wants the same answer.

## Scope

In: `file` and `files` field types; a per-field upload purpose for
builder-authored files; seeded definitions for the bank, FSSAI and staff forms;
built-in-to-column maps for the three tables; per-person custom values; the
three public pages rendering from rows; the Form Builder offering all seven
forms.

Out: the vendor payment-details form and the `PAYMENT_DETAILS` letter — separate
specs, already scoped.

## A file is a field

`FieldType` gains two members:

```ts
  /** One file. The answer is a media-store key. */
  | 'file'
  /** Several, up to `max`. The FSSAI certificate is photographed a page at a
   *  time, which is the case this exists for. */
  | 'files'
```

Both join `AUTHORABLE_FIELD_TYPES`, so an admin can add one. `max` already
exists on `BuiltFormField` and becomes the page count for `files`; it is ignored
for `file`.

⚠️ `needsOptions` stays false for both. A file field with a choice list is a
question nobody can answer.

### The purpose problem, solved by the field's own id

`PresignUploadInput.purpose` gains `FORM_FIELD`, whose folder is `form-field`.
Its keys carry the field they belong to:

```
stalls/form-field/<fieldId>/<uuid>.<ext>
```

and `isOurKey` takes the field id alongside the purpose:

```ts
isOurKey(key, 'FORM_FIELD', fieldId)
```

🔴 The field id is IN THE PATH, not merely checked against a column. A key is
only ever valid for the one question it was minted for, so a vendor cannot
present their PAN upload as their GST certificate, and the check survives a
field being reordered or renamed. The existing five purposes are untouched and
keep their folders, so every key already in the database stays valid.

⚠️ The built-in file fields keep their own purposes. `chequeKey` is still
`BANK_CHEQUE` and the FSSAI files are still `FSSAI` — those folders hold live
data and the columns that point at them are typed. `FORM_FIELD` is for fields an
admin *appended*, which by definition have no column.

## One built-in map per form

A new `packages/stalls/src/public-forms.ts` carries what `forms.ts` carries for
the request forms: the three form definitions as constants, transcribed from the
current JSX, and for each a statement of which table its built-ins write to.

```ts
export interface PublicFormDefinition {
  formType: 'BANK' | 'FSSAI' | 'STAFF';
  title: string;
  titleTa: string | null;
  /** Which record a built-in field's answer lands on. The submit path owns the
   *  writing; this is what tells the BUILDER a name is spoken for. */
  target: 'BANK_DETAIL' | 'FSSAI_CERTIFICATE' | 'VENDOR_STAFF';
  fields: FormField[];
}
```

`seedFormDefinitions` grows from four forms to seven, reading these the same way
it reads `FORM_DEFINITIONS` — by reference, never retyped, so the Tamil
transcribed from the 2025 sheets crosses into the database exactly once.

⚠️ `canEditFieldType` and `canDeleteField` already refuse built-ins and need no
change. What changes is that there are now built-ins whose type is `file`, and
`LOCKED_ON_BUILT_IN` covers them for the same reason it covers the rest: the
column behind `chequeKey` is a string that the cheque viewer dereferences.

## A custom answer can belong to a person

`StallCustomFieldValue` gains a nullable `staffId` referencing
`StallVendorStaff`, and its single unique index becomes a pair:

```sql
CREATE UNIQUE INDEX "stall_custom_field_value_by_request"
  ON "stalls"."stall_custom_field_value" ("request_id", "custom_field_id")
  WHERE "staff_id" IS NULL;

CREATE UNIQUE INDEX "stall_custom_field_value_by_staff"
  ON "stalls"."stall_custom_field_value" ("staff_id", "custom_field_id")
  WHERE "staff_id" IS NOT NULL;
```

⚠️ A pair, not one index, for the reason Postgres always forces here: NULLs
compare as DISTINCT, so a single index over four columns would admit unlimited
duplicates for the request-level answers. This is the third table in this module
to need the pattern; it is not a special case.

## The pages render from rows

`RequestForm.tsx` already contains the field renderer — a `switch` over
`f.type` producing the right control, with `Labelled`, `ChoicePlate`,
`ApplianceRows` and `ZoneSelect`. It moves to
`apps/web/src/modules/stalls/components/FormFields.tsx` and all four public
pages use it.

🔴 Extracted rather than copied. Four renderers is four places for "what does a
required checkbox look like" to drift, and the consent work just finished
removing one such divergence.

The three pages keep their own submit logic, their own link-gating and their own
non-field furniture — the FSSAI page's re-upload warning, the bank page's
requirements recap, the staff page's coupon header. What they hand over is the
drawing of questions.

`file` renders as the existing upload control; `files` as the multi-file one the
FSSAI page already has. Both presign on selection and post keys, exactly as
today.

## Validation

`validateAgainstForm` already walks `formFields(form)` and checks required-ness
from the rows. It gains file handling in `isBlank`: an empty string is blank for
`file`, an empty array is blank for `files` — the array case is already covered.

🔴 The API validates against the definition for these three forms too, not only
the request forms. A rule the page applies and the API does not is a form
somebody submits by hand with half of it blank, and these three carry an account
number, a food-safety certificate and a government ID.

## Testing

- A `FORM_FIELD` key minted for one field is refused for another. This is the
  whole security argument for putting the id in the path, so it is the test that
  matters most.
- The five existing upload purposes still validate keys already in the database.
- Two staff members answering the same appended question each get their own
  value row — the case the old unique index would have swallowed.
- A `files` field refuses more than `max` entries.
- Switching off a built-in on the bank form stops the page asking it and stops
  the API requiring it.
- `seedFormDefinitions` is idempotent across all seven forms.

## What this does not change

The three submit contracts keep their typed fields. A vendor's `ifsc` is still
`Ifsc` in `SubmitBankDetailsInput`, still a column, still validated by shape.
The definition decides *whether and how* a question is asked; the contract
decides what an answer is. That division is what `forms.ts` already describes
for the request forms and it holds here unchanged.
