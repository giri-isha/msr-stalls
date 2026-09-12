/** The voucher the stalls team hands finance: what is left of the deposit
 *  once missing and damaged furniture and any fines are taken off. */
export interface RefundInputs {
  depositTotalPaise: number;
  chairsMissing: number;
  chairsDamaged: number;
  tablesMissing: number;
  tablesDamaged: number;
  chairReplacementPaise: number;
  tableReplacementPaise: number;
  finesPaise: number;
}

export interface Refund {
  furnitureDeductionPaise: number;
  finesPaise: number;
  deductionsPaise: number;
  /** What finance pays back. Never negative. */
  refundablePaise: number;
  /** What the deposit did not cover. Zero unless deductions exceed it — kept
   *  as its own figure so the team can chase it rather than lose it in a
   *  clamped zero. */
  shortfallPaise: number;
}

export function computeRefund(i: RefundInputs): Refund {
  const nz = (n: number) => Math.max(0, Math.floor(n));
  const furnitureDeductionPaise =
    (nz(i.chairsMissing) + nz(i.chairsDamaged)) * nz(i.chairReplacementPaise) +
    (nz(i.tablesMissing) + nz(i.tablesDamaged)) * nz(i.tableReplacementPaise);
  const finesPaise = nz(i.finesPaise);
  const deductionsPaise = furnitureDeductionPaise + finesPaise;
  const deposit = nz(i.depositTotalPaise);
  return {
    furnitureDeductionPaise,
    finesPaise,
    deductionsPaise,
    refundablePaise: Math.max(0, deposit - deductionsPaise),
    shortfallPaise: Math.max(0, deductionsPaise - deposit),
  };
}
