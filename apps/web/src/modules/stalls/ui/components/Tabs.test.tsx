import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { Tabs } from './Tabs';

describe('Tabs', () => {
  test('a tab carrying a mark draws it, and one without does not', () => {
    render(
      <Tabs
        label='Sections'
        active='a'
        onPick={() => {}}
        tabs={[
          { key: 'a', label: 'Overview' },
          { key: 'b', label: 'Payment', mark: 'warn' },
          { key: 'c', label: 'Staff', mark: 'ok' },
        ]}
      />,
    );

    expect(screen.getByRole('tab', { name: 'Overview' }).querySelector('[data-mark]')).toBeNull();
    expect(
      screen.getByRole('tab', { name: 'Payment' }).querySelector('[data-mark="warn"]'),
    ).not.toBeNull();
    expect(
      screen.getByRole('tab', { name: 'Staff' }).querySelector('[data-mark="ok"]'),
    ).not.toBeNull();
  });
});
