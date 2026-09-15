-- Consent declarations: the wording a requester ticks, as data.
--
-- The disclaimer was a constant in `packages/stalls/src/forms.ts` and the
-- consent was one `agreed_at` timestamp. That records THAT somebody agreed and
-- never WHAT they agreed to.

CREATE TABLE "stalls"."stall_declaration" (
  "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
  "edition_id"   UUID         NOT NULL,
  "key"          TEXT         NOT NULL,
  "request_type" "stalls"."StallRequestType",
  "version"      INTEGER      NOT NULL,
  "title"        TEXT         NOT NULL,
  "body"         TEXT         NOT NULL,
  "body_ta"      TEXT,
  "is_active"    BOOLEAN      NOT NULL DEFAULT true,
  "is_current"   BOOLEAN      NOT NULL DEFAULT true,
  "created_at"   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "created_by"   TEXT,
  "archived_at"  TIMESTAMPTZ,

  CONSTRAINT "stall_declaration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stall_declaration_edition_id_fkey"
    FOREIGN KEY ("edition_id") REFERENCES "stalls"."stall_edition"("id") ON DELETE CASCADE
);

CREATE INDEX "stall_declaration_edition_id_key_idx"
  ON "stalls"."stall_declaration" ("edition_id", "key");

-- ── Two invariants, both enforced here rather than in application code ───────
--
-- 🔴 (1) ONE CURRENT VERSION per edition, key and variant. Two live versions of
-- a consent is the one state nobody can resolve after the fact: the form picks
-- whichever the query returned first, half the requesters tick one and half the
-- other, and the record of which is which is the thing that was supposed to be
-- authoritative. A check in the writer would be a check two concurrent writers
-- both pass.
--
-- ⚠️ TWO indexes, not one, and that is Postgres rather than indecision: NULLs
-- compare as DISTINCT in a unique index, so a single index over
-- (edition, key, request_type) would happily admit two current defaults. The
-- second index covers exactly the rows the first one cannot see.
CREATE UNIQUE INDEX "stall_declaration_one_current"
  ON "stalls"."stall_declaration" ("edition_id", "key", "request_type")
  WHERE "is_current";

CREATE UNIQUE INDEX "stall_declaration_one_current_default"
  ON "stalls"."stall_declaration" ("edition_id", "key")
  WHERE "is_current" AND "request_type" IS NULL;

-- (2) Version numbers do not repeat within a variant. Same NULL problem, same
-- pair of indexes.
CREATE UNIQUE INDEX "stall_declaration_version"
  ON "stalls"."stall_declaration" ("edition_id", "key", "request_type", "version");

CREATE UNIQUE INDEX "stall_declaration_version_default"
  ON "stalls"."stall_declaration" ("edition_id", "key", "version")
  WHERE "request_type" IS NULL;

-- ── The consent log ─────────────────────────────────────────────────────────
--
-- ⚠️ `declaration_id` references the VERSION and has NO cascade on delete.
-- Deleting wording somebody agreed to would leave the agreement meaning
-- nothing, so the delete is refused instead — a declaration is retired with
-- `is_active`, never removed.
CREATE TABLE "stalls"."stall_declaration_consent" (
  "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
  "request_id"     UUID        NOT NULL,
  "declaration_id" UUID        NOT NULL,
  "agreed_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "stall_declaration_consent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stall_declaration_consent_request_id_fkey"
    FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE,
  CONSTRAINT "stall_declaration_consent_declaration_id_fkey"
    FOREIGN KEY ("declaration_id") REFERENCES "stalls"."stall_declaration"("id")
);

CREATE UNIQUE INDEX "stall_declaration_consent_request_id_declaration_id_key"
  ON "stalls"."stall_declaration_consent" ("request_id", "declaration_id");

CREATE INDEX "stall_declaration_consent_declaration_id_idx"
  ON "stalls"."stall_declaration_consent" ("declaration_id");
