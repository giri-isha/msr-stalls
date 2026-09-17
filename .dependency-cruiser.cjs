// Module-boundary enforcement, copied from msr-app-replit (host ADR 0008 —
// modules talk only through published contracts, never by reaching into each
// other; one-directional, no cycles).
//
// Here it carries EXTRA weight. This repo is a standalone staging ground for a
// module that will be moved into that host: everything under `modules/stalls/`
// and `packages/stalls/` migrates verbatim, while the Foundation stubs around
// it (`apps/api/src/auth.ts`, the web shell) are thrown away. The rules below
// are what keep that promise machine-checked rather than remembered — a stalls
// file that reaches into the shell fails the build HERE, months before the move
// would have discovered it.

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-cross-module',
      comment:
        "A module must not import another module's internals (host ADR 0008). " +
        'Modules talk only through published contracts — expose a contract from ' +
        'the other module and import that, never reach into its folder.',
      severity: 'error',
      from: { path: '(?:^|/)modules/([^/]+)/' },
      to: {
        path: '(?:^|/)modules/([^/]+)/',
        pathNot: '(?:^|/)modules/$1/',
      },
    },
    {
      name: 'no-circular',
      comment:
        'Dependencies must be one-directional and acyclic (host ADR 0008). Invert ' +
        'a reverse dependency with an event instead of a back-reference.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      // ── The migration guard ────────────────────────────────────────────────
      // The api module may import ONLY: itself, the shared package, node_modules,
      // and the handful of Foundation files that exist in the host under the same
      // relative paths with the same signatures (auth, prisma, errors,
      // zod-validation, activity, storage/media-namespace). Anything else in
      // `apps/api/src/` is a stub this repo invented, and importing it would not
      // survive the move.
      name: 'stalls-api-imports-only-foundation',
      comment:
        'apps/api/src/modules/stalls/ may import only its own folder, @stalls/core, ' +
        'and the Foundation files that exist in msr-app-replit at the same relative ' +
        'path with the same signatures. Importing any other shell file would break ' +
        'on migration. Add a dependency to StallsDeps instead.',
      severity: 'error',
      from: { path: '^apps/api/src/modules/stalls/' },
      to: {
        path: '^apps/api/src/',
        pathNot: [
          '^apps/api/src/modules/stalls/',
          '^apps/api/src/(auth|prisma|errors|zod-validation|activity)\\.ts$',
          '^apps/api/src/storage/media-namespace\\.ts$',
        ],
      },
    },
    {
      // The host's activity trail is reached through ONE file. `audit.ts`
      // writes the module's own log and forwards to the host's; a second
      // importer would be a write the module's own screens never see.
      name: 'stalls-trail-through-audit-only',
      comment:
        'Only apps/api/src/modules/stalls/audit.ts may import ../../activity. ' +
        "Everything else records through audit(), so the module's own log and " +
        "the host's trail cannot disagree about what happened.",
      severity: 'error',
      from: {
        path: '^apps/api/src/modules/stalls/',
        pathNot: '^apps/api/src/modules/stalls/audit\\.ts$',
      },
      to: { path: '^apps/api/src/activity\\.ts$' },
    },
    {
      // The web module owns its own screens and data access. It may use the
      // shared UI primitives (which exist in the host too, same paths) but must
      // not import the standalone shell's routing or layout.
      name: 'stalls-web-imports-only-shared',
      comment:
        'apps/web/src/modules/stalls/ may import only its own folder and @stalls/core. ' +
        'It carries its own UI system (ui/, ported from msr-volunteering under the ' +
        '.stalls scope) and its own API client, so nothing from the shell migrates with it.',
      severity: 'error',
      from: { path: '^apps/web/src/modules/stalls/' },
      to: {
        path: '^apps/web/src/',
        pathNot: ['^apps/web/src/modules/stalls/'],
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // @swc/core parses the sources: dependency-cruiser's bundled TypeScript
    // extractor supports typescript <7 only and this repo is on TS 7, so it
    // falls back to SWC, which is version-independent and handles TS + TSX.
    tsConfig: { fileName: 'tsconfig.base.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { extensions: ['.ts', '.tsx', '.js', '.jsx'] },
  },
};
