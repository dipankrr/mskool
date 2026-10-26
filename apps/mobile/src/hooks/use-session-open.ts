import { useActiveContext } from "./use-active-context";

/**
 * Whether the current session still takes fee writes. A school can close the
 * current session before switching to the next one; until then the fee
 * screens are read-only — collect, billing, concessions and fee-chart edits
 * hide — while payment corrections (a cheque can still bounce) stay.
 *
 * The server does not refuse these writes yet (recorded as a backend gap), so
 * this is the only guard today.
 */
export function useSessionOpen(): boolean {
  const { academicYear } = useActiveContext();
  return academicYear?.status !== "closed";
}
