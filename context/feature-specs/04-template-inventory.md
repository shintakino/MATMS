# 04 — Digital Templates and Printed Blank-Form Inventory

**Status:** Implemented, including scoped catalog/detail/stock panels, pre-activity identity edits, validated supersession, thresholds, quick actions, correction review and shared refresh. Expanded integration tests and Chromium stock/correction workflows pass (2026-10-28).

**Source:** PRD §6, FR-05, FR-06, §§8–10; AC-05–AC-10.

**Dependencies:** 00–03.

## Outcome and scope

Maintain links to master revisions and accurate printed-copy counts per template folder, backed by an immutable ledger.

## Catalog and data rules

- Each template row is a revision with unique revision code, family code, name, description, category, revision label/date, HTTPS digital URL, status, and optional superseded revision reference.
- Admin manages masters/revisions and thresholds. Once physical stock exists, revision identity is immutable; audited metadata/link corrections remain allowed.
- Inventory is unique per revision/template-folder pair, with nonnegative integer count/threshold and a version. Default threshold is 5.
- Never silently relabel old printed stock when a digital revision changes. Show superseded stock separately and require an Admin-recorded use/withdraw decision before issuance.
- External masters open in a new tab with an external-file indicator; validate URL/approved host policy without server fetching. MATMS cannot grant provider access.

## Stock procedures

| Action | Authorized role | Required behavior |
| --- | --- | --- |
| Receive | Admin/Property Custodian/Staff within scope | Positive integer quantity, source/reason, confirmed new balance |
| Issue | Admin/Property Custodian/Staff within scope | Positive integer quantity, purpose, requester/reference if applicable; sufficient stock |
| Transfer | Admin/Property Custodian/Staff with both locations in scope | Same revision, distinct valid template folders, atomic debit/credit, shared operation ID |
| Correct balance | Admin | Nonnegative target count, reason, expected version, before/after and signed delta |

Quick `+1` is Receive one; quick `-1` is Issue one. They still collect required information and create ledger/audit records. Opening balances are verified receive/opening-inventory transactions with date and actor, never silent balance assignment.

- Commit operation record, balance updates, ledger entries, and audit together. Use conditional updates or row locks to prevent negative stock and lost updates.
- Use a client operation ID and payload fingerprint. Same intent retries return the original authorized result; mismatched reuse fails. Transferring commits both sides or neither.
- Reject stale corrections with a typed conflict and refreshed state. Enforce archived-container restrictions and revision rules on the server.
- Preserve append-only ledger arithmetic and actor attribution. No UI ledger edits or deletion.

## UI and state

Target routes are `/templates`, `/templates/[id]`, `/template-inventory` and folder detail stock panels. Current implementation uses `/inventory`; add its compatibility redirect with the planned route update. Compose stock badges, Table, Dialog/Sheet, Alert Dialog for corrections, and inline errors from 01.

Show balances per revision/location, not only a total. Out of stock (`count = 0`) takes priority over Low stock (`count <= threshold`). Pending submissions retain the last confirmed balance. On commit refresh balance, ledger, affected lists and dashboard; on conflict preserve inputs and explain the updated state. Keep the operation ID across ambiguous retries.

## Verification

- Issue two from six → four with one ledger operation and Low stock at threshold five (AC-05).
- Five at threshold five is Low stock; zero is Out of stock (AC-06).
- Concurrent issues of four from five permit at most one success and never a negative balance (AC-07).
- Retrying after a lost response cannot double-issue; mismatched reuse fails (AC-08).
- Transfer failure on either side or audit write rolls back all changes (AC-09).
- A stale correction cannot overwrite a newer issue (AC-10).
- Viewer calls, unauthorized locations, non-template folders, invalid quantities, and prohibited superseded-stock issuance are rejected server-side.

## Planned PRD v1.3 integration

Add Property Custodian to permitted receive/issue/transfer paths and rename the register route as described above, preserving existing bookmarks, revision/folder balances and operation IDs. Catalog/threshold maintenance and printed-form corrections remain Admin-only. This spec does not implement custodial items, acquisition lots, Appendix 58 or physical counts; those use separate storage, thresholds, permissions and reports in 10–13. Existing verification predates the new role and route; repeat relevant authorization/browser checks.
