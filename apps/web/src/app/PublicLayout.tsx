// SHELL — a plain header around the public forms. Discarded at migration.
import { Link, Outlet } from 'react-router';

export function PublicLayout() {
  return (
    <div className='min-h-screen'>
      <header className='border-b border-line bg-surface'>
        <div className='mx-auto flex max-w-3xl items-center justify-between px-4 py-3'>
          <Link to='/stalls/apply' className='font-bold'>
            Maha Shivratri — Stalls
          </Link>
          <span className='text-xs text-ink-2'>Isha Stall Team</span>
        </div>
      </header>
      <main className='mx-auto max-w-3xl px-4 py-6'>
        <Outlet />
      </main>
    </div>
  );
}
