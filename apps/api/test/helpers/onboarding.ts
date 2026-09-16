import { SubmitRequestInput } from '@msr/stalls';
import type { StallsDeps } from '../../src/modules/stalls/deps';
import { selectRequest } from '../../src/modules/stalls/selection';
import type { Signer, SignatureHandle, SignatureRequest } from '../../src/modules/stalls/signer';
import { createUnconfiguredSigner } from '../../src/modules/stalls/signer';
import { submitRequest } from '../../src/modules/stalls/submit';
import type { OutboundWhatsApp, WhatsAppSender } from '../../src/modules/stalls/whatsapp';
import { DiskMediaStore } from '../../src/storage/disk-media-store';
import type { MediaStore } from '../../src/storage/media-namespace';
import { accountFor, LogMailer, prisma, SYSTEM, vendorBody } from './db';

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

/** A WhatsApp sender that keeps what it was given, the way `LogMailer` does
 *  for email. The two channels are asserted separately on purpose: a template
 *  with an empty `whatsappBody` is email-only by design, and a test that only
 *  counted "messages" would not notice the difference. */
export function recordingWhatsApp(): WhatsAppSender & { sent: OutboundWhatsApp[] } {
  const sent: OutboundWhatsApp[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}

/** A signature provider that works, for the tests that need one to.
 *
 *  ⚠️ The default in `testDeps` is the UNCONFIGURED signer, matching what the
 *  standalone shell boots. Most of onboarding has to behave correctly when no
 *  provider is wired up — a selection letter still goes out, with an empty
 *  signature link — and defaulting to a working fake would hide exactly that. */
export function fakeSigner(): Signer & { sent: SignatureRequest[]; complete(): void } {
  const sent: SignatureRequest[] = [];
  let status: SignatureHandle['status'] = 'SENT';
  return {
    sent,
    complete() {
      status = 'SIGNED';
    },
    configured: () => true,
    async send(request) {
      sent.push(request);
      return {
        documentId: `doc-${sent.length}`,
        signUrl: `https://sign.test/${sent.length}`,
        status,
      };
    },
    async fetch(documentId) {
      return { documentId, signUrl: `https://sign.test/${documentId}`, status };
    },
  };
}

export interface TestDeps extends StallsDeps {
  mail: LogMailer;
  whatsapp: WhatsAppSender & { sent: OutboundWhatsApp[] };
  files: MediaStore & { presigned: string[] };
  /** The links the module handed out, by kind, so a test can follow one the way
   *  a vendor would rather than reaching into the database for a token. */
  links: {
    status: string[];
    bank: string[];
    fssai: string[];
    staff: string[];
    signature: string[];
    reset: string[];
  };
}

export function testDeps(overrides: Partial<TestDeps> = {}): TestDeps {
  const links: TestDeps['links'] = {
    status: [],
    bank: [],
    fssai: [],
    staff: [],
    signature: [],
    reset: [],
  };
  const capture = (bucket: string[], prefix: string) => (token: string) => {
    bucket.push(token);
    return `${prefix}/${token}`;
  };
  return {
    mail: new LogMailer(),
    whatsapp: recordingWhatsApp(),
    files: fakeStore(),
    links,
    signer: createUnconfiguredSigner(),
    statusUrl: capture(links.status, 'https://web.test/stalls/status'),
    bankFormUrl: capture(links.bank, 'https://web.test/stalls/bank'),
    fssaiUrl: capture(links.fssai, 'https://web.test/stalls/fssai'),
    staffRegistrationUrl: capture(links.staff, 'https://web.test/stalls/staff'),
    signatureUrl: capture(links.signature, 'https://web.test/stalls/sign'),
    passwordResetUrl: capture(links.reset, 'https://web.test/stalls/reset'),
    publicRateLimitMax: 10_000,
    ...overrides,
  };
}

/** A submitted request, already selected onto the given stalls. Most Phase 2
 *  and 3 behaviour only exists for a SELECTED request, so nearly every test
 *  starts here. */
export async function selected(
  stallNumbers: string[],
  overrides: Record<string, unknown> = {},
): Promise<{ requestId: string; reference: string }> {
  const r = await submitRequest(
    prisma,
    SubmitRequestInput.parse(vendorBody(overrides)),
    { mail: new LogMailer(), statusUrl: (t) => t },
    await accountFor(overrides),
  );
  await selectRequest(prisma, { requestId: r.requestId, stallNumbers }, SYSTEM);
  return { requestId: r.requestId, reference: r.reference };
}

export { DiskMediaStore };
