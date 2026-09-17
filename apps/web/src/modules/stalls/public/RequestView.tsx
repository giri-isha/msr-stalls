import {
  type GatedStep,
  type PublicBankDetails,
  type PublicFssaiDetails,
  type PublicRequestStatus,
  isSelfServe,
} from '@stalls/core';
import { type ReactNode, useState } from 'react';
import { useSearchParams } from 'react-router';
import { TYPE_LABEL } from '../components/StatusPill';
import { formatDate } from '../hooks';
import { Btn, Card, Icon, Tabs, type TabDef, Tag, useIsMobile, useToast } from '../ui';
import { PaymentTab } from './PaymentTab';
import { StaffTab } from './StaffTab';
import { SubmittedTab } from './SubmittedTab';
import { Panel, PanelTitle, Row } from './portal-ui';

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
 * The request is the page now: a header band names it, a rail of sections runs
 * down its left, and each section has the room to lay its figures out.
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

/**
 * What a request SAYS to the person who filed it.
 *
 * 🔴 Three of the six statuses say the same sentence, and that is the point.
 * SUBMITTED, SHORTLISTED and BACKUP are the team's working notes on a decision
 * it has not taken — a shortlisting is not a promise and a backup place is not
 * a refusal — and a requester reading "Shortlisted" on their own page hears one
 * or the other. Until a request is SELECTED there is nothing for them to do and
 * nothing they can act on, so there is one thing to say.
 *
 * ⚠️ REJECTED and CANCELLED still say so. A decision not to take somebody is a
 * decision they are owed: a requester never told simply waits, and finds out by
 * ringing the team the week of the event.
 *
 * ⚠️ There is no status PILL anywhere on this page — see `RequestPanel`. This
 * is the only place a requester is told anything about where their request
 * stands, which is what keeps the working notes off it.
 */
const PENDING_COPY =
  'Thanks for expressing interest. We have received your request — our team will check and get ' +
  'back to you.';

const STATUS_COPY: Record<string, string> = {
  SUBMITTED: PENDING_COPY,
  SHORTLISTED: PENDING_COPY,
  BACKUP: PENDING_COPY,
  // 🔴 This used to end "Further instructions will follow by email", which was
  // both the plan and the problem: it pointed at an inbox as the only way
  // forward. What happens next is the list underneath, which they can act on.
  SELECTED: 'Selected. Anything still outstanding is listed below.',
  REJECTED: 'Not selected this year.',
  CANCELLED: 'Cancelled.',
};

/**
 * Which tabs a request has, read off what the API sent.
 *
 * ⚠️ A step tab is present while the API says the step is outstanding, or has
 * sent what the requester submitted for it.
 *
 * 🔴 Bank details and FSSAI used to VANISH once done, and that was this page
 * reading "not outstanding" as "nothing to say". It covered two different
 * facts — you have sent it, and we never asked you — and for the first of them
 * a vendor who wanted to check which account their deposit would be refunded
 * to, or whether the certificate had actually gone through, had the same one
 * place to look as before any of this: the form they no longer had. The API
 * now sends the answers back, so the tab stays with a green mark and reads
 * them out. A step never asked still has no tab, because there is still
 * nothing to say.
 *
 * 🔴 And only while the step is OPEN. An edition may open its steps in an
 * order, and a step the ordering has not reached yet gets no tab at all — a
 * door that is not yet a door. It is not hidden from the requester: it sits on
 * the Overview's Still to do list, greyed, saying what opens it. The Overview
 * is the road; the tabs are the doors that are actually unlocked.
 *
 * ⚠️ `open` is read off the API like everything else here. `gatedSteps` decides
 * it, the same function the form mint, the coupon route and the letters obey,
 * so a tab can never offer a step those would refuse.
 *
 * The marks are facts, not opinions: amber is "in `pending`"; green on Staff
 * is "somebody is registered", green on Payment is "a transfer was confirmed".
 */
export function portalTabs(r: PublicRequestStatus): Array<TabDef & { key: PortalTab }> {
  // ⚠️ `p.open !== false`, not `p.open`. The API and the web deploy separately,
  // and a page served ahead of an API that does not send the field must keep
  // showing the tabs it always showed.
  const pending = new Set(r.pending.filter((p) => p.open !== false).map((p) => p.step));
  const claims = r.paymentClaims ?? [];
  const tabs: Array<TabDef & { key: PortalTab }> = [
    { key: 'overview', label: 'Overview', glyph: 'layout-grid', short: 'Overview' },
  ];
  if (pending.has('BANK_FORM') || r.bank) {
    tabs.push({
      key: 'bank',
      label: 'Bank Details',
      short: 'Bank',
      glyph: 'file-text',
      // The marks are facts: amber is "we are waiting on this", green is "we
      // have it". Not a claim that the details are correct — that is what the
      // read-back under the tab is for.
      ...marked(pending.has('BANK_FORM') ? 'warn' : 'ok'),
    });
  }
  if (r.payment || pending.has('PAYMENT') || claims.length > 0) {
    tabs.push({
      key: 'payment',
      label: 'Payment',
      short: 'Payment',
      glyph: 'rupee',
      ...marked(
        pending.has('PAYMENT')
          ? 'warn'
          : claims.some((c) => c.status === 'VERIFIED')
            ? 'ok'
            : undefined,
      ),
    });
  }
  if (pending.has('FSSAI') || r.fssai) {
    tabs.push({
      key: 'fssai',
      label: 'FSSAI',
      short: 'FSSAI',
      glyph: 'shield',
      ...marked(pending.has('FSSAI') ? 'warn' : 'ok'),
    });
  }
  // ⚠️ `open !== false`, for the deploy-skew reason above — but the field is
  // why this tab reads it rather than `pending`. STAFF_REGISTRATION is not in
  // `pending` until a coupon has been issued, so this tab drew itself for a
  // step the edition's ordering had not reached, and its Get Your Coupon
  // button minted nothing: the coupon route refuses a locked step. A door that
  // is not yet a door, again — hidden here, and named on the Overview's Still
  // to do list as soon as there is a coupon for the pending list to see.
  if (r.staff && r.staff.open !== false) {
    tabs.push({
      key: 'staff',
      label: 'Staff',
      short: 'Staff',
      glyph: 'users',
      ...marked(
        pending.has('STAFF_REGISTRATION') ? 'warn' : r.staff.registered > 0 ? 'ok' : undefined,
      ),
    });
  }
  // ⚠️ `undefined` is tolerated, not just empty. The API and the web deploy
  // separately, and a page served ahead of the API must still show the status.
  if ((r.submitted ?? []).length > 0) {
    // ⚠️ "Request Form Details", not "What You Submitted". Every other tab on
    // this strip is named for the thing it holds — Bank Details, Payment,
    // Staff — and a tab named for an event the reader took part in reads as a
    // receipt for the act rather than as the answers, which is what they have
    // come back to look up.
    tabs.push({
      key: 'submitted',
      label: 'Request Form Details',
      short: 'Form',
      glyph: 'clipboard-list',
    });
  }
  return tabs;
}

/** The mark and its word together, so the rail never says "Due" in green. The
 *  word is what the rail draws; the dot is what the phone's bar draws. */
function marked(mark: 'warn' | 'ok' | undefined): Pick<TabDef, 'mark' | 'note'> {
  if (!mark) return {};
  return { mark, note: mark === 'warn' ? 'Due' : 'Done' };
}

export function RequestView({ requests, openStep, getCoupon, reload }: RequestViewProps) {
  const mobile = useIsMobile();
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
    // ⚠️ `minmax(0, 1fr)`, not a bare grid. A grid item's minimum width is its
    // content's, so the tab strip — which scrolls sideways on a phone rather
    // than wrapping — would otherwise widen the card past the screen instead
    // of scrolling inside it.
    <div
      style={{
        display: 'grid',
        // 🔴 A LIST down the left where there is more than one request, and
        // the chosen one beside it — the way a mailbox draws its messages.
        // The row of pills above the card made a second request look like a
        // filter on the first; a column of small cards makes it what it is,
        // another document. On a phone the column would cost the whole
        // screen, so the pills come back there.
        gridTemplateColumns:
          requests.length > 1 && !mobile ? '232px minmax(0, 1fr)' : 'minmax(0, 1fr)',
        gap: 14,
        alignItems: 'start',
      }}
    >
      {requests.length > 1 && (
        <Switcher requests={requests} current={current.reference} onPick={pick} list={!mobile} />
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

/**
 * The requests to choose between, drawn only when there is more than one.
 *
 * `list` is the desktop column of small cards; without it, the phone's row of
 * pills. Same control, same names, same `aria-pressed` — only the shape.
 *
 * ⚠️ The card's third line says how far the request has got — waiting, N
 * steps left, all in — and NOT which stall it was given. The stall number is
 * the fact a vendor comes back for, and it belongs on the request's own band
 * once they have opened it, not on every card in the margin.
 */
function Switcher({
  requests,
  current,
  onPick,
  list,
}: {
  requests: PublicRequestStatus[];
  current: string;
  onPick(reference: string): void;
  list: boolean;
}) {
  return (
    <fieldset
      aria-label='Your Requests'
      style={{
        display: list ? 'grid' : 'flex',
        gap: 6,
        flexWrap: 'wrap',
        alignContent: 'start',
        margin: 0,
        padding: 0,
        border: 0,
        minWidth: 0,
        // Follows the request down, like the rail inside it does.
        ...(list ? { position: 'sticky', top: 72 } : {}),
      }}
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
              display: list ? 'grid' : 'inline-flex',
              alignItems: 'center',
              gap: list ? 2 : 8,
              justifyItems: 'start',
              textAlign: 'left',
              padding: list ? '10px 12px' : '7px 12px',
              borderRadius: 'var(--r2)',
              border: `1px solid ${on ? 'var(--pri)' : 'var(--bd)'}`,
              background: on ? 'var(--pri-t)' : 'var(--card)',
              color: on ? 'var(--pri)' : 'var(--fg)',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
              minWidth: 0,
              width: list ? '100%' : undefined,
            }}
          >
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {r.stallName}
            </span>
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
            {list && (
              <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--mfg)' }}>
                {progressOf(r)}
              </span>
            )}
          </button>
        );
      })}
    </fieldset>
  );
}

/** One line on how far a request has got, in the requester's words and with
 *  no more than the Overview tells them: the working statuses stay "waiting". */
function progressOf(r: PublicRequestStatus): string {
  if (r.status === 'REJECTED') return 'Not selected';
  if (r.status === 'CANCELLED') return 'Cancelled';
  if (r.status !== 'SELECTED') return 'Waiting on a decision';
  const open = r.pending.filter((p) => p.open !== false).length;
  if (open === 0) return r.pending.length === 0 ? 'Nothing outstanding' : 'Next step opens later';
  return `${open} step${open === 1 ? '' : 's'} to do`;
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
          // Centred, not `flex-start`: the chip is one line against a
          // three-line block, and pinned to the top it read as a label on the
          // reference above it rather than as a fact about the request.
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          // 🔴 A thin line, not a band. The tinted plate under the name made
          // the header the heaviest thing on the card; a hairline under a name
          // set in the display face says the same with nothing to compete
          // against the figures below it.
          padding: mobile ? '14px 16px' : '16px 22px',
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
        {/* 🔴 No status pill. It read SHORTLISTED and BACKUP out to the person
            who filed the request, and those are the team's working notes on a
            decision it has not taken — a shortlisting is not a promise, a
            backup place is not a refusal, and a pill has no room to say which.
            What the requester is told is the sentence on the Overview, and it
            is the same sentence for every state before a selection. The
            backoffice keeps its pill: `StatusPill` is still what the request
            list and the detail screen draw. */}
      </header>

      {/* 🔴 A RAIL down the left, where this was a strip across the top. The
          sections are not equals competing for a glance — Overview is where a
          requester lands and the rest are places they are sent — and a strip
          drew five of them in a line whose only job was to be scanned once and
          then sat above a body that had already scrolled it off the screen. A
          rail keeps the whole list in view while a long Payment section is
          read, gives each section a full line to be named on rather than a
          label squeezed between its neighbours, and puts the marks in a column
          so "what is still outstanding" is one downward glance.

          ⚠️ Only above 720px. On a phone a 216px rail is half the screen, so
          the strip goes back across the top and scrolls sideways — which is
          the same component, turned. */}
      <div
        style={{
          display: 'grid',
          // ⚠️ `minmax(0, 1fr)` on the body column, not `1fr`. A grid item's
          // minimum width is its content's, so the payment breakdown's long
          // account numbers would widen the card past the screen.
          gridTemplateColumns: mobile ? 'minmax(0, 1fr)' : '216px minmax(0, 1fr)',
          alignItems: 'stretch',
          // So a section with one short panel in it still reads as a page with
          // a rail, rather than as a rail-shaped stub.
          minHeight: mobile ? undefined : 340,
        }}
      >
        {mobile ? (
          // 🔴 A BAR ALONG THE BOTTOM of the screen, where this was a strip
          // across the top of the card. The strip scrolled away with the card
          // and, six sections wide, scrolled sideways too; a fixed bar is
          // always there and always under the thumb. Same tablist, turned into
          // glyphs over short names.
          <nav
            aria-label='Request Sections'
            style={{
              position: 'fixed',
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 20,
              background: 'var(--card)',
              borderTop: '1px solid var(--bd)',
              padding: '2px 4px',
              paddingBottom: 'calc(2px + env(safe-area-inset-bottom, 0px))',
            }}
          >
            <Tabs
              variant='bar'
              label='Request Sections'
              tabs={tabs}
              active={tab}
              onPick={(k) => setActive(k as PortalTab)}
            />
          </nav>
        ) : (
          <nav
            style={{
              borderRight: '1px solid var(--line)',
              padding: '14px 10px',
              minWidth: 0,
            }}
          >
            <Tabs
              orientation='vertical'
              label='Request Sections'
              tabs={tabs}
              active={tab}
              onPick={(k) => setActive(k as PortalTab)}
              // Follows a long section down. The offset clears the shell's own
              // sticky header, which is the only thing above it.
              style={{ position: 'sticky', top: 72 }}
            />
          </nav>
        )}

        <div style={{ padding: mobile ? '14px 16px 18px' : '18px 22px 24px', minWidth: 0 }}>
          {tab === 'overview' && (
            <Overview request={r} busy={busy} onOpen={open} onPick={setActive} />
          )}
          {/* ⚠️ Outstanding wins over submitted. A vendor asked to redo this —
            the step reopened — must be given the form, not a read-back of the
            details that are being replaced. */}
          {tab === 'bank' &&
            (r.pending.some((p) => p.step === 'BANK_FORM') || !r.bank ? (
              <StepTab
                step={r.pending.find((p) => p.step === 'BANK_FORM')}
                busy={busy === 'BANK_FORM'}
                onOpen={() => void open('BANK_FORM')}
              >
                Your bank details, GST number and the name to invoice, so Finance can raise the
                invoice and return your deposit to the right account after the event. Only vendors
                are asked for this.
              </StepTab>
            ) : (
              <BankDone bank={r.bank} />
            ))}
          {tab === 'payment' && <PaymentTab request={r} reload={reload} />}
          {tab === 'fssai' &&
            (r.pending.some((p) => p.step === 'FSSAI') || !r.fssai ? (
              <StepTab
                step={r.pending.find((p) => p.step === 'FSSAI')}
                busy={busy === 'FSSAI'}
                onOpen={() => void open('FSSAI')}
              >
                A stall selling food needs its FSSAI certificate on file before check-in. Upload a
                photo or scan of it — up to five pages, if it was photographed a page at a time.
              </StepTab>
            ) : (
              <FssaiDone fssai={r.fssai} />
            ))}
          {tab === 'staff' && <StaffTab request={r} getCoupon={getCoupon} />}
          {tab === 'submitted' && <SubmittedTab sections={r.submitted ?? []} />}
        </div>
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
      {/* Capped rather than run to the width of the card. The status sentence
          is prose, and prose set across 1,600px of screen is read twice. */}
      <p style={{ fontSize: 13.5, margin: 0, lineHeight: 1.6, maxWidth: 680 }}>
        {STATUS_COPY[r.status]}
      </p>
      {r.status === 'SELECTED' &&
        (r.pending.length > 0 ? (
          <Panel>
            <PanelTitle icon='clock'>Still to do</PanelTitle>
            {/* 🔴 A GRID of plates, where this was a stack of full-width rows.
                Each row put its label hard left and its button hard right, so
                on a laptop a single outstanding step was a tag and a button
                with two feet of nothing between them — and the four steps read
                as a table with no columns. A step is a card: what it is, what
                it wants, and the way in, in that order and in one place. */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill,minmax(248px,1fr))',
                gap: 10,
                width: '100%',
              }}
            >
              {r.pending.map((p) => (
                <StepCard key={p.step} step={p} busy={busy} onOpen={onOpen} onPick={onPick} />
              ))}
            </div>
          </Panel>
        ) : (
          <Panel>
            <PanelTitle icon='circle-check'>Nothing outstanding</PanelTitle>
            <p style={{ fontSize: 12.5, color: 'var(--mfg)', margin: 0, lineHeight: 1.6 }}>
              Everything we have asked you for on this request is in. The sections listed beside
              this one are where to check any of it.
            </p>
          </Panel>
        ))}
    </div>
  );
}

/** What a locked step is waiting for, in the requester's words.
 *
 *  ⚠️ Built from `blockedBy`, which the API fills from the same `gatedSteps`
 *  that decided the lock. Naming the steps rather than saying "not yet" is the
 *  difference between a requester who waits and one who writes in asking why a
 *  form has disappeared. */
function opensAfter(step: GatedStep): string {
  const names = (step.blockedBy ?? []).map((s) => STEP_NAME[s] ?? s);
  if (names.length === 0) return 'Opens later';
  return `Opens once ${names.join(' and ')} is done`;
}

const STEP_NAME: Record<string, string> = {
  BANK_FORM: 'your bank details',
  PAYMENT: 'your payment',
  FSSAI: 'your FSSAI certificate',
  STAFF_REGISTRATION: 'staff registration',
};

/** What each step actually wants, in a line.
 *
 *  ⚠️ The label above it comes from the API (`GatedStep.label`) and names the
 *  step; this says what doing it involves. A plate with a name and a button and
 *  nothing between them makes a vendor click to find out what they are being
 *  asked for. */
const STEP_HINT: Record<string, string> = {
  BANK_FORM: 'Your bank account, GST number and final stall requirements.',
  PAYMENT: 'The rent and the refundable deposit, and the accounts to pay them into.',
  FSSAI: 'A photo or scan of your FSSAI certificate.',
  STAFF_REGISTRATION: 'Everyone who will be at your stall has to be registered.',
};

/** One outstanding step, as a plate: what it is, what it wants, the way in. */
function StepCard({
  step,
  busy,
  onOpen,
  onPick,
}: {
  step: GatedStep;
  busy: string | null;
  onOpen(step: 'BANK_FORM' | 'FSSAI'): Promise<void>;
  onPick(tab: PortalTab): void;
}) {
  // 🔴 A step the edition's ordering has not reached. It keeps its place in the
  // list — the requester should be able to read the whole road — but it offers
  // no way in, because there is none: the form mint, the coupon route and the
  // staff registration page would all refuse it.
  const locked = step.open === false;
  // Narrowed once, outside the closure — a type guard on `step.step` does not
  // survive into the click handler.
  const self = isSelfServe(step.step) ? step.step : null;
  const action = locked ? null : self ? (
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
        display: 'grid',
        gap: 8,
        alignContent: 'start',
        justifyItems: 'start',
        padding: '12px 13px',
        borderRadius: 'var(--r2)',
        // On the card colour, against the panel's muted plate — so the steps
        // read as items ON the list rather than as divisions of it.
        background: 'var(--card)',
        border: '1px solid var(--bd)',
      }}
    >
      <Tag tone={locked ? 'neutral' : 'warn'} size='sm'>
        <Icon name={locked ? 'lock' : 'clock'} size={12} /> {step.label}
      </Tag>
      {/* A locked step says what opens it, where an open one says what it
          wants. Both are the same line in the same place. */}
      <p style={{ margin: 0, fontSize: 12, color: 'var(--mfg)', lineHeight: 1.55 }}>
        {locked ? opensAfter(step) : (STEP_HINT[step.step] ?? '')}
      </p>
      {action}
    </div>
  );
}

/**
 * The bank details we hold, read back to the vendor who sent them.
 *
 * 🔴 This is the answer to "what happened to it". A step that was done left no
 * trace on this page: the tab disappeared, and a vendor checking which account
 * their deposit would come back to had only the form they no longer had. The
 * questions they actually come back with are all here — is that the right
 * account, did the IFSC go in correctly, did the GST number reach you.
 *
 * ⚠️ The account number and the PAN arrive masked from the API, and are
 * rendered as they arrive. The last four is what a person checks their own
 * account against; this page is reached by a link that sits in an inbox for a
 * year and gets forwarded, which is a poor place to keep the other ten digits.
 *
 * ⚠️ Rows with nothing in them are DROPPED, not drawn empty. Which questions
 * the form asks is the edition's to decide, and a blank beside "GST number"
 * reads as something missing rather than something never asked.
 */
function BankDone({ bank }: { bank: PublicBankDetails }) {
  const rows: Array<[string, string | null]> = [
    ['Account holder', bank.accountHolder],
    ['Account number', bank.accountNumberMasked],
    ['IFSC', bank.ifsc],
    ['Bank', bank.bankName],
    ['Branch', bank.branch],
    ['Invoice to', bank.invoiceName],
    ['GST number', bank.gstNumber],
    ['PAN', bank.panMasked],
  ];
  return (
    <div style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
      <Tag tone='ok' size='sm'>
        <Icon name='circle-check' size={12} /> Received {formatDate(bank.submittedAt)}
      </Tag>
      <Panel>
        <PanelTitle icon='file-text'>What we have on file</PanelTitle>
        {rows.map(([k, v]) => (v ? <Row key={k} k={k} v={v} /> : null))}
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--mfg)', lineHeight: 1.6 }}>
          Your account number and PAN are shown in part only. If anything here is wrong, please tell
          the stall team — this is the account your refundable deposit is returned to.
        </p>
      </Panel>
    </div>
  );
}

/**
 * The FSSAI certificate on file, read back.
 *
 * ⚠️ Two different states, and the difference matters to the reader: received,
 * and verified by the team. A vendor whose certificate is uploaded but not yet
 * checked has nothing to do and nothing to worry about, which is worth saying
 * rather than leaving them to guess from a tick.
 *
 * ⚠️ File NAMES, not links. The uploads are served from a private store the
 * backoffice reads through its own authorisation; a link here would make a
 * read-back into a second door onto it.
 */
function FssaiDone({ fssai }: { fssai: PublicFssaiDetails }) {
  return (
    <div style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
      <Tag tone='ok' size='sm'>
        <Icon name='circle-check' size={12} />{' '}
        {fssai.verified ? 'Verified' : `Received ${formatDate(fssai.submittedAt)}`}
      </Tag>
      <Panel>
        <PanelTitle icon='shield'>Your certificate</PanelTitle>
        {fssai.ownerName && <Row k='Licence holder' v={fssai.ownerName} />}
        {fssai.mobile && <Row k='Mobile' v={fssai.mobile} />}
        <Row k='Uploaded' v={formatDate(fssai.submittedAt)} />
        {fssai.files.length > 0 && (
          <Row
            k={fssai.files.length > 1 ? 'Pages' : 'File'}
            v={
              <span style={{ display: 'grid', gap: 2 }}>
                {fssai.files.map((f) => (
                  <span key={f.fileName}>{f.fileName}</span>
                ))}
              </span>
            }
          />
        )}
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--mfg)', lineHeight: 1.6 }}>
          {fssai.verified
            ? 'The stall team has checked your certificate. Nothing further is needed.'
            : 'We have your certificate. The stall team will check it before the event — there is nothing for you to do.'}
        </p>
      </Panel>
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
  step: GatedStep | undefined;
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
