import { useNavigate } from 'react-router';
import { getDashboard } from '../api';
import { STATUS_LABEL, TYPE_LABEL } from '../components/StatusPill';
import { useLoad } from '../hooks';
import { Icon } from '../ui/icons';
import { StatTiles } from '../ui/components/StatTiles';
import { Card, ErrorBox, H1, Loading } from '../ui/ui';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--mfg)', margin: '0 0 8px' }}>
        {title}
      </div>
      {children}
    </section>
  );
}

export function Dashboard() {
  const { data, error, loading } = useLoad(getDashboard);
  const navigate = useNavigate();
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox>{error?.message}</ErrorBox>;
  const s = data.byStatus;

  return (
    <div>
      <H1 icon={<Icon name='home' size={20} />} sub='Maha Shivratri · MSR Stalls Program'>
        Dashboard
      </H1>

      <Section title='Requests'>
        <StatTiles
          noun='request'
          tiles={[
            { label: 'All', count: data.total },
            ...(['VENDOR', 'LOCAL_WELFARE', 'ASHRAM', 'ASHRAM_FOOD'] as const).map((t) => ({
              label: TYPE_LABEL[t],
              count: data.byType[t] ?? 0,
            })),
          ]}
          onPick={(label) => {
            const type = Object.entries(TYPE_LABEL).find(([, v]) => v === label)?.[0];
            navigate(type ? `/m/stalls/all?requestType=${type}` : '/m/stalls/all');
          }}
        />
      </Section>

      <Section title='Selection'>
        <StatTiles
          noun='request'
          tiles={(['SUBMITTED', 'SHORTLISTED', 'SELECTED', 'BACKUP', 'REJECTED'] as const).map((st) => ({
            label: STATUS_LABEL[st],
            count: s[st] ?? 0,
          }))}
          onPick={(label) => {
            const st = Object.entries(STATUS_LABEL).find(([, v]) => v === label)?.[0];
            navigate(`/m/stalls/all?status=${st}`);
          }}
        />
      </Section>

      <Section title='Stalls'>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 16 }}>
          <Card onAct={() => navigate('/m/stalls/planning')} label='Planned stalls'>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{data.stallsPlanned}</div>
            <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>Planned stalls</div>
          </Card>
          <Card>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{data.stallsAllocated}</div>
            <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>Allocated</div>
          </Card>
          <Card onAct={() => navigate('/m/stalls/all?flagged=true')} label='Flagged for follow-up'>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{data.flagged}</div>
            <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>Flagged for follow-up</div>
          </Card>
        </div>
      </Section>

      <Section title='Onboarding'>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
          <Card onAct={() => navigate('/m/stalls/onboarding')} label='Vendor onboarding'>
            <div style={{ fontWeight: 700 }}>Vendor onboarding</div>
            <div style={{ fontSize: 12, color: 'var(--mfg)' }}>Bank details, payment quotes, FSSAI, coupons</div>
          </Card>
          <Card onAct={() => navigate('/m/stalls/finance')} label='Finance'>
            <div style={{ fontWeight: 700 }}>Finance</div>
            <div style={{ fontSize: 12, color: 'var(--mfg)' }}>Confirm payments received outside the system</div>
          </Card>
          <Card onAct={() => navigate('/m/stalls/checkin')} label='Check-in'>
            <div style={{ fontWeight: 700 }}>Check-in</div>
            <div style={{ fontSize: 12, color: 'var(--mfg)' }}>Event day: arrivals, passes, what is still pending</div>
          </Card>
        </div>
      </Section>
    </div>
  );
}
