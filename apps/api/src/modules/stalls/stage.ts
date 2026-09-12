import type { StallRequestType, StallStage, StallType } from '@prisma/client';
import { type FlowCtx, type StageEvent, nextStage } from '@msr/stalls';
import type { Db } from './editions';
import { UnknownRequestError } from './errors';

/** What a request's stage machine needs to know about it and its edition. */
export async function flowCtxFor(
  db: Db,
  req: { requestType: StallRequestType; stallType: StallType; editionId: string },
): Promise<FlowCtx> {
  const flow = await db.stallFlowConfig.findUnique({ where: { editionId: req.editionId } });
  return {
    bankStepEnabled: flow?.bankStepEnabled ?? true,
    paymentStepEnabled: flow?.paymentStepEnabled ?? true,
    fssaiStepEnabled: flow?.fssaiStepEnabled ?? true,
    isFood: req.stallType === 'FOOD',
    isAshram: req.requestType === 'ASHRAM' || req.requestType === 'ASHRAM_FOOD',
  };
}

/** Apply an event to a request's stage under its edition's flow. Never moves
 *  backwards; returns the resulting stage either way. */
export async function advanceStage(
  db: Db,
  requestId: string,
  event: StageEvent,
): Promise<StallStage> {
  const req = await db.stallRequest.findUnique({
    where: { id: requestId },
    select: { id: true, requestType: true, stallType: true, editionId: true, stage: true },
  });
  if (!req) throw new UnknownRequestError(requestId);
  const ctx = await flowCtxFor(db, req);
  const next = nextStage(req.stage, event, ctx);
  if (next !== req.stage) {
    await db.stallRequest.update({ where: { id: requestId }, data: { stage: next } });
  }
  return next;
}
