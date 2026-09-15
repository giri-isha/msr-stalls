import 'dotenv/config';
import { type HeldRole, parseContact, unionPrivileges, unionRequestTypeScope } from '@msr/stalls';
import { hashPassword } from '../src/modules/stalls/credentials';
import { prisma } from '../src/prisma';

/**
 * Who can sign in locally, what each of them may do, and a way to set a
 * requester's password for testing.
 *
 *   npm run dev:users --workspace=apps/api
 *   npm run dev:users --workspace=apps/api -- --set-password priya@maildrop.cc newpassword
 *
 * ── Two populations, and only one of them has a password ────────────────────
 * STAFF are `Person` rows with grants in `StallStaffRole`. They have no
 * password anywhere in this module — the standalone shell signs them in by
 * email through the host's `getCurrentPerson` seam (see `auth.ts`), and the
 * host will use its own SSO. So there is nothing here to change for them; the
 * listing shows what each one may do instead.
 *
 * REQUESTERS are `StallAccount` rows, and their password lives in
 * `StallCredential`. That is the temporary pre-SSO login, and the only thing
 * `--set-password` can touch.
 *
 * ⚠️ DEVELOPMENT ONLY. It writes a password you have typed in plain text on a
 * command line, so it refuses to run against anything that does not look like
 * a local database.
 */

function assertLocalDatabase(url: string | undefined): void {
  if (!url) throw new Error('DATABASE_URL is not set');
  const local = /localhost|127\.0\.0\.1|\/var\/run\/postgresql/.test(url);
  const named = /_dev|_test|_local/.test(url);
  if (!local || !named) {
    throw new Error(
      `refusing to run against ${url.replace(/:[^:@/]*@/, ':***@')} — ` +
        'this script sets passwords from the command line and is for a local ' +
        'database whose name ends in _dev, _test or _local',
    );
  }
}

async function listStaff(): Promise<void> {
  const people = await prisma.person.findMany({ orderBy: { email: 'asc' } });
  const grants = await prisma.stallStaffRole.findMany({
    select: {
      personRef: true,
      roleKey: true,
      role: {
        select: {
          name: true,
          allPrivileges: true,
          requestTypeScope: true,
          privileges: {
            where: { privilege: { isActive: true } },
            select: { privilege: { select: { code: true } } },
          },
        },
      },
    },
  });
  // Roles are data now, so what each one grants is read back from the tables
  // rather than looked up in a constant this script could ship a stale copy of.
  const activePrivileges = (
    await prisma.stallPrivilege.findMany({ where: { isActive: true }, select: { code: true } })
  ).map((r) => r.code);
  const heldByPerson = new Map<string, HeldRole[]>();
  const roleNames = new Map<string, string>();
  for (const g of grants) {
    roleNames.set(g.roleKey, g.role.name);
    heldByPerson.set(g.personRef, [
      ...(heldByPerson.get(g.personRef) ?? []),
      {
        roleKey: g.roleKey,
        allPrivileges: g.role.allPrivileges,
        privileges: g.role.privileges.map((rp) => rp.privilege.code),
        requestTypeScope: g.role.requestTypeScope.length === 0 ? null : g.role.requestTypeScope,
      },
    ]);
  }
  const byPerson = new Map<string, string[]>();
  for (const g of grants) {
    byPerson.set(g.personRef, [...(byPerson.get(g.personRef) ?? []), g.roleKey]);
  }

  console.log('\n═══ STAFF — sign in by email, no password ═══\n');
  if (people.length === 0) console.log('  (none — run `npm run db:seed`)');

  for (const p of people) {
    const roleKeys = byPerson.get(p.personId) ?? [];
    const names = roleKeys.map((k) => roleNames.get(k) ?? k);
    const held = heldByPerson.get(p.personId) ?? [];
    const actions = unionPrivileges(held, activePrivileges);
    // `null` means every requester type; `[]` means they hold no role at all.
    const scope = unionRequestTypeScope(held);

    console.log(`  ${p.email}`);
    console.log(`    ${p.displayName}${p.signInDisabled ? '  [SIGN-IN DISABLED]' : ''}`);
    console.log(
      `    roles   ${roleKeys.length ? `${names.join(', ')} (${roleKeys.join(', ')})` : 'none — can sign in, can do nothing'}`,
    );
    console.log(`    may do  ${actions.length ? actions.join(', ') : '—'}`);
    // A local welfare lead holds real write access, just not to anyone else's
    // requests. Worth printing: it is the grant most easily mistaken for full
    // access when reading the role name alone.
    if (scope !== null && scope.length > 0) {
      console.log(`    limited to  ${scope.join(', ')} requests only`);
    }
    console.log('');
  }
}

async function listRequesters(): Promise<void> {
  const accounts = await prisma.stallAccount.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      credentials: true,
      _count: { select: { requests: true } },
    },
  });

  console.log('═══ REQUESTERS — email or mobile + password ═══\n');
  if (accounts.length === 0) console.log('  (none — run `npm run db:seed`)');

  for (const a of accounts) {
    const cred = a.credentials[0];
    const locked = cred?.lockedUntil && cred.lockedUntil > new Date();
    // ⚠️ Print the ACCOUNT's contact whether or not there is a credential. It is
    // what `--set-password` is given, so an account with no login is exactly the
    // one whose address the reader needs most.
    const placeholder = a.email.endsWith('@stalls.invalid');

    console.log(`  ${a.displayName}`);
    console.log(`    contact  ${placeholder ? `${a.phone} (mobile only, no address)` : a.email}`);
    if (cred) {
      const unconfirmed = cred.confirmedAt ? '' : '  [UNCONFIRMED — cannot log in]';
      console.log(`    login    ${cred.loginValue} (${cred.loginKind})${unconfirmed}`);
    } else {
      console.log('    login    none — set one below to log in as them');
    }
    console.log(`    requests ${a._count.requests}`);
    if (locked) console.log(`    LOCKED until ${cred?.lockedUntil?.toISOString()}`);
    console.log('');
  }

  console.log('  To set one:');
  console.log(
    '    npm run dev:users --workspace=apps/api -- --set-password <contact> <password>\n',
  );
}

async function setPassword(rawContact: string, password: string): Promise<void> {
  if (password.length < 8) throw new Error('password must be at least 8 characters');

  const contact = parseContact(rawContact);
  if (!contact) throw new Error(`"${rawContact}" is not an email address or a 10-digit mobile`);

  const account =
    contact.kind === 'EMAIL'
      ? await prisma.stallAccount.findUnique({ where: { email: contact.value } })
      : await prisma.stallAccount.findFirst({
          where: { phone: contact.value },
          orderBy: { createdAt: 'asc' },
        });
  if (!account) throw new Error(`no account for ${contact.value}`);

  const existing = await prisma.stallCredential.findUnique({
    where: { loginValue: contact.value },
  });
  const passwordHash = await hashPassword(password);

  if (existing) {
    await prisma.stallCredential.update({
      where: { id: existing.id },
      // Confirmed and unlocked: the point of this script is to hand you a login
      // that works right now, not to reproduce the confirmation flow.
      data: { passwordHash, confirmedAt: new Date(), failedCount: 0, lockedUntil: null },
    });
  } else {
    await prisma.stallCredential.create({
      data: {
        accountId: account.id,
        loginValue: contact.value,
        loginKind: contact.kind,
        passwordHash,
        confirmedAt: new Date(),
      },
    });
  }

  // Every live session for this account goes, exactly as a real reset does —
  // otherwise a stale cookie in your browser outlives the password you just set
  // and you end up debugging the wrong thing.
  await prisma.stallAccessLink.updateMany({
    where: { accountId: account.id, purpose: 'SESSION', revokedAt: null },
    data: { revokedAt: new Date() },
  });

  console.log(`\n  ${account.displayName} can now log in as ${contact.value}`);
  console.log('  Existing sessions for that account were revoked.\n');
}

async function main(): Promise<void> {
  assertLocalDatabase(process.env.DATABASE_URL);
  const [flag, contact, password] = process.argv.slice(2);

  if (flag === '--set-password') {
    if (!contact || !password) {
      throw new Error('usage: --set-password <email-or-mobile> <password>');
    }
    await setPassword(contact, password);
    return;
  }
  if (flag) throw new Error(`unknown option ${flag}`);

  await listStaff();
  await listRequesters();
}

main()
  .catch((e: Error) => {
    console.error(`\n  ${e.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
