import type { StallAccessPurpose } from '@prisma/client';
import { mintAccessLink } from './accounts';
import type { StallsDeps } from './deps';
import type { Db } from './editions';

/** How long each kind of link lives. Long on purpose: a vendor opens the bank
 *  form days after the email and the FSSAI upload weeks after that. */
const TTL_DAYS: Record<StallAccessPurpose, number> = {
  STATUS: 365,
  BANK_FORM: 120,
  FSSAI_UPLOAD: 180,
  STAFF_REGISTRATION: 180,
};

/** A fresh signed URL for one of the vendor's own pages.
 *
 *  Always a NEW link. Only the hash of a token is stored, so an existing
 *  link's URL cannot be recovered to reuse — and that is the point of hashing.
 *  Older links stay valid until they expire, so a vendor who kept the first
 *  email is not locked out by a reminder. */
export async function publicUrl(
  db: Db,
  req: { id: string; accountId: string },
  purpose: StallAccessPurpose,
  deps: Pick<StallsDeps, 'linkUrl'>,
): Promise<string> {
  const { token } = await mintAccessLink(db, {
    accountId: req.accountId,
    requestId: req.id,
    purpose,
    ttlDays: TTL_DAYS[purpose],
  });
  return deps.linkUrl(purpose, token);
}
