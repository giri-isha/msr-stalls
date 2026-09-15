import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app';
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
import { LogMailer, prisma, resetDatabase, seedEdition } from './helpers/db';
import { recordingWhatsApp } from './helpers/onboarding';

let app: FastifyInstance;
const mail = new LogMailer();
const whatsapp = recordingWhatsApp();
beforeAll(async () => {
  app = await buildApp({ logger: false, mail, whatsapp, webOrigin: 'http://web.example' });
});
afterAll(() => app.close());

beforeEach(async () => {
  await resetDatabase();
  await seedEdition();
});

const url = (p: string) => `/api/m/stalls/public/${p}`;
const postRegister = (body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: url('register'), payload: body });

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

describe('POST /public/register', () => {
  beforeEach(() => {
    mail.sent.length = 0;
    whatsapp.sent.length = 0;
  });

  test('a free email creates an account and an UNCONFIRMED credential', async () => {
    const res = await postRegister({
      contact: 'new@vendor.example',
      password: 'hunter2hunter2',
      displayName: 'New Vendor',
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ ok: true });

    const cred = await prisma.stallCredential.findUniqueOrThrow({
      where: { loginValue: 'new@vendor.example' },
    });
    expect(cred.confirmedAt).toBeNull();
    expect(cred.loginKind).toBe('EMAIL');
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe('new@vendor.example');
  });

  test('a free mobile is confirmed over WhatsApp, not email', async () => {
    const res = await postRegister({
      contact: '98400 12399',
      password: 'hunter2hunter2',
      displayName: 'Trader',
    });
    expect(res.statusCode).toBe(202);
    expect(whatsapp.sent).toHaveLength(1);
    expect(whatsapp.sent[0].to).toBe('9840012399');
    expect(mail.sent).toHaveLength(0);

    // The address column is non-null and unique, so a mobile registration gets
    // a placeholder. Nothing may ever send to it.
    const acct = await prisma.stallAccount.findFirstOrThrow();
    expect(acct.email).toBe('mobile+9840012399@stalls.invalid');
    expect(acct.phone).toBe('9840012399');
  });

  // 🔴 THE test for this feature. A taken contact, a free one and a string that
  // is not a contact must be one response. Anything else and the route answers
  // "has this shopkeeper applied?"
  test('taken, free and malformed are byte-identical responses', async () => {
    await account('taken@vendor.example', '9840012345');

    const free = await postRegister({
      contact: 'free@vendor.example',
      password: 'hunter2hunter2',
      displayName: 'A',
    });
    const taken = await postRegister({
      contact: 'taken@vendor.example',
      password: 'hunter2hunter2',
      displayName: 'B',
    });
    const junk = await postRegister({
      contact: 'not a contact',
      password: 'hunter2hunter2',
      displayName: 'C',
    });

    expect(taken.statusCode).toBe(free.statusCode);
    expect(junk.statusCode).toBe(free.statusCode);
    expect(taken.body).toBe(free.body);
    expect(junk.body).toBe(free.body);
  });

  // 🔴 The refusal is real, it just travels by the account's own channel.
  test('registering on a taken contact warns the ACCOUNT and makes no credential', async () => {
    await account('taken@vendor.example', '9840012345');
    await postRegister({
      contact: 'taken@vendor.example',
      password: 'hunter2hunter2',
      displayName: 'Impostor',
    });

    expect(await prisma.stallCredential.count()).toBe(0);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe('taken@vendor.example');
    expect(mail.sent[0].subject.toLowerCase()).toContain('stall team');
    // The account also has a number, and the channel that works is the one the
    // person attempting it did not choose.
    expect(whatsapp.sent).toHaveLength(1);
    expect(whatsapp.sent[0].to).toBe('9840012345');
  });

  test('a taken MOBILE warns the account behind it', async () => {
    await account('taken@vendor.example', '9840012345');
    await postRegister({
      contact: '9840012345',
      password: 'hunter2hunter2',
      displayName: 'Impostor',
    });
    expect(await prisma.stallCredential.count()).toBe(0);
    expect(mail.sent[0].to).toBe('taken@vendor.example');
  });

  test('a malformed contact sends nothing at all', async () => {
    await postRegister({
      contact: 'not a contact',
      password: 'hunter2hunter2',
      displayName: 'C',
    });
    expect(mail.sent).toHaveLength(0);
    expect(whatsapp.sent).toHaveLength(0);
    expect(await prisma.stallAccount.count()).toBe(0);
  });

  test('a second registration on the same contact does not replace the first', async () => {
    await postRegister({
      contact: 'first@vendor.example',
      password: 'hunter2hunter2',
      displayName: 'First',
    });
    const before = await prisma.stallCredential.findUniqueOrThrow({
      where: { loginValue: 'first@vendor.example' },
    });

    await postRegister({
      contact: 'first@vendor.example',
      password: 'adifferentpassword',
      displayName: 'Second',
    });
    const after = await prisma.stallCredential.findUniqueOrThrow({
      where: { loginValue: 'first@vendor.example' },
    });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(await prisma.stallCredential.count()).toBe(1);
  });

  test('a password under the floor is a validation error, not a silent 202', async () => {
    const res = await postRegister({
      contact: 'short@vendor.example',
      password: 'short',
      displayName: 'Short',
    });
    expect(res.statusCode).toBe(400);
  });
});

/** The confirmation token, taken from the message that carried it — the way a
 *  vendor gets it. Only the hash is stored, so there is no reading it back out
 *  of the table, and that is the point of storing it that way. */
function tokenFromLastMessage(): string {
  const text = mail.sent.at(-1)?.text ?? whatsapp.sent.at(-1)?.text ?? '';
  const found = text.match(/https?:\/\/\S+\/(?:confirm|reset)\/([A-Za-z0-9_-]+)/);
  if (!found) throw new Error(`no link in: ${text}`);
  return found[1];
}

async function registered(contact = 'new@vendor.example', password = 'hunter2hunter2') {
  mail.sent.length = 0;
  whatsapp.sent.length = 0;
  await postRegister({ contact, password, displayName: 'New Vendor' });
  return tokenFromLastMessage();
}

async function loggedIn(contact = 'new@vendor.example', password = 'hunter2hunter2') {
  const token = await registered(contact, password);
  const res = await app.inject({
    method: 'POST',
    url: url('register/confirm'),
    payload: { token },
  });
  return res.cookies.find((c) => c.name === 'msr_stall_requester')?.value ?? '';
}

describe('confirm, login, logout', () => {
  beforeEach(() => {
    mail.sent.length = 0;
    whatsapp.sent.length = 0;
  });

  test('confirming the link logs them straight in', async () => {
    const token = await registered();
    const res = await app.inject({
      method: 'POST',
      url: url('register/confirm'),
      payload: { token },
    });
    expect(res.statusCode).toBe(200);

    const cookie = res.cookies.find((c) => c.name === 'msr_stall_requester');
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite?.toLowerCase()).toBe('lax');

    const cred = await prisma.stallCredential.findUniqueOrThrow({
      where: { loginValue: 'new@vendor.example' },
    });
    expect(cred.confirmedAt).not.toBeNull();
  });

  // A forwarded confirmation email is not a spare key.
  test('a confirmation link works once', async () => {
    const token = await registered();
    await app.inject({ method: 'POST', url: url('register/confirm'), payload: { token } });
    const again = await app.inject({
      method: 'POST',
      url: url('register/confirm'),
      payload: { token },
    });
    expect(again.statusCode).toBe(404);
  });

  test('an unconfirmed credential cannot log in', async () => {
    await registered();
    const res = await app.inject({
      method: 'POST',
      url: url('login'),
      payload: { contact: 'new@vendor.example', password: 'hunter2hunter2' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('login sets the session cookie and the session route answers', async () => {
    const value = await loggedIn();
    await app.inject({
      method: 'POST',
      url: url('logout'),
      cookies: { msr_stall_requester: value },
    });

    const res = await app.inject({
      method: 'POST',
      url: url('login'),
      payload: { contact: 'new@vendor.example', password: 'hunter2hunter2' },
    });
    expect(res.statusCode).toBe(200);
    const fresh = res.cookies.find((c) => c.name === 'msr_stall_requester')?.value ?? '';

    const me = await app.inject({
      method: 'GET',
      url: url('session'),
      cookies: { msr_stall_requester: fresh },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ displayName: 'New Vendor', email: 'new@vendor.example' });
  });

  // 🔴 Two different failures, one response, down to the byte.
  test('a wrong password and an unknown contact are the same 401', async () => {
    await loggedIn();
    const unknown = await app.inject({
      method: 'POST',
      url: url('login'),
      payload: { contact: 'nobody@vendor.example', password: 'hunter2hunter2' },
    });
    const wrong = await app.inject({
      method: 'POST',
      url: url('login'),
      payload: { contact: 'new@vendor.example', password: 'wrongwrongwrong' },
    });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(wrong.body).toBe(unknown.body);
  });

  // ⚠️ 404, not 401. A public page asks this on every render; a 401 would make
  // the browser treat the apply form as something it must authenticate for.
  test('the session route without a cookie is 404, not a hint', async () => {
    const res = await app.inject({ method: 'GET', url: url('session') });
    expect(res.statusCode).toBe(404);
  });

  test('a mobile registration reports no address, not a placeholder', async () => {
    const value = await loggedIn('9840012399');
    const me = await app.inject({
      method: 'GET',
      url: url('session'),
      cookies: { msr_stall_requester: value },
    });
    expect(me.json().email).toBe('');
    expect(me.json().phone).toBe('9840012399');
  });

  test('logout revokes the session', async () => {
    const value = await loggedIn();
    await app.inject({
      method: 'POST',
      url: url('logout'),
      cookies: { msr_stall_requester: value },
    });
    const after = await app.inject({
      method: 'GET',
      url: url('session'),
      cookies: { msr_stall_requester: value },
    });
    expect(after.statusCode).toBe(404);
  });
});

describe('password reset', () => {
  beforeEach(() => {
    mail.sent.length = 0;
    whatsapp.sent.length = 0;
  });

  const ask = (contact: string) =>
    app.inject({ method: 'POST', url: url('password-reset'), payload: { contact } });

  // 🔴 Same rule as registration. "No account on that address" would be an
  // answer to a question this route refuses to be asked.
  test('an unknown contact gets the same 202 as a known one, and no mail', async () => {
    await loggedIn();
    mail.sent.length = 0;

    const known = await ask('new@vendor.example');
    const unknown = await ask('nobody@vendor.example');
    const junk = await ask('not a contact');

    expect(known.statusCode).toBe(202);
    expect(unknown.statusCode).toBe(known.statusCode);
    expect(junk.statusCode).toBe(known.statusCode);
    expect(unknown.body).toBe(known.body);
    expect(junk.body).toBe(known.body);
    // Exactly one went out: the one with an account behind it.
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe('new@vendor.example');
  });

  test('a reset sets the new password and evicts every live session', async () => {
    const stale = await loggedIn();
    mail.sent.length = 0;

    await ask('new@vendor.example');
    const token = tokenFromLastMessage();
    const res = await app.inject({
      method: 'POST',
      url: url('password-reset/confirm'),
      payload: { token, password: 'brandnewpassword' },
    });
    expect(res.statusCode).toBe(200);

    // The session that asked for the reset is gone — that is most of the point.
    const dead = await app.inject({
      method: 'GET',
      url: url('session'),
      cookies: { msr_stall_requester: stale },
    });
    expect(dead.statusCode).toBe(404);

    const old = await app.inject({
      method: 'POST',
      url: url('login'),
      payload: { contact: 'new@vendor.example', password: 'hunter2hunter2' },
    });
    expect(old.statusCode).toBe(401);

    const fresh = await app.inject({
      method: 'POST',
      url: url('login'),
      payload: { contact: 'new@vendor.example', password: 'brandnewpassword' },
    });
    expect(fresh.statusCode).toBe(200);
  });

  test('a reset link works once', async () => {
    await loggedIn();
    mail.sent.length = 0;
    await ask('new@vendor.example');
    const token = tokenFromLastMessage();

    await app.inject({
      method: 'POST',
      url: url('password-reset/confirm'),
      payload: { token, password: 'brandnewpassword' },
    });
    const again = await app.inject({
      method: 'POST',
      url: url('password-reset/confirm'),
      payload: { token, password: 'thirdpasswordhere' },
    });
    expect(again.statusCode).toBe(404);
  });

  // Following the link proves the contact, which is the same thing the
  // confirmation link proves — so a vendor who never confirmed is not stranded.
  test('a reset also confirms a registration that was never confirmed', async () => {
    await registered('never@vendor.example');
    mail.sent.length = 0;

    await ask('never@vendor.example');
    const token = tokenFromLastMessage();
    await app.inject({
      method: 'POST',
      url: url('password-reset/confirm'),
      payload: { token, password: 'brandnewpassword' },
    });

    const res = await app.inject({
      method: 'POST',
      url: url('login'),
      payload: { contact: 'never@vendor.example', password: 'brandnewpassword' },
    });
    expect(res.statusCode).toBe(200);
  });
});
