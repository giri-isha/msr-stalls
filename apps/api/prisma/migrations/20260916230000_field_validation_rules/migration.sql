-- What a question ACCEPTS, on the question.
--
-- 🔴 `min` and `max` have been the only limits a form field could carry, and
-- they applied to a `number` and to nothing else. Everything else was either
-- hard-coded in the contract — where an admin cannot reach it — or not checked
-- at all: an appended "GST Number" question took four thousand characters, a
-- plug count took `abc`, and the refusal (when there was one) named a body key
-- the requester had never seen.
--
-- The volunteering module solved the same problem with a rule registry keyed by
-- field name in code. Forms here are already rows, so the rule belongs ON the
-- row: a coordinator retunes a length, a digit count or an accepted date window
-- on the Form Builder rather than in a pull request. `checkFieldValue` in
-- `packages/stalls/src/field-rules.ts` is the one function that applies them,
-- on the page before a round-trip and in `validateAgainstForm` as the thing
-- that actually enforces.
--
-- ⚠️ `min` and `max` are NOT duplicated here, and they now mean one of three
-- things depending on `field_type`: the value for a number, the digit count for
-- a telephone number, how many for a file list. They were one pair of columns
-- before this and splitting them would have been a data migration to say
-- something the type already says. `ruleKindOf` is what every reader goes
-- through.
--
-- ⚠️ `date_window` is JSON rather than six columns because its two modes carry
-- different things — pinned days, or a window that rolls with today — and a
-- `min_days` column beside a `min_date` column invites a row that has filled in
-- both. There is no mode that follows the edition: `stall_edition` has a year
-- and a name and no dates, so such a window would resolve to "any date" every
-- time while reading on screen as a limit.

ALTER TABLE "stalls"."stall_form_field"
  ADD COLUMN "min_len" INTEGER,
  ADD COLUMN "max_len" INTEGER,
  ADD COLUMN "decimals" INTEGER,
  ADD COLUMN "pattern" TEXT,
  ADD COLUMN "pattern_hint" TEXT,
  ADD COLUMN "date_window" JSONB;
