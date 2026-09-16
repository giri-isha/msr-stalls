import type { PrismaClient } from '@prisma/client';
import {
  SIGNATURE_LABEL,
  type SignatureStatus,
  type SignatureView,
  needsSignature,
} from '@stalls/core';
import { recordActivity } from '../../activity';
import type { StallsDeps } from './deps';
import type { Db } from './editions';
import { SignatureProviderError, UnknownRequestError, WrongTemplateError } from './errors';
import { MODULE_KEY } from './roles';

/** The stall agreement, sent for digital signature.
 *
 *  The terms used to be a tick-box at the bottom of the request form. They are
 *  not any more: the legal team sends the agreement out for real signature, and
 *  the ask was that it happen here rather than in a mailbox nobody on the stall
 *  team can see. The tick-box has not been removed — a requester still
 *  acknowledges the allocation disclaimer when they apply — but it is no longer
 *  pretending to be the contract.
 *
 *  Everything provider-shaped lives behind `deps.signer`. See `signer.ts`.
 */

export function toSignatureView(
  row: {
    status: SignatureStatus;
    documentId: string | null;
    signUrl: string | null;
    sentAt: Date | null;
    signedAt: Date | null;
    error: string | null;
  } | null,
): SignatureView {
  const status = row?.status ?? 'NOT_SENT';
  return {
    status,
    label: SIGNATURE_LABEL[status],
    documentId: row?.documentId ?? null,
    sentAt: row?.sentAt?.toISOString() ?? null,
    signedAt: row?.signedAt?.toISOString() ?? null,
    signUrl: row?.signUrl ?? null,
    error: row?.error ?? null,
  };
}

export async function readSignature(db: Db, requestId: string): Promise<SignatureView> {
  const row = await db.stallContractSignature.findUnique({ where: { requestId } });
  return toSignatureView(row);
}

/** Sends the agreement, or returns what is already there.
 *
 *  ⚠️ Idempotent on purpose. The selection letter asks for a signing link every
 *  time it renders, and a team re-sending that letter must not open a second
 *  agreement against the same stall — two live documents is exactly the
 *  ambiguity a signature is meant to remove. A request that has already been
 *  sent gets its existing link back.
 */
export async function sendForSignature(
  db: PrismaClient,
  requestId: string,
  deps: StallsDeps,
  by: string,
): Promise<SignatureView> {
  const request = await db.stallRequest.findUnique({
    where: { id: requestId },
    include: { edition: true },
  });
  if (!request) throw new UnknownRequestError(requestId);
  if (!needsSignature(request.requestType)) {
    // Local welfare stalls are filed by the welfare team on a trader's behalf
    // and ashram departments are internal. Neither has a counterparty to sign
    // with, and sending one would be asking a colleague to countersign their
    // own department's requisition.
    throw new WrongTemplateError('SIGNATURE', `is not sent to a ${request.requestType} request`);
  }

  const existing = await db.stallContractSignature.findUnique({ where: { requestId } });
  if (existing && (existing.status === 'SENT' || existing.status === 'SIGNED')) {
    return toSignatureView(existing);
  }

  if (!deps.signer.configured()) throw new SignatureProviderError('not configured');

  let handle: Awaited<ReturnType<StallsDeps['signer']['send']>>;
  try {
    handle = await deps.signer.send({
      signerName: request.requesterName,
      signerEmail: request.email,
      signerMobile: request.contactNumber,
      reference: request.reference,
      stallName: request.stallName,
      editionName: request.edition.name,
    });
  } catch (e) {
    // Recorded rather than thrown away: the team has to be able to see that an
    // agreement was attempted and why it did not go, without reading a log.
    const message = e instanceof Error ? e.message : 'unknown error';
    const row = await db.stallContractSignature.upsert({
      where: { requestId },
      create: { requestId, provider: 'unknown', status: 'FAILED', error: message },
      update: { status: 'FAILED', error: message },
    });
    return toSignatureView(row);
  }

  const row = await db.stallContractSignature.upsert({
    where: { requestId },
    create: {
      requestId,
      provider: 'configured',
      status: handle.status,
      documentId: handle.documentId,
      signUrl: handle.signUrl,
      sentAt: new Date(),
      sentBy: by,
      error: null,
    },
    update: {
      status: handle.status,
      documentId: handle.documentId,
      signUrl: handle.signUrl,
      sentAt: new Date(),
      sentBy: by,
      error: null,
    },
  });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_signature.sent',
    subjectRef: requestId,
    detail: { documentId: handle.documentId },
  });
  return toSignatureView(row);
}

/** Re-reads the provider's state for one request.
 *
 *  Signing happens later and elsewhere, so the module has to pull. A host that
 *  can receive the provider's webhook should call this from it rather than
 *  polling; the screen's refresh button calls it directly.
 */
export async function refreshSignature(
  db: PrismaClient,
  requestId: string,
  deps: StallsDeps,
): Promise<SignatureView> {
  const row = await db.stallContractSignature.findUnique({ where: { requestId } });
  if (!row?.documentId || !deps.signer.configured()) return toSignatureView(row);

  let handle: Awaited<ReturnType<StallsDeps['signer']['fetch']>>;
  try {
    handle = await deps.signer.fetch(row.documentId);
  } catch {
    // ⚠️ The STORED status is returned unchanged, and the error is deliberately
    // not read: a provider that is briefly unreachable must not turn a signed
    // agreement back into an unsigned one on the screen.
    return toSignatureView(row);
  }

  const updated = await db.stallContractSignature.update({
    where: { requestId },
    data: {
      status: handle.status,
      signUrl: handle.signUrl,
      signedAt: handle.status === 'SIGNED' ? (row.signedAt ?? new Date()) : row.signedAt,
    },
  });
  return toSignatureView(updated);
}

/** The signing link for a letter that is going out, or null.
 *
 *  Never throws: a selection letter must go even when no provider is wired up,
 *  with the placeholder rendering empty. A missing signature link is a gap the
 *  team can close by hand; a letter that failed to send is not.
 */
export async function signatureLinkFor(
  db: PrismaClient,
  requestId: string,
  deps: StallsDeps,
  by: string,
): Promise<string | null> {
  try {
    const view = await sendForSignature(db, requestId, deps, by);
    return view.signUrl;
  } catch {
    return null;
  }
}
