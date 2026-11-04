/** A dated ledger entry; quantities are signed changes to one balance scope. */
export type CustodialLedgerEntry = {
  id: string;
  effectiveDate: string;
  sequence: number;
  delta: number;
};

export type CustodialLedgerProjection = CustodialLedgerEntry & {
  balanceBefore: number;
  balanceAfter: number;
};

/** Rebuild a chronological card without changing immutable posting facts. */
export function projectCustodialLedger(entries: readonly CustodialLedgerEntry[]): CustodialLedgerProjection[] {
  const ids = new Set<string>();
  let balance = 0;
  return [...entries]
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.sequence - b.sequence || a.id.localeCompare(b.id))
    .map((entry) => {
      const date = new Date(`${entry.effectiveDate}T00:00:00.000Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.effectiveDate) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== entry.effectiveDate) {
        throw new Error("Invalid transaction date.");
      }
      if (!entry.id || ids.has(entry.id) || !Number.isSafeInteger(entry.sequence) || entry.sequence < 0 || !Number.isSafeInteger(entry.delta) || entry.delta === 0) {
        throw new Error("Invalid ledger entry.");
      }
      ids.add(entry.id);
      const next = balance + entry.delta;
      if (!Number.isSafeInteger(next) || next < 0) throw new Error("A chronological balance cannot be negative.");
      const result = { ...entry, balanceBefore: balance, balanceAfter: next };
      balance = next;
      return result;
    });
}
