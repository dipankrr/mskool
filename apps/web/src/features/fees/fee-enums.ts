/**
 * The fees wire enums, re-exported as the exact literal unions the
 * contracts own. Components import these instead of restating string
 * literals, so a value the contracts stop accepting stops compiling here
 * too. (Types only — no runtime code, nothing to drift.)
 */
import type {
  CreateFeeHeadInput,
  FeeInstallment,
  FeePayment,
  FeeStructureLine,
  LateFeeRule,
  StudentFeeAssignment,
  StudentOptionalFeeSubscription,
  OpeningBalance,
  FinancialTransaction,
} from "@repo/contracts";

export type FeeHeadCategory = NonNullable<CreateFeeHeadInput["category"]>;
export type FeeInstallmentFrequency = NonNullable<CreateFeeStructureLineInput["installmentFrequency"]>;
type CreateFeeStructureLineInput = import("@repo/contracts").CreateFeeStructureLineInput;
export type LateFeeCalculationType = LateFeeRule["calculationType"];
export type FeePaymentMode = FeePayment["paymentMode"];
export type FeePaymentStatus = FeePayment["paymentStatus"];
export type FeeInstallmentStatus = FeeInstallment["paymentStatus"];
export type FeeAssignmentStatus = StudentFeeAssignment["status"];
export type FeeSubscriptionStatus = StudentOptionalFeeSubscription["status"];
export type OpeningBalanceStatus = OpeningBalance["status"];
export type LedgerDirection = FinancialTransaction["direction"];
export type FeeStructureInstallmentMode = NonNullable<
  import("@repo/contracts").CreateFeeStructureInput["installmentMode"]
>;
export type ConcessionType = import("@repo/contracts").CreateConcessionInput["concessionType"];
export type ConcessionCalculation = import("@repo/contracts").CreateConcessionInput["calculationType"];
export type LineFrequency = FeeStructureLine["installmentFrequency"];
export type LedgerTransactionType = FinancialTransaction["transactionType"];
/** Alias kept short for the ledger page's column typing. */
export type LedgerType = LedgerTransactionType;
export type LedgerDirection2 = FinancialTransaction["direction"];
