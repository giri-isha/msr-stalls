# Migrations

**Prisma names these folders. Do not hand-name one.**

```bash
cd apps/api

# SQL you will write yourself — the usual case here, since most of this schema
# is partial indexes, renames and comments that Prisma cannot derive.
npx prisma migrate dev --create-only --name declarations
# …then write the SQL, and apply it with:
npm run db:migrate
```

`--create-only` gives you the folder and an empty (or diff-derived) `migration.sql`
to replace. That is the whole reason hand-naming ever looked necessary.

## Why it matters

Prisma stamps the folder from **UTC** and replays migrations in **folder-name
order**. Hand-naming with round local hours — `20260915210000` for 9pm IST —
puts those folders 5h30m ahead of anything Prisma generates the same evening.

The next `migrate dev` then lands *behind* migrations that were written after it:

```
20260915171928_stalls1          ← generated 22:49 IST, stamped 17:19 UTC
20260915180000_role_level       ← hand-named, 5h30m ahead
…
20260915210000_declarations     ← creates stall_declaration
```

`stalls1` altered `stall_declaration`, so a shadow-database replay died on
`relation "stalls.stall_declaration" does not exist` (P3006 / 42P01). It is now
`20260916000000_align_with_prisma_schema`. `20260914113911_stalls` is the same
collision a day earlier; it survives only because it touches tables that exist
by then.

## The other half of the trap

A hand-written index or default that `schema.prisma` does not also declare is
**drift**, and the next `migrate dev` generates SQL to undo it. `DROP INDEX
"stalls"."stall_declaration_version"` is how one deliberate invariant nearly
went.

Partial indexes are safe — Prisma cannot express them, so it leaves them alone.
Anything plain must be declared in the model too:

```prisma
@@unique([editionId, key, requestType, version], map: "stall_declaration_version")
```

After writing a migration by hand, run `migrate dev` once more. `Already in
sync` means the schema and the SQL agree. A new folder means they do not.

## An applied migration is frozen — comments included

Prisma stores a **sha256 of the whole `migration.sql` file** in
`_prisma_migrations.checksum` and re-checks it on every `migrate dev`. Change
one byte of a migration that has already been applied and you get:

```
The migration `20260915220000_form_builder` was modified after it was applied.
We need to reset the following schemas: "foundation, stalls"
```

There is no repair command. The only two ways out are to drop the development
database or to restore the file to the exact bytes that were applied — so
restore the file:

```bash
git log -- apps/api/prisma/migrations/<folder>/     # find the commit that touched it
git show <commit>^:apps/api/prisma/migrations/<folder>/migration.sql \
  > apps/api/prisma/migrations/<folder>/migration.sql
```

`20260915220000_form_builder` hit this when the repo-wide `@msr/stalls` →
`@stalls/core` rename rewrote a **comment** in it. The SQL was untouched and the
database was already correct; the checksum alone forced a reset prompt on every
`migrate dev` afterwards.

So: **a rename sweep stops at this directory.** Give `sed -i`, a
find-and-replace and any codemod an exclusion for
`apps/api/prisma/migrations/`, and check `git status` there before committing
one. A stale name inside an applied migration is not a bug — the file records
what was run on that date, and on that date the package really was called
`@msr/stalls`.
