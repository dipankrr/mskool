import { LedgerScreen } from "../../../screens/fees/ledger";

/**
 * The append-only fee ledger. Opened from the payments list (whole session)
 * or from a student's desk (that student's movements).
 */
export default function FeeLedgerRoute() {
  return <LedgerScreen />;
}
