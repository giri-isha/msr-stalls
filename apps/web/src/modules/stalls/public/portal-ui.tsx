import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useRequester } from '../requester';
import { Icon, useIsMobile, useToast } from '../ui';

/**
 * The pieces the requester's own pages are built from — one plate, one heading,
 * one label-and-value row, one copyable value, one way back — so the payment
 * figures, the coupon, the read-back grid and the forms read as one thing
 * rather than as panels that grew separately.
 */

/** The plate a tab body's block sits on. Fills its grid cell: the tab bodies
 *  lay their panels out two-up above 720px and the grid does the capping. */
export function Panel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 6,
        justifyItems: 'start',
        alignContent: 'start',
        width: '100%',
        padding: '14px 16px',
        borderRadius: 'var(--r3)',
        background: 'var(--mut)',
        border: '1px solid var(--bd)',
      }}
    >
      {children}
    </div>
  );
}

/** A panel's heading. Muted and small, so the figures under it are what a
 *  reader's eye lands on. */
export function PanelTitle({ icon, children }: { icon?: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        fontSize: 12,
        fontWeight: 700,
        color: 'var(--mfg)',
        marginBottom: 4,
      }}
    >
      {icon && <Icon name={icon} size={13} color='var(--pri)' />}
      {children}
    </div>
  );
}

/** A label and its value.
 *
 *  ⚠️ STACKED on a phone, side by side above it. Beside each other the label
 *  takes a fixed 132px rail, which is what lines the rows up into a column a
 *  reader can scan — and on a 390px screen leaves too little for a coupon code,
 *  so the value wrapped under a label that was still vertically centred against
 *  it. Label over value is the same information in the space there is. */
export function Row({ k, v, strong }: { k: string; v: ReactNode; strong?: boolean }) {
  const mobile = useIsMobile();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: mobile ? 'column' : 'row',
        gap: mobile ? 2 : 10,
        width: '100%',
        fontSize: 12.5,
        alignItems: mobile ? 'stretch' : 'center',
      }}
    >
      <div style={{ width: mobile ? undefined : 132, flex: 'none', color: 'var(--mfg)' }}>{k}</div>
      <div style={{ flex: 1, minWidth: 0, fontWeight: strong ? 700 : 600 }}>{v}</div>
    </div>
  );
}

/**
 * A value a requester has to get somewhere else exactly right — an account
 * number they will type into their bank, a coupon they will forward to their
 * team. Both are transcription errors waiting to happen, and a wrong account
 * number means money that has to be traced.
 *
 * ⚠️ The clipboard is not always there — an insecure origin, an older browser,
 * a denied permission — so a failure falls back to telling them to copy it by
 * hand rather than silently doing nothing. The value is on screen either way;
 * the button is a convenience, never the only way to get at it.
 */
export function Copyable({ value, label }: { value: string; label: string }) {
  const toast = useToast();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.ok(`${label} copied.`);
    } catch {
      toast.fail(
        new Error(`Could not copy. Please select the ${label.toLowerCase()} and copy it.`),
      );
    }
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace' }}>{value}</span>
      <button
        type='button'
        onClick={() => void copy()}
        aria-label={`Copy ${label.toLowerCase()}`}
        title={`Copy ${label.toLowerCase()}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: 4,
          borderRadius: 'var(--r1)',
          border: '1px solid var(--bd)',
          background: 'var(--bg)',
          color: 'var(--mfg)',
          cursor: 'pointer',
        }}
      >
        <Icon name='copy' size={12} />
      </button>
    </span>
  );
}

/**
 * The way back out of a page that was opened from somewhere else.
 *
 * 🔴 The steps are full PAGES — the bank form and the FSSAI upload are reached
 * by a whole-page navigation onto a freshly minted link, staff registration by
 * a coupon URL, the application form by its own route — so the page they came
 * from is gone from the screen and the only way back was the browser's own
 * button. On a phone, which is where most of these are filled in, that button
 * is a chin nobody's thumb is near.
 *
 * ⚠️ A LINK to a named place, not `history.back()`. Half of these pages are
 * arrived at from an email, where there is no previous page in the tab at all
 * and a back control would either do nothing or leave the site.
 */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        width: 'fit-content',
        fontSize: 12.5,
        fontWeight: 600,
        color: 'var(--mfg)',
      }}
    >
      <Icon name='chevron-left' size={14} />
      {children}
    </Link>
  );
}

/**
 * Back to the requester's own portal, for a step opened out of it.
 *
 * ⚠️ NOTHING at all when signed out — the rule the public shell already follows
 * for its header controls. A vendor holding a bank-form link from an email has
 * no portal to go back to, and a link that bounced them to a login would be
 * worse than no link.
 *
 * ⚠️ Reads the session, so it may only be drawn inside `RequesterProvider` —
 * which is to say on a public page, never inside a form body the backoffice
 * also mounts.
 */
export function BackToRequests() {
  const { requester } = useRequester();
  if (!requester) return null;
  return <BackLink to='/stalls/requests'>My Requests</BackLink>;
}
