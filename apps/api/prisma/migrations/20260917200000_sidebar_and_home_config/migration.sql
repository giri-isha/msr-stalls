-- Sidebar Layout and Home Page, per role.
--
-- The sidebar was a literal in the web module and the landing was one fixed
-- screen, so "the electrical volunteer should not open on a request pipeline
-- they cannot read" had no answer short of a deploy. These three tables are
-- that answer.
--
-- ⚠️ Nothing is backfilled, and that is the point. Every table starts EMPTY,
-- and empty means "take the registry defaults" — so the sidebar and the home
-- page after this migration are byte-for-byte what they were before it. A role
-- only starts reading from these rows once an admin has actually arranged it.

-- Headings. Only overrides live here: the seven built-ins are in the registry,
-- and a row exists for one of them once somebody renames or moves it. Deleting
-- the row restores the shipped heading.
CREATE TABLE "stalls"."stall_nav_category" (
  "key"        TEXT NOT NULL,
  "label"      TEXT NOT NULL,
  "ordinal"    INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,

  CONSTRAINT "stall_nav_category_pkey" PRIMARY KEY ("key")
);

-- One role's placement of one sidebar item.
--
-- ⚠️ "category_key" is deliberately NOT a foreign key: most placements name a
-- built-in heading, which has no row in the table above at all.
CREATE TABLE "stalls"."stall_role_nav_item" (
  "role_key"     TEXT NOT NULL,
  "item_key"     TEXT NOT NULL,
  "category_key" TEXT NOT NULL,
  "ordinal"      INTEGER NOT NULL,
  "is_shown"     BOOLEAN NOT NULL DEFAULT true,

  CONSTRAINT "stall_role_nav_item_pkey" PRIMARY KEY ("role_key", "item_key")
);

CREATE TABLE "stalls"."stall_role_home_widget" (
  "role_key"   TEXT NOT NULL,
  "widget_key" TEXT NOT NULL,
  "ordinal"    INTEGER NOT NULL,
  "is_shown"   BOOLEAN NOT NULL DEFAULT true,

  CONSTRAINT "stall_role_home_widget_pkey" PRIMARY KEY ("role_key", "widget_key")
);

-- The resolver reads one role's whole list in order, every time the shell asks
-- who the caller is. That read is the index.
CREATE INDEX "stall_role_nav_item_role_key_ordinal_idx"
  ON "stalls"."stall_role_nav_item" ("role_key", "ordinal");
CREATE INDEX "stall_role_home_widget_role_key_ordinal_idx"
  ON "stalls"."stall_role_home_widget" ("role_key", "ordinal");

-- CASCADE on both sides, like "stall_role_privilege": a deleted role takes its
-- arrangement with it, and a re-keyed role carries it along. A leftover layout
-- for a role nobody holds is rows the resolver can never reach and an admin can
-- never see.
ALTER TABLE "stalls"."stall_role_nav_item"
  ADD CONSTRAINT "stall_role_nav_item_role_key_fkey"
  FOREIGN KEY ("role_key") REFERENCES "stalls"."stall_role"("role_key")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stalls"."stall_role_home_widget"
  ADD CONSTRAINT "stall_role_home_widget_role_key_fkey"
  FOREIGN KEY ("role_key") REFERENCES "stalls"."stall_role"("role_key")
  ON DELETE CASCADE ON UPDATE CASCADE;
