import { describe, expect, test } from "bun:test";
import { projectCustodialLedger } from "./custodial-ledger";

describe("custodial chronological ledger", () => {
  test("projects out-of-order postings without mutating their original facts", () => {
    const entries = [
      { id: "issue", effectiveDate: "2026-01-03", sequence: 3, delta: -3 },
      { id: "opening", effectiveDate: "2026-01-01", sequence: 1, delta: 10 },
      { id: "receipt", effectiveDate: "2026-01-02", sequence: 2, delta: 5 },
    ];
    expect(projectCustodialLedger(entries).map((row) => row.balanceAfter)).toEqual([10, 15, 12]);
    expect(entries[0]?.id).toBe("issue");
  });

  test("rejects an intermediate negative even when the final total is positive", () => {
    expect(() => projectCustodialLedger([
      { id: "issue", effectiveDate: "2026-01-01", sequence: 1, delta: -2 },
      { id: "receipt", effectiveDate: "2026-01-02", sequence: 2, delta: 10 },
    ])).toThrow("negative");
  });

  test("rejects invalid dates, repeated identifiers and unsafe quantities", () => {
    const row = { id: "a", effectiveDate: "2026-02-29", sequence: 1, delta: 1 };
    expect(() => projectCustodialLedger([row])).toThrow("date");
    const valid = { ...row, effectiveDate: "2026-02-28" };
    expect(() => projectCustodialLedger([valid, valid])).toThrow("entry");
    expect(() => projectCustodialLedger([{ ...valid, delta: Number.MAX_SAFE_INTEGER + 1 }])).toThrow("entry");
  });
});
