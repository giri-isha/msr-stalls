import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Everything in this package is pure — no database, no network, no clock.
    // That is the point of the package: the rules that matter most (money,
    // allocation arithmetic, access predicates) are testable in milliseconds.
    environment: 'node',
  },
});
