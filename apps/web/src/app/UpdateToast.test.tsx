import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const h = vi.hoisted(() => ({
  needRefresh: false,
  update: vi.fn(async (_reload?: boolean) => {}),
}));
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [h.needRefresh, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: h.update,
  }),
}));

const { InstallPrompt, UpdateToast } = await import('./UpdateToast');

beforeEach(() => {
  h.needRefresh = false;
  h.update.mockClear();
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('the update prompt', () => {
  test('says nothing while there is nothing waiting', () => {
    render(<UpdateToast />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  /** 🔴 The worker is registered with `registerType: 'prompt'`, so an update
   *  installs and WAITS. `autoUpdate` would reload the page the moment a deploy
   *  landed — on a phone at a counter with a half-filled form open. */
  test('offers a reload, and does not take one', async () => {
    h.needRefresh = true;
    render(<UpdateToast />);

    expect(await screen.findByRole('status')).toHaveTextContent('A new version is ready');
    expect(h.update).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole('button', { name: /Reload/ }));
    expect(h.update).toHaveBeenCalledWith(true);
  });
});

describe('the install prompt', () => {
  /** A fired `beforeinstallprompt` is the only reliable signal that installing
   *  is POSSIBLE — every other way of guessing is wrong on some device
   *  somebody will be holding. */
  const fire = () => {
    const e = new Event('beforeinstallprompt') as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    };
    e.prompt = vi.fn(async () => {});
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
    return e;
  };

  test('shows nothing until the browser says installing is possible', () => {
    render(<InstallPrompt />);
    expect(screen.queryByRole('button', { name: /Install/ })).not.toBeInTheDocument();
  });

  test('and offers it once the browser does', async () => {
    render(<InstallPrompt />);
    fire();
    expect(await screen.findByRole('button', { name: /Install/ })).toBeInTheDocument();
  });

  /** ⚠️ The event is single-use whatever the person chose, so the button must
   *  go — one whose second press does nothing is worse than none. */
  test('the offer goes away once it has been taken', async () => {
    render(<InstallPrompt />);
    const e = fire();
    await userEvent.setup().click(await screen.findByRole('button', { name: /Install/ }));

    expect(e.prompt).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Install/ })).not.toBeInTheDocument();
  });

  test('dismissing it is remembered across visits', async () => {
    const first = render(<InstallPrompt />);
    fire();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('button', { name: /Install/ })).not.toBeInTheDocument();
    first.unmount();

    render(<InstallPrompt />);
    fire();
    expect(screen.queryByRole('button', { name: /Install/ })).not.toBeInTheDocument();
  });
});
