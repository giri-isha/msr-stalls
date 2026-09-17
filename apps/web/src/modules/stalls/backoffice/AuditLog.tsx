import { AUDIT_ACTIONS, type AuditActorKind, describeAuditAction } from '@stalls/core';
import { Fragment, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { listAudit } from '../api';
import { formatDateTime, useDebounced, useLoad } from '../hooks';
import {
  Btn,
  Card,
  DateField,
  Empty,
  ErrorBox,
  H1,
  Icon,
  Loading,
  Pager,
  Search,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  Tag,
  Toolbar,
  toolBtnStyle,
} from '../ui';
import { Actor, Expanded, hasMore } from './ActivityTimeline';

/**
 * Audit Logs — every write, sign-in and letter in the edition, newest first.
 *
 * ⚠️ Every filter lives in the URL and every filter is applied by the SERVER.
 * The log is the one list in the module expected to run to tens of thousands
 * of rows, so nothing here narrows a list already held: the page on screen is
 * the page the API returned, and a link to a filtered view is a working link.
 *
 * The rows are read-only by construction — there is no route that edits or
 * deletes one — and this screen offers nothing that pretends otherwise.
 */

const KINDS: Array<[AuditActorKind | '', string]> = [
  ['', 'All'],
  ['BACKOFFICE', 'Backoffice'],
  ['REQUESTER', 'Requesters'],
  ['SYSTEM', 'System'],
];

const CHANNEL_LABEL: Record<string, string> = {
  BACKOFFICE: 'Ui',
  PORTAL: 'Portal',
  SYSTEM: 'System',
};

const PAGE_SIZE = 50;

export function AuditLog() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const action = params.get('action') ?? '';
  const actorKind = (params.get('actorKind') ?? '') as AuditActorKind | '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const page = Number(params.get('page') ?? 0) || 0;
  const settledQ = useDebounced(q);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    // A changed filter starts from the first page. A stale page number over a
    // narrower list is an empty screen under a pager saying "page 7 of 2".
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const { data, error, loading, reload } = useLoad(
    () =>
      listAudit({
        q: settledQ || undefined,
        action: action || undefined,
        actorKind: actorKind || undefined,
        from: from || undefined,
        to: to || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    [settledQ, action, actorKind, from, to, page],
  );
  const [open, setOpen] = useState<string | null>(null);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <H1
        icon={<Icon name='scroll' size={18} />}
        sub='Every action in this edition — sign-ins, form submissions, status changes, letters and more.'
        actions={
          <Btn onClick={reload} disabled={loading}>
            <Icon name='refresh' size={14} />
            Refresh
          </Btn>
        }
      >
        Audit Logs
      </H1>

      <Toolbar>
        <Search
          value={q}
          onChange={(v) => setParam('q', v)}
          placeholder='Search by name, reference or event…'
        />
        <select
          aria-label='Event Type'
          value={action}
          onChange={(e) => setParam('action', e.target.value)}
          style={{ ...toolBtnStyle(!!action), minWidth: 190 }}
        >
          <option value=''>All Events</option>
          {AUDIT_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {describeAuditAction(a).label}
            </option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 4 }} role='group' aria-label='Actor'>
          {KINDS.map(([value, label]) => (
            <button
              key={value || 'all'}
              type='button'
              style={toolBtnStyle(actorKind === value)}
              onClick={() => setParam('actorKind', value)}
            >
              {label}
            </button>
          ))}
        </div>
        <DateField label='From' value={from} onChange={(v) => setParam('from', v)} compact />
        <DateField label='To' value={to} onChange={(v) => setParam('to', v)} compact />
      </Toolbar>

      {loading && !data && <Loading />}
      {error && <ErrorBox>{error.message}</ErrorBox>}

      {data && (
        <Card pad={0}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 8,
              padding: '10px 14px',
              borderBottom: '1px solid var(--line)',
              fontSize: 12.5,
              color: 'var(--mfg)',
            }}
          >
            <span>
              {total.toLocaleString('en-IN')} event{total === 1 ? '' : 's'}
            </span>
            <Pager
              page={page}
              pages={pages}
              total={total}
              size={PAGE_SIZE}
              noun='event'
              onPage={(p) => setParam('page', String(p))}
            />
          </div>
          {items.length === 0 ? (
            <Empty>Nothing matches these filters.</Empty>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Timestamp</TH>
                  <TH>Event</TH>
                  <TH>User</TH>
                  <TH>Entity</TH>
                  <TH>Channel</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {items.map((e) => {
                  const shown = open === e.id;
                  return (
                    <Fragment key={e.id}>
                      <TR>
                        <TD muted style={{ whiteSpace: 'nowrap' }}>
                          {formatDateTime(e.occurredAt)}
                        </TD>
                        <TD>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              flexWrap: 'wrap',
                            }}
                          >
                            <Tag tone={e.tone} size='sm'>
                              <Icon name={e.glyph} size={11} /> {e.label}
                            </Tag>
                            {e.outcome === 'FAILED' && (
                              <Tag tone='des' size='sm'>
                                Failed
                              </Tag>
                            )}
                          </span>
                        </TD>
                        <TD>
                          <Actor e={e} />
                        </TD>
                        <TD muted>
                          <div style={{ display: 'grid', fontSize: 12 }}>
                            <span>{e.subjectType}</span>
                            {/* The reference links into the request's own
                                timeline, which is the next question a reader
                                of this row asks. */}
                            {e.requestId && e.reference ? (
                              <Link
                                to={`/m/stalls/requests/${e.requestId}?tab=activity`}
                                style={{ color: 'inherit' }}
                              >
                                {e.reference}
                              </Link>
                            ) : (
                              <span style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>
                                {e.subjectRef.slice(0, 8)}
                              </span>
                            )}
                          </div>
                        </TD>
                        <TD>
                          <Tag size='sm'>{CHANNEL_LABEL[e.channel] ?? e.channel}</Tag>
                        </TD>
                        <TD style={{ textAlign: 'right' }}>
                          {hasMore(e) && (
                            <Btn onClick={() => setOpen(shown ? null : e.id)}>
                              <Icon name={shown ? 'chevron-up' : 'chevron-down'} size={12} />
                              {shown ? 'Hide Details' : 'Show Details'}
                            </Btn>
                          )}
                        </TD>
                      </TR>
                      {shown && (
                        <TR>
                          <TD colSpan={6} style={{ background: 'var(--rail)' }}>
                            <div style={{ padding: '6px 2px' }}>
                              <Expanded e={e} />
                            </div>
                          </TD>
                        </TR>
                      )}
                    </Fragment>
                  );
                })}
              </TBody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
