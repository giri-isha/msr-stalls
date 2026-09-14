import { type ElectricalRow, ZONE_CODES } from '@msr/stalls';
import { useMemo, useState } from 'react';
import * as api from '../api';
import { TextInput } from '../components/FormControls';
import { Mono } from '../components/Grid';
import { useLoad } from '../hooks';
import { useMe } from '../me';
import { useToast } from '../ui/components/Toast';
import { Icon } from '../ui/icons';
import { Btn, Card, Empty, ErrorBox, H1, Loading, Toolbar, toolBtnStyle } from '../ui/ui';

/** Requirement 9: the stall layout and electrical load, per zone, in a shape
 *  the venue and electrical teams can print on A4 — the 2025 "Electrical data
 *  Stall_bay wise" sheet, generated rather than typed. */
export function Electrical() {
  const { can } = useMe();
  const toast = useToast();
  const [zone, setZone] = useState<string>('A4');
  const rows = useLoad(() => api.electricalRows(zone || undefined), [zone]);
  const [editing, setEditing] = useState<string | null>(null);
  const [cluster, setCluster] = useState('');
  const canEdit = can('planning:write');

  const data = rows.data ?? [];
  const byCluster = useMemo(() => {
    const m = new Map<string, ElectricalRow[]>();
    for (const r of data) {
      const k = r.cluster ?? '—';
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()].sort(([a], [b]) => (a === '—' ? 1 : b === '—' ? -1 : a.localeCompare(b)));
  }, [data]);
  const totals = {
    stalls: data.length,
    occupied: data.filter((r) => r.stallName).length,
    p5: data.reduce((n, r) => n + r.plugs5a, 0),
    p15: data.reduce((n, r) => n + r.plugs15a, 0),
    gas: data.reduce((n, r) => n + r.gasStoves, 0),
    watts: data.reduce((n, r) => n + r.totalWatts, 0),
  };

  const saveCluster = async (stallNumber: string) => {
    try {
      await api.setCluster(stallNumber, cluster.trim() || null);
      toast.ok(`${stallNumber} → cluster ${cluster.trim() || '—'}`);
      setEditing(null);
      rows.reload();
    } catch (e) {
      toast.fail(e);
    }
  };

  const cellHead: React.CSSProperties = { padding: '8px 10px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--rail-fg)', background: 'var(--rail)', borderBottom: '1px solid var(--line)' };
  const cell: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid var(--line)', fontSize: 12.5, verticalAlign: 'top' };
  const num: React.CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

  return (
    <div>
      <div className='msrs-noprint'>
        <H1
          icon={<Icon name='layers' size={20} />}
          sub='Per zone: every stall, who is in it, plug points, gas stoves and appliance load. Group stalls into electrical clusters for the panel layout.'
          actions={
            <Btn onClick={() => window.print()}>
              <Icon name='download' size={14} /> Print A4
            </Btn>
          }
        >
          Electrical &amp; Venue
        </H1>
        <Toolbar>
          <button type='button' onClick={() => setZone('')} aria-pressed={zone === ''} style={toolBtnStyle(zone === '')}>
            All zones
          </button>
          {ZONE_CODES.map((z) => (
            <button type='button' key={z} onClick={() => setZone(z)} aria-pressed={zone === z} style={toolBtnStyle(zone === z)}>
              {z}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12.5, color: 'var(--mfg)' }}>
            {totals.occupied}/{totals.stalls} occupied · {totals.p5} × 5 A · {totals.p15} × 15 A · {totals.gas} gas · {totals.watts.toLocaleString('en-IN')} W
          </span>
        </Toolbar>
      </div>

      <div style={{ display: 'none' }} className='msrs-print-title'>
        MSR Stalls — Electrical sheet {zone || 'all zones'}
      </div>

      {rows.loading && !rows.data ? (
        <Loading />
      ) : rows.error ? (
        <ErrorBox>{rows.error.message}</ErrorBox>
      ) : data.length === 0 ? (
        <Card>
          <Empty>No stalls in this zone yet. Apply a plan under Planning &amp; Zones.</Empty>
        </Card>
      ) : (
        byCluster.map(([k, list]) => (
          <Card key={k} pad={0} style={{ overflow: 'hidden', marginBottom: 14, breakInside: 'avoid' }}>
            <div style={{ padding: '10px 14px', fontWeight: 700, fontSize: 13, borderBottom: '1px solid var(--line)', display: 'flex', gap: 10, alignItems: 'baseline' }}>
              {zone || 'All zones'} {k !== '—' ? `· Cluster ${k}` : '· No cluster'}
              <span style={{ fontSize: 11.5, color: 'var(--mfg)', fontWeight: 500 }}>
                {list.length} stall{list.length > 1 ? 's' : ''} · {list.reduce((n, r) => n + r.totalWatts, 0).toLocaleString('en-IN')} W
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                <thead>
                  <tr>
                    <th style={cellHead}>Stall no</th>
                    <th style={cellHead}>Stall name</th>
                    <th style={cellHead}>Category</th>
                    <th style={{ ...cellHead, textAlign: 'right' }}>5 A (incl. 1)</th>
                    <th style={{ ...cellHead, textAlign: 'right' }}>15 A</th>
                    <th style={{ ...cellHead, textAlign: 'right' }}>Gas</th>
                    <th style={cellHead}>Appliances and wattage</th>
                    <th style={{ ...cellHead, textAlign: 'right' }}>Total W</th>
                    {canEdit && <th style={cellHead} className='msrs-noprint'>Cluster</th>}
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.stallNumber}>
                      <td style={cell}>
                        <b>
                          <Mono>{r.stallNumber}</Mono>
                        </b>
                      </td>
                      <td style={cell}>
                        {r.stallName ?? <span style={{ color: 'var(--mfg)' }}>— empty —</span>}
                        {r.reference && <div style={{ fontSize: 11, color: 'var(--mfg)' }}>{r.reference}</div>}
                      </td>
                      <td style={{ ...cell, color: 'var(--mfg)' }}>{r.category.replace(/_/g, ' ').toLowerCase()}</td>
                      <td style={num}>{r.stallName ? Math.max(1, r.plugs5a) : ''}</td>
                      <td style={num}>{r.stallName ? r.plugs15a : ''}</td>
                      <td style={num}>{r.stallName ? r.gasStoves : ''}</td>
                      <td style={cell}>{r.appliances.map((a) => `${a.name} ${a.watts}W`).join(', ')}</td>
                      <td style={{ ...num, fontWeight: 600 }}>{r.totalWatts ? r.totalWatts.toLocaleString('en-IN') : ''}</td>
                      {canEdit && (
                        <td style={cell} className='msrs-noprint'>
                          {editing === r.stallNumber ? (
                            <span style={{ display: 'flex', gap: 6 }}>
                              <TextInput aria-label={`${r.stallNumber} cluster`} value={cluster} onChange={(e) => setCluster(e.target.value)} style={{ width: 70, padding: '4px 8px' }} autoFocus onKeyDown={(e) => e.key === 'Enter' && saveCluster(r.stallNumber)} />
                              <Btn onClick={() => saveCluster(r.stallNumber)}>Save</Btn>
                            </span>
                          ) : (
                            <button
                              type='button'
                              onClick={() => {
                                setEditing(r.stallNumber);
                                setCluster(r.cluster ?? '');
                              }}
                              style={{ border: '1px dashed var(--bd)', background: 'none', borderRadius: 'var(--r)', padding: '2px 8px', cursor: 'pointer', fontSize: 12, color: r.cluster ? 'var(--fg)' : 'var(--mfg)' }}
                            >
                              {r.cluster ?? 'set'}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
