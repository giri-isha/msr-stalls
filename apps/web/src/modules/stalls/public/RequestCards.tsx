import { useState } from 'react';
import { type PendingStep, type PublicStatusResponse, isSelfServe } from '@msr/stalls';
import { StatusPill, TYPE_LABEL } from '../components/StatusPill';
import { formatDate } from '../hooks';
import { Btn, Card, Icon, Tag, useToast } from '../ui';

/**
 * A requester's own requests, drawn the same way whichever credential got them
 * here — the signed link in the receipt email, or the session cookie of
 * somebody logged in.
 *
 * ⚠️ The two pages differ ONLY in `openStep`: one names the request against a
 * token in the URL, the other against the cookie. Everything a requester reads
 * — what the status means, what is outstanding, which step has a button — is
 * here once. When each page drew its own, that was how a vendor could be told
 * they were all set on one screen and be stopped at the counter.
 *
 * ⚠️ Nothing here decides what is outstanding. `pending` arrives from the API,
 * out of the same `pendingSteps` the Onboarding table and the check-in counter
 * read.
 */
export interface RequestCardsProps {
  requests: PublicStatusResponse['requests'];
  /** Mints the link for one self-serve step. Called on the CLICK — see below. */
  openStep(reference: string, step: 'BANK_FORM' | 'FSSAI'): Promise<{ url: string }>;
}

const STATUS_COPY: Record<string, string> = {
  SUBMITTED: 'Received. The stall team will review it.',
  SHORTLISTED: 'Under consideration.',
  SELECTED: 'Selected. Further instructions will follow by email.',
  BACKUP: 'On the backup list — you will be contacted if a stall frees up.',
  REJECTED: 'Not selected this year.',
  CANCELLED: 'Cancelled.',
};

export function RequestCards({ requests, openStep }: RequestCardsProps) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {requests.map((r) => (
        <Card key={r.reference}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, minWidth: 200 }}>
              <div
                style={{
                  fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
                  fontSize: 11.5,
                  color: 'var(--mfg)',
                }}
              >
                {r.reference}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{r.stallName}</div>
              <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 2 }}>
                {TYPE_LABEL[r.requestType] ?? r.requestType} · submitted {formatDate(r.submittedAt)}
              </div>
              <p style={{ fontSize: 13, margin: '10px 0 0', lineHeight: 1.6 }}>
                {STATUS_COPY[r.status]}
              </p>
              {r.allocatedStalls.length > 0 && (
                // The allocation is the one fact on this page a vendor comes
                // back for, so it gets its own plate rather than a line of
                // body text among the rest.
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    marginTop: 10,
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
              <Pending reference={r.reference} steps={r.pending} openStep={openStep} />
            </div>
            <StatusPill status={r.status} />
          </div>
        </Card>
      ))}
    </div>
  );
}

/**
 * What is still outstanding on a selected stall, and the way into the one form
 * the requester can fill themselves.
 *
 * Only BANK_FORM and FSSAI get a button — see `isSelfServe`. Payment is
 * confirmed by Finance against a bank credit and staff register on a coupon the
 * requester forwards to their own team, so a button on either would promise
 * something this page cannot do. Those still SHOW: a requester who can see that
 * the team is waiting on a transfer is the point of the list.
 *
 * The link is minted on the click, not when the page loads. Rendering the list
 * would otherwise mint a bank-form link every time the page was refreshed.
 */
function Pending({
  reference,
  steps,
  openStep,
}: {
  reference: string;
  steps: PendingStep[];
  openStep: RequestCardsProps['openStep'];
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  if (steps.length === 0) return null;

  const open = async (step: 'BANK_FORM' | 'FSSAI') => {
    setBusy(step);
    try {
      const { url } = await openStep(reference, step);
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
    <div style={{ marginTop: 12, display: 'grid', gap: 8, justifyItems: 'start' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mfg)' }}>Still to do</div>
      {steps.map((p) => (
        <div
          key={p.step}
          style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
        >
          <Tag tone='warn' size='sm'>
            <Icon name='clock' size={12} /> {p.label}
          </Tag>
          {isSelfServe(p.step) && (
            <Btn
              kind='primary'
              onClick={() => void open(p.step as 'BANK_FORM' | 'FSSAI')}
              disabled={busy !== null}
            >
              {busy === p.step ? 'Opening…' : 'Open the form'}
              <Icon name='chevron-right' size={14} />
            </Btn>
          )}
        </div>
      ))}
    </div>
  );
}
