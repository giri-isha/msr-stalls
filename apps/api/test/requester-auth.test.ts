import { beforeEach, describe, expect, test } from 'vitest';
import {
  authenticate,
  createCredential,
  hashPassword,
  verifyPassword,
} from '../src/modules/stalls/credentials';
import { mintAccessLink, resolveAccessLink } from '../src/modules/stalls/accounts';
import { InvalidCredentialsError, UnknownAccessLinkError } from '../src/modules/stalls/errors';
import {
  endAllSessions,
  endSession,
  requireRequester,
  startSession,
} from '../src/modules/stalls/session';
import { prisma, resetDatabase, seedEdition } from './helpers/db';

beforeEach(async () => {
  await resetDatabase();
  await seedEdition();
});

async function account(email = 'priya@greenleaf.example', phone = '9840012345') {
  return prisma.stallAccount.create({
    data: { email, phone, displayName: 'Priya Venkat' },
  });
}

async function confirmedCredential(contact: { kind: 'EMAIL' | 'MOBILE'; value: string }) {
  const acct = await account();
  const cred = await createCredential(prisma, {
    accountId: acct.id,
    contact,
    password: 'hunter2hunter2',
  });
  await prisma.stallCredential.update({
    where: { id: cred.id },
    data: { confirmedAt: new Date() },
  });
  return cred;
}

describe('password hashing', () => {
  test('a hash verifies against its own password and nothing else', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('correct horse batteries', stored)).toBe(false);
  });

  // 🔴 A per-hash salt. Two people who pick the same password must not be
  // visibly the same row in a leaked dump.
  test('the same password hashes differently every time', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  test('a stored value in an unknown format verifies nothing', async () => {
    expect(await verifyPassword('anything', 'bcrypt$whatever')).toBe(false);
    expect(await verifyPassword('anything', '')).toBe(false);
  });
});

describe('authenticate', () => {
  test('returns the credential for the right password on a confirmed login', async () => {
    const cred = await confirmedCredential({ kind: 'EMAIL', value: 'priya@greenleaf.example' });

    const got = await authenticate(prisma, {
      contact: 'Priya@GreenLeaf.Example',
      password: 'hunter2hunter2',
    });
    expect(got.id).toBe(cred.id);
  });

  // 🔴 The three ways to fail must be ONE error. Anything else turns login into
  // a way of asking whether a given number has applied — the question decision
  // 17 exists to refuse.
  test('unknown contact, wrong password and unconfirmed are one error', async () => {
    const acct = await account();
    await createCredential(prisma, {
      accountId: acct.id,
      contact: { kind: 'MOBILE', value: '9840012345' },
      password: 'hunter2hunter2',
    });

    const attempts = [
      authenticate(prisma, { contact: '9000000000', password: 'hunter2hunter2' }),
      authenticate(prisma, { contact: '9840012345', password: 'nope' }),
      authenticate(prisma, { contact: '9840012345', password: 'hunter2hunter2' }),
    ];

    const messages: string[] = [];
    for (const attempt of attempts) {
      await expect(attempt).rejects.toBeInstanceOf(InvalidCredentialsError);
      messages.push(await attempt.catch((e: Error) => e.message));
    }
    expect(new Set(messages).size).toBe(1);
  });

  test('a contact that is not a contact at all is that same error', async () => {
    await expect(
      authenticate(prisma, { contact: 'not a contact', password: 'hunter2hunter2' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  test('locks out after repeated failures, with that same error', async () => {
    await confirmedCredential({ kind: 'EMAIL', value: 'priya@greenleaf.example' });

    for (let i = 0; i < 10; i++) {
      await expect(
        authenticate(prisma, { contact: 'priya@greenleaf.example', password: 'wrong' }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    }
    // The RIGHT password now fails too — that is what a lockout is.
    await expect(
      authenticate(prisma, { contact: 'priya@greenleaf.example', password: 'hunter2hunter2' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  test('a good login clears the failure count', async () => {
    const cred = await confirmedCredential({ kind: 'EMAIL', value: 'priya@greenleaf.example' });

    await expect(
      authenticate(prisma, { contact: 'priya@greenleaf.example', password: 'wrong' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    await authenticate(prisma, {
      contact: 'priya@greenleaf.example',
      password: 'hunter2hunter2',
    });

    const after = await prisma.stallCredential.findUniqueOrThrow({ where: { id: cred.id } });
    expect(after.failedCount).toBe(0);
  });
});

describe('session', () => {
  test('a started session resolves back to its account', async () => {
    const acct = await account();
    const token = await startSession(prisma, acct.id);
    const got = await requireRequester(prisma, { cookies: { msr_stall_requester: token } });
    expect(got.id).toBe(acct.id);
  });

  test('no cookie is refused', async () => {
    await expect(requireRequester(prisma, { cookies: {} })).rejects.toBeInstanceOf(
      UnknownAccessLinkError,
    );
  });

  test('ending a session revokes it', async () => {
    const acct = await account();
    const token = await startSession(prisma, acct.id);
    await endSession(prisma, token);
    await expect(
      requireRequester(prisma, { cookies: { msr_stall_requester: token } }),
    ).rejects.toBeInstanceOf(UnknownAccessLinkError);
  });

  test('ending every session evicts them all at once', async () => {
    const acct = await account();
    const first = await startSession(prisma, acct.id);
    const second = await startSession(prisma, acct.id);
    await endAllSessions(prisma, acct.id);
    for (const token of [first, second]) {
      await expect(
        requireRequester(prisma, { cookies: { msr_stall_requester: token } }),
      ).rejects.toBeInstanceOf(UnknownAccessLinkError);
    }
  });

  // 🔴 The purpose is the wall between the two credentials. A session cookie
  // must not open a bank form, and a bank-form token must not act as a session.
  // `resolveAccessLink` already refuses to cross; this is the test that says so
  // out loud, because the whole SSO swap rests on that one function.
  test('a session token cannot open a bank form, and a bank token is not a session', async () => {
    const acct = await account();
    const session = await startSession(prisma, acct.id);
    await expect(resolveAccessLink(prisma, session, 'BANK_FORM')).rejects.toBeInstanceOf(
      UnknownAccessLinkError,
    );

    const { token: bank } = await mintAccessLink(prisma, {
      accountId: acct.id,
      purpose: 'BANK_FORM',
      ttlDays: 180,
    });
    await expect(
      requireRequester(prisma, { cookies: { msr_stall_requester: bank } }),
    ).rejects.toBeInstanceOf(UnknownAccessLinkError);
  });

  test('an expired session is refused', async () => {
    const acct = await account();
    const token = await startSession(prisma, acct.id);
    await prisma.stallAccessLink.updateMany({
      where: { accountId: acct.id, purpose: 'SESSION' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      requireRequester(prisma, { cookies: { msr_stall_requester: token } }),
    ).rejects.toBeInstanceOf(UnknownAccessLinkError);
  });
});
