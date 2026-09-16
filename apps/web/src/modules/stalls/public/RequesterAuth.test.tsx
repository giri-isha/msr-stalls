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
  /** Which of the three forms this account may fill — see `FormPicker`. */
  requesterType: 'VENDOR',
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
    await userEvent.click(screen.getByRole('radio', { name: /vendor/i }));
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
    await userEvent.click(screen.getByRole('radio', { name: /vendor/i }));
    await userEvent.type(screen.getByLabelText(/password/i), 'short');
    await userEvent.click(screen.getByRole('button', { name: /create my account/i }));

    expect(await screen.findByText(/at least 8/i)).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/public/register'))).toBe(false);
  });

  /** 🔴 Which form the account may fill, asked here and nowhere else. It
   *  decides which form opens for this login and the API refuses a request of
   *  any other type, so an account created without it would be an account that
   *  cannot apply. */
  test('sends the kind of stall the account is for', async () => {
    const { calls } = installFetch([
      SIGNED_OUT,
      ['POST', /\/public\/register$/, () => [202, { ok: true }]],
    ]);
    renderAt('/register', [{ path: '/register', element: <Register /> }], { requester: true });

    await userEvent.type(await screen.findByLabelText(/your name/i), 'Priya');
    await userEvent.type(screen.getByLabelText(/email address or mobile/i), 'a@b.example');
    await userEvent.click(screen.getByRole('radio', { name: /local welfare/i }));
    await userEvent.type(screen.getByLabelText(/password/i), 'hunter2hunter2');
    await userEvent.click(screen.getByRole('button', { name: /create my account/i }));

    await screen.findByText(/it is ready now/i);
    const sent = calls.find((c) => c.url.endsWith('/public/register'))?.body;
    expect(sent).toMatchObject({ requesterType: 'LOCAL_WELFARE' });
  });

  // ⚠️ Nothing is pre-picked. It is the one answer on this screen a requester
  // cannot change afterwards without calling the stall team, so it is asked
  // rather than defaulted — and asking means refusing to send without it.
  test('will not send an account with no kind chosen', async () => {
    const { calls } = installFetch([
      SIGNED_OUT,
      ['POST', /\/public\/register$/, () => [202, { ok: true }]],
    ]);
    renderAt('/register', [{ path: '/register', element: <Register /> }], { requester: true });

    await userEvent.type(await screen.findByLabelText(/your name/i), 'Priya');
    await userEvent.type(screen.getByLabelText(/email address or mobile/i), 'a@b.example');
    await userEvent.type(screen.getByLabelText(/password/i), 'hunter2hunter2');
    await userEvent.click(screen.getByRole('button', { name: /create my account/i }));

    expect(await screen.findByText(/choose the kind of stall/i)).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/public/register'))).toBe(false);
    expect(screen.getAllByRole('radio').every((r) => !(r as HTMLInputElement).checked)).toBe(true);
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

  /** 🔴 One form opens: the one the account is registered for. The three
   *  populations are asked different questions and priced off different rate
   *  scopes, so which one a request is cannot be picked here. */
  test('only the account’s own form is a link', async () => {
    installFetch([SIGNED_IN, CONFIG]);
    renderAt('/apply', [{ path: '/apply', element: <FormPicker /> }], { requester: true });

    // Relative to wherever the picker is mounted — `/apply` in this harness.
    expect(await screen.findByRole('link', { name: /vendor/i })).toHaveAttribute(
      'href',
      '/apply/vendor',
    );
    expect(screen.queryByRole('link', { name: /ashram/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /local welfare/i })).not.toBeInTheDocument();
  });

  /** ⚠️ Drawn, and locked, rather than hidden. A department that registered as
   *  a vendor by mistake has to see that the form they want exists and that the
   *  fix is a phone call — a tile that silently vanished says neither. */
  test('the other two forms stay on screen, and say whose account this is', async () => {
    installFetch([SIGNED_IN, CONFIG]);
    renderAt('/apply', [{ path: '/apply', element: <FormPicker /> }], { requester: true });

    expect(await screen.findByText('Ashram Stall Request Form')).toBeInTheDocument();
    expect(screen.getByText('Local Welfare Stall Request Form')).toBeInTheDocument();
    expect(screen.getByText(/registered for/i)).toBeInTheDocument();
    expect(screen.getByText(/contact the stall team/i)).toBeInTheDocument();
  });

  /** An account that has never applied and pre-dates the question: nothing has
   *  decided yet, so all three are open. See `resolveRequesterType`. */
  test('an account with no type on it is offered all three forms', async () => {
    installFetch([
      ['GET', /\/public\/session$/, () => ({ ...SESSION, requesterType: null })],
      CONFIG,
    ]);
    renderAt('/apply', [{ path: '/apply', element: <FormPicker /> }], { requester: true });

    expect(await screen.findByRole('link', { name: /vendor/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ashram/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /local welfare/i })).toBeInTheDocument();
  });
});
