/** Refuses to run the suite against anything but a database whose name ends in
 *  `_test`. This guard exists because the harness TRUNCATEs every stall table
 *  between tests — pointed at the dev database it would sign the developer out
 *  and wipe their seed data mid-session, and pointed at anything real it would
 *  be a disaster. Fail loudly, with instructions, before any Prisma client is
 *  built. */
export function assertTestDatabase(url: string | undefined): asserts url is string {
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Tests need apps/api/.env.test — copy .env.test.example.',
    );
  }
  let name: string;
  try {
    name = new URL(url).pathname.replace(/^\//, '').split('?')[0];
  } catch {
    throw new Error(`DATABASE_URL is not a URL: ${JSON.stringify(url)}`);
  }
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against database "${name}": the name must end in _test. ` +
        'The suite truncates every table between tests. See apps/api/.env.test.example.',
    );
  }
}
