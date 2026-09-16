import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { PUBLIC_CONFIG, installFetch, renderAt } from '../test-utils';
import { FormPicker } from './FormPicker';
import { Login } from './Login';
import { Register } from './Register';
import { ResetPassword } from './ResetPassword';

/** The temporary password login.
 *
 *  What every test here is really about is the same thing the API tests are
 *  about: the screen must not tell the person typing anything the API refuses
 *  to tell them. A friendly "no account with that email" would undo the whole
 *  arrangement from the front.
 */

const SESSION = {
  accountId: 'a-1',
  displayName: 'Priya Venkat',
  email: 'priya@greenleaf.example',
  phone: '9840012345',
};

/** Signed out: `/public/session` answers 404, which is the normal case. */
const SIGNED_OUT = ['GET', /\/public\/session$/, () => [404, { error: 'no session' }]] as const;
const SIGNED_IN = ['GET', /\/public\/session$/, () => SESSION] as const;
const CONFIG = ['GET', /\/public\/config$/, () => PUBLIC_CONFIG] as const;

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('Login', () => {
  test('sends the contact and the password', async () => {
    const { calls } = installFetch([
      SIGNED_OUT,
      ['POST', /\/public\/login$/, () => ({ ok: true })],
    ]);
    renderAt('/login', [{ path: '/login', element: <Login /> }], { requester: true });

    await userEvent.type(await screen.findByLabelText(/email address or mobile/i), 'a@b.example');
    await userEvent.type(screen.getByLabelText(/password/i), 'hunter2hunter2');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => {
      const login = calls.find((c) => c.url.endsWith('/public/login'));
      expect(login?.body).toEqual({ contact: 'a@b.example', password: 'hunter2hunter2' });
    });
  });

  // 🔴 One message, and it must not name which half was wrong. "No account with
  // that email" would answer, from the browser, the question the API spent
  // three routes refusing to answer.
  test('a failure says one thing, and never which half was wrong', async () => {
    installFetch([
      SIGNED_OUT,
      ['POST', /\/public\/login$/, () => [401, { error: 'that login is not valid' }]],
    ]);
    renderAt('/login', [{ path: '/login', element: <Login /> }], { requester: true });

    await userEvent.type(await screen.findByLabelText(/email address or mobile/i), 'a@b.example');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrongpassword');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));

    const alert = await screen.findByRole('alert');
    const said = (alert.textContent ?? '').toLowerCase();
    expect(said).toMatch(/do not match|not valid/);
    expect(said).not.toMatch(/no account|not found|does not exist|no such|unregistered/);
  });
});

describe('Register', () => {
  // 🔴 The API answers 202 to a free contact, a taken one and a string that is
  // not a contact. Copy promising "your account has been created" would be a
  // lie in two of those three cases — and the lie would be informative.
  test('always lands on the same panel, whatever the contact was', async () => {
    installFetch([SIGNED_OUT, ['POST', /\/public\/register$/, () => [202, { ok: true }]]]);
    renderAt('/register', [{ path: '/register', element: <Register /> }], { requester: true });

    await userEvent.type(await screen.findByLabelText(/your name/i), 'Priya');
    await userEvent.type(screen.getByLabelText(/email address or mobile/i), 'a@b.example');
    await userEvent.type(screen.getByLabelText(/password/i), 'hunter2hunter2');
    await userEvent.click(screen.getByRole('button', { name: /create my account/i }));

    expect(await screen.findByText(/it is ready now/i)).toBeInTheDocument();
    // It must not claim an account was made — that would be false for a contact
    // that already had one, and informatively false. The panel hedges on "if we
    // could set up an account", which is why the bare claim must not appear.
    expect(screen.queryByText(/account (has been |was )?created/i)).not.toBeInTheDocument();
    // And it must cover the reader who would otherwise wait on a message that
    // is never coming.
    expect(screen.getByText(/applied for a stall before/i)).toBeInTheDocument();
    expect(screen.getByText(/stall team will set your login up/i)).toBeInTheDocument();
  });

  test('refuses a password under the floor before it sends anything', async () => {
    const { calls } = installFetch([
      SIGNED_OUT,
      ['POST', /\/public\/register$/, () => [202, { ok: true }]],
    ]);
    renderAt('/register', [{ path: '/register', element: <Register /> }], { requester: true });

    await userEvent.type(await screen.findByLabelText(/your name/i), 'Priya');
    await userEvent.type(screen.getByLabelText(/email address or mobile/i), 'a@b.example');
    await userEvent.type(screen.getByLabelText(/password/i), 'short');
    await userEvent.click(screen.getByRole('button', { name: /create my account/i }));

    expect(await screen.findByText(/at least 8/i)).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/public/register'))).toBe(false);
  });
});

describe('ResetPassword', () => {
  test('asking for a link always says the same thing', async () => {
    installFetch([SIGNED_OUT, ['POST', /\/public\/password-reset$/, () => [202, { ok: true }]]]);
    renderAt('/forgot', [{ path: '/forgot', element: <ResetPassword /> }], { requester: true });

    await userEvent.type(await screen.findByLabelText(/email address or mobile/i), 'a@b.example');
    await userEvent.click(screen.getByRole('button', { name: /send.*link/i }));

    expect(await screen.findByText(/check your email or whatsapp/i)).toBeInTheDocument();
    expect(screen.getByText(/if there is a login for that/i)).toBeInTheDocument();
  });

  test('with a token it sets the new password', async () => {
    const { calls } = installFetch([
      SIGNED_OUT,
      ['POST', /\/public\/password-reset\/confirm$/, () => ({ ok: true })],
    ]);
    renderAt('/reset/tok', [{ path: '/reset/:token', element: <ResetPassword /> }], {
      requester: true,
    });

    await userEvent.type(await screen.findByLabelText(/new password/i), 'brandnewpassword');
    await userEvent.click(screen.getByRole('button', { name: /set.*password/i }));

    await waitFor(() => {
      const sent = calls.find((c) => c.url.endsWith('/public/password-reset/confirm'));
      expect(sent?.body).toEqual({ token: 'tok', password: 'brandnewpassword' });
    });
  });
});

describe('the apply gate', () => {
  test('signed out, the form tiles are not reachable', async () => {
    installFetch([SIGNED_OUT, CONFIG]);
    renderAt('/apply', [{ path: '/apply', element: <FormPicker /> }], { requester: true });

    expect(await screen.findByRole('link', { name: /log in/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /create an account/i })).toBeInTheDocument();
    // The tiles are still SHOWN — an applicant should see what they are signing
    // up for — but none of them is a link.
    expect(screen.queryByRole('link', { name: /vendor/i })).not.toBeInTheDocument();
  });

  test('signed in, the tiles are links again and the gate is gone', async () => {
    installFetch([SIGNED_IN, CONFIG]);
    renderAt('/apply', [{ path: '/apply', element: <FormPicker /> }], { requester: true });

    expect(await screen.findByRole('link', { name: /vendor/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /create an account/i })).not.toBeInTheDocument();
  });
});
