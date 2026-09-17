import type { Person, PrismaClient } from '@prisma/client';
import {
  type RoleSummary,
  type BackofficeMember,
  type PersonMatch,
  type StagedPersonInput,
  type UpdatePersonInput,
  cannotAssign,
  cannotEdit,
} from '@stalls/core';
import { actorFrom, audit } from './audit';
import { normalizeEmail } from './accounts';
import type { Db } from './editions';
import {
  LastAdminError,
  PersonAboveYouError,
  PersonEmailTakenError,
  PrivilegeEscalationError,
  RoleAboveYouError,
  UnknownPersonError,
  UnknownRoleError,
} from './errors';
import { MODULE_KEY, type BackofficeCaller, assignableRolesFor, editableRolesFor } from './roles';

/** The roles, with the caller's own reach marked on each.
 *
 *  ⚠️ Served rather than shipped in the bundle. The Users screen used to render
 *  its picker from the `ROLES` constant, which stopped being the truth the
 *  moment roles became data — a role an admin creates is on no list the client
 *  holds (msr ADR 0065). `assignable` is computed per caller so the picker
 *  cannot offer a choice the grant route is about to refuse. */
export async function listRoles(
  db: PrismaClient,
  caller: BackofficeCaller,
): Promise<RoleSummary[]> {
  const [rows, assignable, activePrivileges] = await Promise.all([
    db.stallRole.findMany({
      orderBy: { sortOrder: 'asc' },
      // Counted here rather than per card. The grid draws every role at once,
      // so a count fetched on open would be a request per role.
      include: { _count: { select: { privileges: true, grants: true } } },
    }),
    assignableRolesFor(db, caller),
    db.stallPrivilege.count({ where: { isActive: true } }),
  ]);
  return rows.map((r) => ({
    roleKey: r.roleKey,
    name: r.name,
    description: r.description,
    parentKey: r.parentKey,
    level: r.level,
    isSystem: r.isSystem,
    assignable: assignable.has(r.roleKey),
    // ⚠️ A role carrying the flag has NO join rows — it resolves against the
    // live table — so counting its rows would say "0 privileges" on the most
    // powerful card in the grid.
    privilegeCount: r.allPrivileges ? activePrivileges : r._count.privileges,
    grantCount: r._count.grants,
    allPrivileges: r.allPrivileges,
    requestTypeScope: r.requestTypeScope,
  }));
}

/** The name a refusal should call a role, which is the name an admin sees on
 *  the screen rather than the key underneath it. */
async function roleNameOf(db: PrismaClient, roleKey: string): Promise<string> {
  const role = await db.stallRole.findUnique({ where: { roleKey }, select: { name: true } });
  return role?.name ?? roleKey;
}

/** Refuses a caller who may not hand this role out.
 *
 *  The rule is `assignableRoleKeys`: everything beneath the roles they hold,
 *  plus their own where the role carries `canAssignSameLevel`. Never a sibling. */
async function assertCanAssign(
  db: PrismaClient,
  caller: BackofficeCaller,
  roleKey: string,
): Promise<void> {
  const exists = await db.stallRole.findUnique({ where: { roleKey }, select: { roleKey: true } });
  if (!exists) throw new UnknownRoleError(roleKey);
  const assignable = await assignableRolesFor(db, caller);
  if (!assignable.has(roleKey)) {
    throw new RoleAboveYouError(roleKey, cannotAssign(await roleNameOf(db, roleKey)));
  }
}

/** Refuses a caller who may not touch this person's account at all.
 *
 *  ⚠️ EVERY role the subject holds must be within reach, not merely the one
 *  being changed. Otherwise a lead could strip the Volunteer role from somebody
 *  who is also an admin — editing an account above them by picking the one
 *  attribute of it that happens to sit below them.
 *
 *  A person holding no roles yet passes, which is what lets a new backoffice member
 *  be given their first one. */
async function assertCanEditPerson(
  db: PrismaClient,
  caller: BackofficeCaller,
  personRef: string,
): Promise<void> {
  const held = await db.stallBackofficeRole.findMany({
    where: { personRef },
    select: { roleKey: true, role: { select: { name: true } } },
  });
  const editable = await editableRolesFor(db, caller);
  const blocking = held.find((g) => !editable.has(g.roleKey));
  if (!blocking) return;
  const person = await db.person.findUnique({
    where: { personId: personRef },
    select: { displayName: true },
  });
  throw new PersonAboveYouError(
    personRef,
    cannotEdit(person?.displayName ?? 'That person', blocking.role.name),
  );
}

/** Everyone who holds at least one stalls role, with the roles. Reads the
 *  Foundation's Person for the name and email — this is a read, and all but two
 *  of this module's uses of that table are: see `stagePerson` below for the two
 *  that are not, and why. */
export async function listBackoffice(db: Db): Promise<BackofficeMember[]> {
  const grants = await db.stallBackofficeRole.findMany({ orderBy: { createdAt: 'asc' } });
  const refs = [...new Set(grants.map((g) => g.personRef))];
  const people = await db.person.findMany({ where: { personId: { in: refs } } });
  const byId = new Map(people.map((p) => [p.personId, p]));
  return refs.flatMap((ref) => {
    const p = byId.get(ref);
    if (!p) return [];
    return [
      {
        personId: p.personId,
        email: p.email,
        displayName: p.displayName,
        roleKeys: grants.filter((g) => g.personRef === ref).map((g) => g.roleKey),
      },
    ];
  });
}

/**
 * Somebody put into the Foundation's directory by an admin here.
 *
 * 🔴 **THE ONE PLACE THIS MODULE WRITES `foundation.person`.** Every other
 * reference to that table in this module is a read, and the rule that made it
 * so is a good one — a module does not own the Foundation's record of a human.
 * What changed is the alternative: a desk that needed a coordinator added had
 * to ask somebody with console access and wait, for a row that only exists so a
 * name and an address can be pointed at. The refusal was costing more than it
 * protected.
 *
 * ⚠️ **The row is CLAIMABLE, not an account.** `staged` says nobody has signed
 * in as this person yet; their first sign-in matches them by email and takes
 * the row over, roles and all. That is why the address is validated rather than
 * merely stored, and why a duplicate is refused rather than merged: two rows on
 * one address means a grant made to a human who may never receive it, and this
 * seam cannot know which of the two is them.
 *
 * ⚠️ **In the host, `staged` is `ssoId: null`** — see the `Person` model. This
 * function is the one that has to change there, and it is the reason staging
 * lives in a named seam rather than inline in `grantRole`.
 *
 * Called inside the grant's transaction, never on its own: a person staged for
 * a grant that was then refused is a human in the directory with nothing to do
 * there.
 */
async function stagePerson(tx: Db, input: StagedPersonInput): Promise<Person> {
  const email = normalizeEmail(input.email);
  const held = await tx.person.findUnique({ where: { email } });
  if (held) throw new PersonEmailTakenError(held.displayName);
  return tx.person.create({
    data: {
      email,
      displayName: input.displayName,
      phone: input.phone || null,
      // Stated rather than left to the default: this flag being set is the
      // whole meaning of the row, not an incidental property of it.
      staged: true,
    },
  });
}

/**
 * A role handed to somebody — one already in the directory, or one this call
 * puts there.
 *
 * ⚠️ **Staging and granting are one transaction**, for the reason `stagePerson`
 * gives. Everything that can refuse the caller is checked BEFORE it opens, so a
 * rollback is the last resort rather than the ordinary path.
 */
export async function grantRole(
  db: PrismaClient,
  input: {
    /** The person picked out of the directory. Exclusive with `newPerson` —
     *  `GrantRoleInput` refuses a body carrying both or neither. */
    personRef?: string;
    newPerson?: StagedPersonInput;
    roleKey: string;
    editionScope?: string[];
    zoneScope?: string[];
  },
  caller: BackofficeCaller,
): Promise<{ personId: string }> {
  const by = caller.personId;
  await assertCanAssign(db, caller, input.roleKey);
  // Only for the picked arm. A person who does not exist yet holds no role, so
  // there is nothing for the hierarchy check to find and nothing to look up.
  let person: Person | null = null;
  if (input.personRef) {
    await assertCanEditPerson(db, caller, input.personRef);
    person = await db.person.findUnique({ where: { personId: input.personRef } });
    if (!person) throw new UnknownPersonError(input.personRef);
  }
  const editionScope = input.editionScope ?? [];
  const zoneScope = input.zoneScope ?? [];

  // ⚠️ A scoped grantor must not hand out a WIDER grant than their own, for the
  // same reason `assertNoEscalation` guards the role editor: an empty scope
  // means "every edition" and "every bay", so an unscoped grant made by a
  // bay-scoped marshal would reach past them.
  if (caller.editionScope !== null) {
    const beyond =
      editionScope.length === 0 || editionScope.some((id) => !caller.editionScope?.includes(id));
    if (beyond) {
      throw new PrivilegeEscalationError(
        'you cannot grant access to an edition your own access does not cover',
      );
    }
  }
  if (caller.zoneScope !== null) {
    const beyond = zoneScope.length === 0 || zoneScope.some((z) => !caller.zoneScope?.includes(z));
    if (beyond) {
      throw new PrivilegeEscalationError(
        'you cannot grant access to a bay your own access does not cover',
      );
    }
  }

  return db.$transaction(async (tx) => {
    let target = person;
    if (!target) {
      // `GrantRoleInput` refuses a body with neither arm, so this is the seam
      // defending itself against a caller that is not a route — a script, a
      // test — rather than a condition the screens can produce.
      if (!input.newPerson) throw new UnknownPersonError(input.personRef ?? '');
      target = await stagePerson(tx, input.newPerson);
    }
    await tx.stallBackofficeRole.upsert({
      where: { personRef_roleKey: { personRef: target.personId, roleKey: input.roleKey } },
      create: {
        personRef: target.personId,
        roleKey: input.roleKey,
        grantedBy: by,
        editionScope,
        zoneScope,
      },
      // Re-granting a role somebody already holds RESETS its scope rather than
      // leaving the old one in place: the grant screen sends the whole picture,
      // so a narrowed grant that silently kept last year's wider reach would be
      // the one failure nobody would look for.
      update: { editionScope, zoneScope },
    });
    await audit(tx, {
      actor: actorFrom(by),
      action: 'stall_backoffice_role.granted',
      subject: { type: 'person', ref: target.personId },
      detail: {
        roleKey: input.roleKey,
        editionScope,
        zoneScope,
        ...(person ? {} : { staged: target.email }),
      },
    });
    return { personId: target.personId };
  });
}

/**
 * A backoffice member's own name, address and number, corrected.
 *
 * 🔴 **The second write into `foundation.person`, and it follows from the
 * first.** Staging a person from a typed address means typos reach the
 * directory; a module that can create the row and not mend it has made the
 * problem it refuses to fix. Editing is therefore gated exactly as granting is
 * — `users.write` plus the hierarchy check, so a lead cannot rename an admin.
 *
 * ⚠️ **For somebody who really signs in through the Foundation, this is a local
 * correction with a short life.** Under the host's Isha SSO the name and the
 * address are the identity provider's and are refreshed on their next sign-in.
 * The dialog says so in words; nothing here can enforce it.
 *
 * ⚠️ Moving the address moves the CLAIM KEY of a staged row — the sign-in that
 * takes it over matches on email — so a corrected typo is precisely what makes
 * a staged person reachable, and a wrong correction is what hands their role to
 * somebody else. It is refused against an address another person already holds,
 * naming them, for the same reason `AccountEmailTakenError` does.
 */
export async function updatePersonDetails(
  db: PrismaClient,
  personRef: string,
  input: UpdatePersonInput,
  caller: BackofficeCaller,
): Promise<void> {
  await assertCanEditPerson(db, caller, personRef);
  const person = await db.person.findUnique({ where: { personId: personRef } });
  if (!person) throw new UnknownPersonError(personRef);

  const next = {
    displayName: input.displayName,
    email: normalizeEmail(input.email),
    phone: input.phone || null,
  };
  if (next.email !== person.email) {
    const held = await db.person.findUnique({ where: { email: next.email } });
    if (held) throw new PersonEmailTakenError(held.displayName);
  }

  const changed: Record<string, { from: string | null; to: string | null }> = {};
  for (const field of ['displayName', 'email', 'phone'] as const) {
    if (next[field] !== person[field]) changed[field] = { from: person[field], to: next[field] };
  }
  // Nothing to write is nothing to record. A no-op that still wrote a trail row
  // would fill the answer to "who renamed this person" with visits.
  if (Object.keys(changed).length === 0) return;

  await db.person.update({ where: { personId: personRef }, data: next });
  await audit(db, {
    actor: actorFrom(caller.personId),
    action: 'person.updated',
    subject: { type: 'person', ref: personRef },
    detail: changed,
  });
}

/** Refuses to remove the last admin: with nobody holding `config.write` and
 *  `users.write`, nobody could grant it back.
 *
 *  Taking a role away is gated exactly as handing it out is — if the role is
 *  out of your reach, so is removing it — plus the account check, so a lead
 *  cannot demote an admin by picking off their lesser roles. */
export async function revokeRole(
  db: PrismaClient,
  input: { personRef: string; roleKey: string },
  caller: BackofficeCaller,
): Promise<void> {
  const by = caller.personId;
  await assertCanAssign(db, caller, input.roleKey);
  await assertCanEditPerson(db, caller, input.personRef);
  await db.$transaction(async (tx) => {
    if (input.roleKey === 'stalls_admin') {
      const admins = await tx.stallBackofficeRole.count({ where: { roleKey: 'stalls_admin' } });
      const isAdmin = await tx.stallBackofficeRole.findUnique({
        where: { personRef_roleKey: { personRef: input.personRef, roleKey: 'stalls_admin' } },
      });
      if (isAdmin && admins <= 1) throw new LastAdminError();
    }
    await tx.stallBackofficeRole.deleteMany({
      where: { personRef: input.personRef, roleKey: input.roleKey },
    });
    await audit(tx, {
      actor: actorFrom(by),
      action: 'stall_backoffice_role.revoked',
      subject: { type: 'person', ref: input.personRef },
      detail: { roleKey: input.roleKey },
    });
  });
}

/** The directory, for the "add a backoffice member" picker.
 *
 *  ⚠️ It is also the step that has to run BEFORE anybody is staged, which is
 *  why `staged` travels on each row: the list an admin is deciding "none of
 *  these" against must be able to show them the person they added last week,
 *  marked as somebody who has not arrived yet, rather than look like a miss and
 *  invite a second row on the same address. */
export async function searchPeople(db: Db, q: string): Promise<PersonMatch[]> {
  return db.person.findMany({
    where: {
      signInDisabled: false,
      OR: [
        { email: { contains: q, mode: 'insensitive' } },
        { displayName: { contains: q, mode: 'insensitive' } },
      ],
    },
    take: 20,
    orderBy: { displayName: 'asc' },
    select: { personId: true, email: true, displayName: true, phone: true, staged: true },
  });
}
