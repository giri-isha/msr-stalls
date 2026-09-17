import { type PendingStep, type PublicRequestStatus, isSelfServe } from '@stalls/core';
import { type ReactNode, useState } from 'react';
import { useSearchParams } from 'react-router';
import { StatusPill, TYPE_LABEL } from '../components/StatusPill';
import { formatDate } from '../hooks';
import { Btn, Card, Icon, Tabs, type TabDef, Tag, useIsMobile, useToast } from '../ui';
import { PaymentTab } from './PaymentTab';
import { StaffTab } from './StaffTab';
import { SubmittedTab } from './SubmittedTab';
import { Panel, PanelTitle } from './portal-ui';

/**
 * A requester's own request, drawn the same way whichever credential got them
 * here — the signed link in the receipt email, or the session cookie of
 * somebody logged in.
 *
 * ⚠️ The two pages differ ONLY in their callbacks: one names the request
 * against a token in the URL, the other against the cookie. Everything a
 * requester reads — what the status means, what is outstanding, which step has
 * a button — is here once. When each page drew its own, that was how a vendor
 * could be told they were all set on one screen and be stopped at the counter.
 *
 * ⚠️ Nothing here decides what is outstanding. `pending` arrives from the API,
 * out of the same `pendingSteps` the Onboarding table and the check-in counter
 * read. What this file decides is only which TAB a thing sits in — and a tab
 * exists only when the API sent something for it.
 *
 * 🔴 ONE request at a time, in TABS, where this was every request as a card
 * and every step as a chip with its detail hanging under it — eleven things
 * in one flow with nothing but vertical gaps saying which belonged to which.
 * The request is the page now: a header band names it, a strip of sections
 * runs under it, and each section has the room to lay its figures out.
 */
export interface RequestViewProps {
  requests: PublicRequestStatus[];
  /** Mints the link for one self-serve step. Called on the CLICK — see below. */
  openStep(reference: string, step: 'BANK_FORM' | 'FSSAI'): Promise<{ url: string }>;
  /** Issues the staff coupon, or returns the one already issued. Idempotent. */
  getCoupon(reference: string): Promise<{ code: string }>;
  /** Re-reads the requests, after something on this page changed them. */
  reload(): void;
}

export type PortalTab = 'overview' | 'bank' | 'payment' | 'fssai' | 'staff' | 'submitted';

const STATUS_COPY: Record<string, string> = {
  SUBMITTED: 'Received. The stall team will review it.',
  SHORTLISTED: 'Under consideration.',
  // 🔴 This used to end "Further instructions will follow by email", which was
  // both the plan and the problem: it pointed at an inbox as the only way
  // forward. What happens next is the list underneath, which they can act on.
  SELECTED: 'Selected. Anything still outstanding is listed below.',
  BACKUP: 'On the backup list — you will be contacted if a stall frees up.',
  REJECTED: 'Not selected this year.',
  CANCELLED: 'Cancelled.',
};

/**
 * Which tabs a request has, read off what the API sent.
 *
 * ⚠️ A step tab is present only while the API says the step is outstanding, or
 * has sent data for it. Bank details and FSSAI therefore vanish once done —
 * the API does not tell "done" from "not applicable" for those, and a green
 * tick invented here would be this page deciding.
 *
 * The marks are facts, not opinions: amber is "in `pending`"; green on Staff
 * is "somebody is registered", green on Payment is "a transfer was confirmed".
 */
export function portalTabs(r: PublicRequestStatus): Array<TabDef & { key: PortalTab }> {
  const pending = new Set(r.pending.map((p) => p.step));
  const claims = r.paymentClaims ?? [];
  const tabs: Array<TabDef & { key: PortalTab }> = [
    { key: 'overview', label: 'Overview', glyph: 'layout-grid' },
  ];
  if (pending.has('BANK_FORM')) {
    tabs.push({ key: 'bank', label: 'Bank Details', glyph: 'file-text', mark: 'warn' });
  }
  if (r.payment || pending.has('PAYMENT') || claims.length > 0) {
    tabs.push({
      key: 'payment',
      label: 'Payment',
      glyph: 'rupee',
      mark: pending.has('PAYMENT')
        ? 'warn'
        : claims.some((c) => c.status === 'VERIFIED')
          ? 'ok'
          : undefined,
    });
  }
  if (pending.has('FSSAI')) {
    tabs.push({ key: 'fssai', label: 'FSSAI', glyph: 'shield', mark: 'warn' });
  }
  if (r.staff) {
    tabs.push({
      key: 'staff',
      label: 'Staff',
      glyph: 'users',
      mark: pending.has('STAFF_REGISTRATION') ? 'warn' : r.staff.registered > 0 ? 'ok' : undefined,
    });
  }
  // ⚠️ `undefined` is tolerated, not just empty. The API and the web deploy
  // separately, and a page served ahead of the API must still show the status.
  if ((r.submitted ?? []).length > 0) {
    tabs.push({ key: 'submitted', label: 'What You Submitted', glyph: 'clipboard-list' });
  }
  return tabs;
}

export function RequestView({ requests, openStep, getCoupon, reload }: RequestViewProps) {
  const [params, setParams] = useSearchParams();
  // ⚠️ The chosen request lives in the URL, so a refresh or a forwarded link
  // lands on the same one. Anything that matches nothing falls back to the
  // first, which the API sends newest first.
  const ref = params.get('ref');
  const current = requests.find((r) => r.reference === ref) ?? requests[0];
  if (!current) return null;

  const pick = (reference: string) => {
    const next = new URLSearchParams(params);
    next.set('ref', reference);
    setParams(next, { replace: true });
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {requests.length > 1 && (
        <Switcher requests={requests} current={current.reference} onPick={pick} />
      )}
      {/* Keyed on the reference so the tab state starts over on a switch — a
          second request opened on the first one's Payment tab would be a page
          that had quietly kept its place in the wrong document. */}
      <RequestPanel
        key={current.reference}
        request={current}
        openStep={openStep}
        getCoupon={getCoupon}
        reload={reload}
      />
    </div>
  );
}

/** The row of requests, drawn only when there is more than one to choose from. */
function Switcher({
  requests,
  current,
  onPick,
}: {
  requests: PublicRequestStatus[];
  current: string;
  onPick(reference: string): void;
}) {
  return (
    <fieldset
      aria-label='Your Requests'
      style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: 0, padding: 0, border: 0 }}
    >
      {requests.map((r) => {
        const on = r.reference === current;
        return (
          <button
            key={r.reference}
            type='button'
            aria-pressed={on}
            onClick={() => onPick(r.reference)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 12px',
              borderRadius: 'var(--r2)',
              border: `1px solid ${on ? 'var(--pri)' : 'var(--bd)'}`,
              background: on ? 'var(--pri-t)' : 'var(--card)',
              color: on ? 'var(--pri)' : 'var(--fg)',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {r.stallName}
            <span
              style={{
                fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
                fontSize: 11,
                fontWeight: 500,
                color: 'var(--mfg)',
              }}
            >
              {r.reference}
            </span>
          </button>
        );
      })}
    </fieldset>
  );
}

/** One request: the header band, the tab strip and the open tab's body. */
function RequestPanel({
  request: r,
  openStep,
  getCoupon,
  reload,
}: { request: PublicRequestStatus } & Omit<RequestViewProps, 'requests'>) {
  const mobile = useIsMobile();
  const toast = useToast();
  const [active, setActive] = useState<PortalTab>('overview');
  const [busy, setBusy] = useState<string | null>(null);

  const tabs = portalTabs(r);
  // A tab that stopped existing — bank details went in, and the page re-read —
  // must not leave an empty body under the strip.
  const tab: PortalTab = tabs.some((t) => t.key === active) ? active : 'overview';

  // The link is minted on the click, not when the page loads. Rendering the
  // list would otherwise mint a bank-form link every time the page refreshed.
  const open = async (step: 'BANK_FORM' | 'FSSAI') => {
    setBusy(step);
    try {
      const { url } = await openStep(r.reference, step);
      // A whole-page navigation, not a router push: the URL is built by the
      // shell (the host decides where these pages live) and carries a token
      // this page has never seen.
      window.location.assign(url);
    } catch (e) {
      toast.fail(e);
      setBusy(null);
    }
  };

  return (
    <Card pad={0}>
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          flexWrap: 'wrap',
          padding: mobile ? '14px 16px' : '18px 22px',
          background: 'var(--rail)',
          borderBottom: '1px solid var(--line)',
          borderRadius: 'var(--r4) var(--r4) 0 0',
        }}
      >
        <div style={{ flex: 1, minWidth: 180 }}>
          <div
            style={{
              fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
              fontSize: 11.5,
              color: 'var(--mfg)',
            }}
          >
            {r.reference}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: mobile ? 18 : 22,
              fontWeight: 600,
              letterSpacing: '-.3px',
              marginTop: 1,
            }}
          >
            {r.stallName}
          </div>
          <div style={{ fontSize: 12, color: 'var(--mfg)', marginTop: 4 }}>
            {TYPE_LABEL[r.requestType] ?? r.requestType} · submitted {formatDate(r.submittedAt)}
          </div>
        </div>
        {r.allocatedStalls.length > 0 && (
          // The allocation is the one fact on this page a vendor comes back
          // for, so it sits in the band beside the status rather than as a
          // line of body text.
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 11px',
              borderRadius: 'var(--r2)',
              background: 'var(--ok-t)',
              border: '1px solid var(--ok-b)',
              color: 'var(--ok-fg)',
              fontSize: 12.5,
              fontWeight: 600,
            }}
          >
            <Icon name='map-pin' size={14} />
            Stall{r.allocatedStalls.length > 1 ? 's' : ''}{' '}
            <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace' }}>
              {r.allocatedStalls.join(', ')}
            </span>
          </div>
        )}
        <StatusPill status={r.status} />
      </header>

      <Tabs
        label='Request Sections'
        tabs={tabs}
        active={tab}
        onPick={(k) => setActive(k as PortalTab)}
        style={{ padding: mobile ? '0 8px' : '0 12px', marginBottom: 0 }}
      />

      <div style={{ padding: mobile ? '14px 16px 18px' : '18px 22px 24px' }}>
        {tab === 'overview' && (
          <Overview request={r} busy={busy} onOpen={open} onPick={setActive} />
        )}
        {tab === 'bank' && (
          <StepTab
            step={r.pending.find((p) => p.step === 'BANK_FORM')}
            busy={busy === 'BANK_FORM'}
            onOpen={() => void open('BANK_FORM')}
          >
            Your bank details, GST number and the name to invoice, so Finance can raise the invoice
            and return your deposit to the right account after the event. Only vendors are asked for
            this.
          </StepTab>
        )}
        {tab === 'payment' && <PaymentTab request={r} reload={reload} />}
        {tab === 'fssai' && (
          <StepTab
            step={r.pending.find((p) => p.step === 'FSSAI')}
            busy={busy === 'FSSAI'}
            onOpen={() => void open('FSSAI')}
          >
            A stall selling food needs its FSSAI certificate on file before check-in. Upload a photo
            or scan of it — up to five pages, if it was photographed a page at a time.
          </StepTab>
        )}
        {tab === 'staff' && <StaffTab request={r} getCoupon={getCoupon} />}
        {tab === 'submitted' && <SubmittedTab sections={r.submitted ?? []} />}
      </div>
    </Card>
  );
}

/**
 * The status, and what is still to do.
 *
 * Each outstanding step is a row with its own way forward: the two self-serve
 * forms open on a freshly minted link; payment and staff have nothing to mint,
 * so their rows switch to the tab where the figures and the coupon are.
 *
 * ⚠️ Drawn only for a SELECTED request. A vendor waiting on a decision has
 * nothing to do, and a list of future chores would read as one.
 */
function Overview({
  request: r,
  busy,
  onOpen,
  onPick,
}: {
  request: PublicRequestStatus;
  busy: string | null;
  onOpen(step: 'BANK_FORM' | 'FSSAI'): Promise<void>;
  onPick(tab: PortalTab): void;
}) {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <p style={{ fontSize: 13.5, margin: 0, lineHeight: 1.6 }}>{STATUS_COPY[r.status]}</p>
      {r.status === 'SELECTED' &&
        (r.pending.length > 0 ? (
          <Panel>
            <PanelTitle icon='clock'>Still to do</PanelTitle>
            <div style={{ display: 'grid', width: '100%' }}>
              {r.pending.map((p) => (
                <StepRow key={p.step} step={p} busy={busy} onOpen={onOpen} onPick={onPick} />
              ))}
            </div>
          </Panel>
        ) : (
          <p style={{ fontSize: 12.5, color: 'var(--mfg)', margin: 0, lineHeight: 1.6 }}>
            Nothing is outstanding on this request.
          </p>
        ))}
    </div>
  );
}

function StepRow({
  step,
  busy,
  onOpen,
  onPick,
}: {
  step: PendingStep;
  busy: string | null;
  onOpen(step: 'BANK_FORM' | 'FSSAI'): Promise<void>;
  onPick(tab: PortalTab): void;
}) {
  const mobile = useIsMobile();
  // Narrowed once, outside the closure — a type guard on `step.step` does not
  // survive into the click handler.
  const self = isSelfServe(step.step) ? step.step : null;
  const action = self ? (
    <Btn kind='primary' onClick={() => void onOpen(self)} disabled={busy !== null}>
      {busy === step.step ? 'Opening…' : 'Open the Form'}
      <Icon name='chevron-right' size={14} />
    </Btn>
  ) : step.step === 'PAYMENT' ? (
    <Btn onClick={() => onPick('payment')}>
      See Payment
      <Icon name='chevron-right' size={14} />
    </Btn>
  ) : (
    <Btn onClick={() => onPick('staff')}>
      Go to Staff
      <Icon name='chevron-right' size={14} />
    </Btn>
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: mobile ? 'column' : 'row',
        alignItems: mobile ? 'stretch' : 'center',
        gap: 10,
        width: '100%',
        padding: '10px 0',
        borderBottom: '1px solid var(--bd)',
      }}
    >
      <Tag tone='warn' size='sm'>
        <Icon name='clock' size={12} /> {step.label}
      </Tag>
      <span style={{ flex: 1 }} />
      {action}
    </div>
  );
}

/**
 * A self-serve step's own tab: what the form is for, and the way in.
 *
 * ⚠️ Present only while the step is in `pending` — see `portalTabs` — so `step`
 * is defined whenever this renders; the guard is for the moment between a
 * re-read and the strip catching up.
 */
function StepTab({
  step,
  busy,
  onOpen,
  children,
}: {
  step: PendingStep | undefined;
  busy: boolean;
  onOpen(): void;
  children: ReactNode;
}) {
  if (!step) return null;
  return (
    <div style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
      <Tag tone='warn' size='sm'>
        <Icon name='clock' size={12} /> {step.label}
      </Tag>
      <Panel>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, maxWidth: 620 }}>{children}</p>
        <div style={{ marginTop: 4 }}>
          <Btn kind='primary' onClick={onOpen} disabled={busy}>
            {busy ? 'Opening…' : 'Open the Form'}
            <Icon name='chevron-right' size={14} />
          </Btn>
        </div>
      </Panel>
    </div>
  );
}
