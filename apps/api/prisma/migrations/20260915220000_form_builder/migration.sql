-- The whole form becomes data.
--
-- 🔴 The four 2025 forms were a constant in `packages/stalls/src/forms.ts` and
-- the Form Builder could only APPEND to them. Reordering a field, fixing a
-- label, marking something required — each meant a code change and a redeploy.
--
-- ⚠️ `stall_custom_field` is RENAMED, not replaced. Every answer already given
-- hangs off it by foreign key, so a new table would have meant migrating those
-- rows or losing them. An appended custom field becomes a field with
-- `is_built_in` false; there is one kind of field after this.

ALTER TABLE "stalls"."stall_custom_field" RENAME TO "stall_form_field";

-- Prisma derives constraint and index names from the table, so they move with
-- it or the schema drifts on the next `migrate dev`.
ALTER INDEX "stalls"."stall_custom_field_pkey" RENAME TO "stall_form_field_pkey";
ALTER INDEX "stalls"."stall_custom_field_edition_id_form_type_idx"
  RENAME TO "stall_form_field_edition_id_form_type_idx";
ALTER TABLE "stalls"."stall_form_field"
  RENAME CONSTRAINT "stall_custom_field_edition_id_fkey" TO "stall_form_field_edition_id_fkey";
-- ⚠️ The foreign key on `stall_custom_field_value` is NOT renamed. Prisma names
-- a constraint for the table it is ON, not for the one it points at, and that
-- table keeps its name — the answers are still custom field values, whatever
-- the field table is now called.

-- ── The form itself ─────────────────────────────────────────────────────────
CREATE TABLE "stalls"."stall_form_definition" (
  "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
  "edition_id" UUID        NOT NULL,
  "form_type"  "stalls"."StallFormType" NOT NULL,
  "title"      TEXT        NOT NULL,
  "title_ta"   TEXT,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_by" TEXT,

  CONSTRAINT "stall_form_definition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stall_form_definition_edition_id_fkey"
    FOREIGN KEY ("edition_id") REFERENCES "stalls"."stall_edition"("id") ON DELETE CASCADE
);

-- One definition per form per edition. The form IS the (edition, type) pair;
-- two rows for one pair would be two answers to "what does the vendor form
-- ask", and the public route would serve whichever came back first.
CREATE UNIQUE INDEX "stall_form_definition_edition_id_form_type_key"
  ON "stalls"."stall_form_definition" ("edition_id", "form_type");

CREATE TABLE "stalls"."stall_form_section" (
  "id"            UUID    NOT NULL DEFAULT gen_random_uuid(),
  "definition_id" UUID    NOT NULL,
  "heading"       TEXT    NOT NULL,
  "heading_ta"    TEXT,
  "help"          TEXT,
  "sort_order"    INTEGER NOT NULL,

  CONSTRAINT "stall_form_section_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stall_form_section_definition_id_fkey"
    FOREIGN KEY ("definition_id") REFERENCES "stalls"."stall_form_definition"("id") ON DELETE CASCADE
);

CREATE INDEX "stall_form_section_definition_id_sort_order_idx"
  ON "stalls"."stall_form_section" ("definition_id", "sort_order");

-- ── What a field can now carry ──────────────────────────────────────────────
ALTER TABLE "stalls"."stall_form_field"
  ADD COLUMN "definition_id" UUID,
  ADD COLUMN "section_id"    UUID,
  ADD COLUMN "name"          TEXT,
  ADD COLUMN "help"          TEXT,
  ADD COLUMN "help_ta"       TEXT,
  ADD COLUMN "is_built_in"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "options"       JSONB,
  ADD COLUMN "min"           INTEGER,
  ADD COLUMN "max"           INTEGER;

ALTER TABLE "stalls"."stall_form_field"
  ADD CONSTRAINT "stall_form_field_definition_id_fkey"
    FOREIGN KEY ("definition_id") REFERENCES "stalls"."stall_form_definition"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "stall_form_field_section_id_fkey"
    FOREIGN KEY ("section_id") REFERENCES "stalls"."stall_form_section"("id") ON DELETE SET NULL;

CREATE INDEX "stall_form_field_definition_id_sort_order_idx"
  ON "stalls"."stall_form_field" ("definition_id", "sort_order");

-- ⚠️ A built-in field's `name` is the key its answer travels under, so two
-- built-ins on one form answering to the same name is a submission where one
-- silently wins. The index is partial because an APPENDED field has no name at
-- all — its id is its key — and NULLs would otherwise collide with each other.
CREATE UNIQUE INDEX "stall_form_field_builtin_name"
  ON "stalls"."stall_form_field" ("definition_id", "name")
  WHERE "name" IS NOT NULL;

-- The existing appended fields keep working untouched: is_built_in defaults to
-- false, name stays null, and `definition_id` is backfilled by
-- `seedFormDefinitions` on the next boot — it needs the definition rows, which
-- are written from the constants in `@stalls/core` rather than from SQL.
