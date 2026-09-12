import { beforeEach, describe, expect, test } from 'vitest';
import {
  findOrCreateAccount,
  hashToken,
  mintAccessLink,
  resolveAccessLink,
} from '../src/modules/stalls/accounts';
import { UnknownAccessLinkError } from '../src/modules/stalls/errors';
import { prisma, resetDatabase } from './helpers/db';

beforeEach(resetDatabase);

const priya = { email: 'priya@greenleaf.example', phone: '9840012345', displayName: 'Priya' };

describe('findOrCreateAccount', () => {
  test('matches on normalised email — case and whitespace do not make two vendors', async () => {
    const a = await findOrCreateAccount(prisma, { ...priya, email: 'Priya@GreenLeaf.example ' });
    const b = await findOrCreateAccount(prisma, { ...priya, email: 'priya@greenleaf.example' });
    expect(a.id).toBe(b.id);
    expect(a.email).toBe('priya@greenleaf.example');
    expect(await prisma.stallAccount.count()).toBe(1);
  });

  test('keeps the first display name and phone on a later match', async () => {
    await findOrCreateAccount(prisma, priya);
    const again = await findOrCreateAccount(prisma, { ...priya, displayName: 'P. Venkat' });
    expect(again.displayName).toBe('Priya');
  });
});

describe('mintAccessLink', () => {
  test('stores only the hash — the raw token appears nowhere in the row', async () => {
    const acct = await findOrCreateAccount(prisma, priya);
    const { token, link } = await mintAccessLink(prisma, {
      accountId: acct.id,
      purpose: 'STATUS',
      ttlDays: 30,
    });
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(link.tokenHash).toBe(hashToken(token));
    expect(link.tokenHash).not.toBe(token);
    expect(JSON.stringify(link)).not.toContain(token);
  });

  test('two mints never produce the same token', async () => {
    const acct = await findOrCreateAccount(prisma, priya);
    const a = await mintAccessLink(prisma, { accountId: acct.id, purpose: 'STATUS', ttlDays: 1 });
    const b = await mintAccessLink(prisma, { accountId: acct.id, purpose: 'STATUS', ttlDays: 1 });
    expect(a.token).not.toBe(b.token);
  });
});

describe('resolveAccessLink', () => {
  test('returns the link and its account for a live token', async () => {
    const acct = await findOrCreateAccount(prisma, priya);
    const { token } = await mintAccessLink(prisma, {
      accountId: acct.id,
      purpose: 'STATUS',
      ttlDays: 1,
    });
    const link = await resolveAccessLink(prisma, token, 'STATUS');
    expect(link.account.email).toBe('priya@greenleaf.example');
  });

  test('throws the SAME error class for unknown, expired and revoked', async () => {
    const acct = await findOrCreateAccount(prisma, priya);
    const now = new Date('2026-09-12T00:00:00Z');

    const expired = await mintAccessLink(prisma, {
      accountId: acct.id,
      purpose: 'STATUS',
      ttlDays: 1,
      now,
    });
    const revoked = await mintAccessLink(prisma, {
      accountId: acct.id,
      purpose: 'STATUS',
      ttlDays: 30,
      now,
    });
    await prisma.stallAccessLink.update({
      where: { id: revoked.link.id },
      data: { revokedAt: now },
    });
    const later = new Date('2026-09-14T00:00:00Z');

    await expect(
      resolveAccessLink(prisma, 'not-a-real-token-at-all-xxxxxx', 'STATUS', later),
    ).rejects.toBeInstanceOf(UnknownAccessLinkError);
    await expect(resolveAccessLink(prisma, expired.token, 'STATUS', later)).rejects.toBeInstanceOf(
      UnknownAccessLinkError,
    );
    await expect(resolveAccessLink(prisma, revoked.token, 'STATUS', later)).rejects.toBeInstanceOf(
      UnknownAccessLinkError,
    );
  });

  test('a token minted for one purpose does not open another', async () => {
    const acct = await findOrCreateAccount(prisma, priya);
    const { token } = await mintAccessLink(prisma, {
      accountId: acct.id,
      purpose: 'STATUS',
      ttlDays: 1,
    });
    await expect(resolveAccessLink(prisma, token, 'BANK_FORM')).rejects.toBeInstanceOf(
      UnknownAccessLinkError,
    );
  });

  test('an empty or absurdly long token is refused before any lookup', async () => {
    await expect(resolveAccessLink(prisma, '')).rejects.toBeInstanceOf(UnknownAccessLinkError);
    await expect(resolveAccessLink(prisma, 'x'.repeat(500))).rejects.toBeInstanceOf(
      UnknownAccessLinkError,
    );
  });
});
