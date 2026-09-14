import { randomUUID } from 'node:crypto';
import type { PresignUploadInput, PresignUploadResponse } from '@msr/stalls';
import type { MediaStore } from '../../storage/media-namespace';
import { UploadsUnavailableError } from './errors';

/** Where a vendor's documents go, and what is allowed through.
 *
 *  Every key this module ever mints begins `stalls/`, which is the namespace
 *  the store was constructed with — a key outside it is refused by the store
 *  itself, not by a check here (see `media-namespace.ts`).
 *
 *  The filename a person uploaded is NOT part of the key. It is attacker-
 *  controlled text that ends up in logs, in a path on the development store,
 *  and in a Content-Disposition header; a UUID plus the extension we decided on
 *  carries none of that risk, and the real name is kept in a column where it is
 *  only ever displayed.
 */

const NAMESPACE = 'stalls/';

const FOLDER: Record<PresignUploadInput['purpose'], string> = {
  BANK_CHEQUE: 'bank/cheque',
  BANK_PAN: 'bank/pan',
  BANK_GST: 'bank/gst',
  FSSAI: 'fssai',
  TEMPLATE_ATTACHMENT: 'templates',
};

/** Images and PDFs. A cancelled cheque is photographed on a phone and a
 *  certificate is a PDF; nothing else has a reason to be here, and an
 *  allowlist is the only form of this check that stays correct as new
 *  dangerous types appear. */
const ALLOWED: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
};

/** 20 MB. A phone photograph is 2–5 MB; a scanned multi-page certificate can
 *  reach ten. Beyond that it is a mistake, and the presigned headers make the
 *  limit unforgeable — S3 rejects a PUT whose content-length does not match
 *  what was signed. */
export const MAX_UPLOAD_BYTES = 20_000_000;

export class UnsupportedFileTypeError extends Error {
  constructor(readonly contentType: string) {
    super(`${contentType} files cannot be uploaded — use a PDF or an image`);
    this.name = 'UnsupportedFileTypeError';
  }
}

export async function presignUpload(
  files: MediaStore,
  input: PresignUploadInput,
): Promise<PresignUploadResponse> {
  if (!files.configured()) throw new UploadsUnavailableError();
  const ext = ALLOWED[input.contentType.toLowerCase()];
  if (!ext) throw new UnsupportedFileTypeError(input.contentType);
  if (input.bytes > MAX_UPLOAD_BYTES) {
    throw new UnsupportedFileTypeError(`${Math.round(input.bytes / 1_000_000)}MB`);
  }

  const key = `${NAMESPACE}${FOLDER[input.purpose]}/${randomUUID()}.${ext}`;
  const { url, headers } = await files.presignUpload({
    key,
    contentType: input.contentType,
    bytes: input.bytes,
  });
  return { key, url, headers };
}

/** Refuses a key the caller did not get from `presignUpload` for this purpose.
 *
 *  The browser sends back a key when it submits the form, and without this a
 *  vendor could post any key under the namespace — including another vendor's
 *  cancelled cheque — and have it filed as their own. The shape is the whole
 *  check: a UUID under the folder this purpose writes to. */
export function isOurKey(key: string, purpose: PresignUploadInput['purpose']): boolean {
  const pattern = new RegExp(
    `^${NAMESPACE}${FOLDER[purpose]}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.[a-z0-9]{2,5}$`,
  );
  return pattern.test(key);
}
