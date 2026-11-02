/**
 * "Due now" is what is unpaid up to the end of this month, the same line the
 * server and the phone draw. Later months are owed later, and previous dues are
 * counted alongside. Every fee total on the web goes through this cut-off.
 */
export function endOfMonthOf(isoDay: string): string {
  const year = Number(isoDay.slice(0, 4));
  const month = Number(isoDay.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${isoDay.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}
