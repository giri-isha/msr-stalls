import { SubmitRequestInput } from '@msr/stalls';
import type { StallsDeps } from '../../src/modules/stalls/deps';
import { selectRequest } from '../../src/modules/stalls/selection';
import { submitRequest } from '../../src/modules/stalls/submit';
import { DiskMediaStore } from '../../src/storage/disk-media-store';
import type { MediaStore } from '../../src/storage/media-namespace';
import { LogMailer, SYSTEM, prisma, vendorBody } from './db';

/** A media store that presigns without a disk behind it. The Phase 2 tests
 *  care that a key is minted, checked against the namespace and handed back —
 *  not that bytes landed anywhere. */
export function fakeStore(): MediaStore & { presigned: string[] } {
  const presigned: string[] = [];
  return {
    presigned,
    configured: () => true,
    async presignUpload(o) {
      presigned.push(o.key);
      return { url: `https://store.test/${o.key}`, headers: {}, expiresIn: 900 };
    },
    async presignView(key) {
      return `https://store.test/view/${key}`;
    },
    async head() {
      return { bytes: 1, contentType: undefined };
    },
    async deleteMany() {},
  };
}

export interface TestDeps extends StallsDeps {
  mail: LogMailer;
  files: MediaStore & { presigned: string[] };
  /** The links the module handed out, by kind, so a test can follow one the way
   *  a vendor would rather than reaching into the database for a token. */
  links: { status: string[]; bank: string[]; fssai: string[]; staff: string[] };
}

export function testDeps(): TestDeps {
  const links: TestDeps['links'] = { status: [], bank: [], fssai: [], staff: [] };
  const capture = (bucket: string[], prefix: string) => (token: string) => {
    bucket.push(token);
    return `${prefix}/${token}`;
  };
  return {
    mail: new LogMailer(),
    files: fakeStore(),
    links,
    statusUrl: capture(links.status, 'https://web.test/stalls/status'),
    bankFormUrl: capture(links.bank, 'https://web.test/stalls/bank'),
    fssaiUrl: capture(links.fssai, 'https://web.test/stalls/fssai'),
    staffRegistrationUrl: capture(links.staff, 'https://web.test/stalls/staff'),
    publicRateLimitMax: 10_000,
  };
}

/** A submitted request, already selected onto the given stalls. Most Phase 2
 *  and 3 behaviour only exists for a SELECTED request, so nearly every test
 *  starts here. */
export async function selected(
  stallNumbers: string[],
  overrides: Record<string, unknown> = {},
): Promise<{ requestId: string; reference: string }> {
  const r = await submitRequest(prisma, SubmitRequestInput.parse(vendorBody(overrides)), {
    mail: new LogMailer(),
    statusUrl: (t) => t,
  });
  await selectRequest(prisma, { requestId: r.requestId, stallNumbers }, SYSTEM);
  return { requestId: r.requestId, reference: r.reference };
}

export { DiskMediaStore };
