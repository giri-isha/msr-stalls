import { beforeEach, describe, expect, test } from 'vitest';
import {
  authenticate,
  createCredential,
  hashPassword,
  verifyPassword,
} from '../src/modules/stalls/credentials';
import { InvalidCredentialsError } from '../src/modules/stalls/errors';
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
