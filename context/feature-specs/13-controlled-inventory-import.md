# 13 — Controlled Inventory Workbook Import

**Status:** In progress. Staging, review and atomic commit workflows are connected; full acceptance remains open. All supplied sources were structurally inspected; no school records have been imported.

**Source:** PRD FR-11 controlled import, §§8–11, 15–17; AC-32, AC-33, AC-34, AC-35.

**Dependencies:** 10 item/lot/ledger, 11 draft counts, 12 profile/mapping contracts, 02 role checks and 08 audit. Use the complete [workbook reference](../inventory-workbook-reference.md) for detection, sections and anomaly cases.

## Supported inputs and parsing

Accept RPCSP/RPCPPE `.xlsx` and Appendix 58 `.xls`/`.xlsx` only. Detect signatures and actual format as well as extension; detect family by required title/header labels and column positions, not filename or sheet name alone. Support every supplied sheet and grouped section, including the space in `RPCSP_ OTHERSUPPLIES`. Generic/custom workbook mapping remains deferred.

Parse in the Hono/domain boundary with inspected, pinned libraries supporting both BIFF and OOXML. Never execute macros/formulas, follow external links or fetch remote sources. Bound uploaded bytes, decompressed bytes, sheet count, semantic row/cell count and parse time. Reject encrypted, macro-enabled, malformed, oversized and unsupported structures safely. Ignore formatting-only extents when finding records while still bounding the entire file. Store uploads privately with documented expiry; do not add general scanned-document storage.

Originals remain unchanged. Keep source hash, filename, exact sheet/row/cell coordinates, raw values, formula/cached-value provenance, detected profile, actor and parse time in an import batch. Do not log entire workbooks or personal fields.

## Preview and mapping

1. Upload/detect into a staged batch; show form family, sheets, metadata, signatories, source date and mapping confidence. Parsing/staging may persist batch evidence but creates no operational item, balance, transaction or count.
2. Show proposed items/lots, section/class, property identifiers, units, values, dates/year labels, card/physical quantities and original remarks beside source coordinates. Resolve merged article labels only within their defined section. Keep descriptions and continuation rows together; Land B15 belongs to row 14.
3. Exclude titles, blanks, totals, footer notes and signatories from record rows, preserving them as report metadata for review. The supplied blank Stock Card produces zero transactions; it may inform a profile but cannot create a guessed item/opening balance.
4. Validate required fields against the selected profile and policy. Show row status, duplicate candidates, formula cells, cached source values, calculated comparisons, warnings, blocking errors and excluded rows. User edits apply to staged mappings and are versioned/audited; retain original evidence.
5. Require explicit operator resolution of missing values, `-` placeholders, duplicate property numbers, classification conflicts, mixed years, contradictory counts/conditions and source-total mismatches. Preserve zero versus unavailable. Approved year ranges/lists remain text labels, not guessed acquisition dates. A permitted unavailable field needs a reason; required unresolved fields block commit.

Cached formula values may be candidates only when displayed with provenance and explicitly verified. A missing cache remains unresolved; do not evaluate the uploaded formula. Recalculate server-owned balances/variances/totals from validated inputs. A formula copying card quantity is not independent physical confirmation.

## Commit intent and atomicity

Admin/Property Custodian selects and confirms whether a batch creates a verified opening inventory, a historical Stock Card ledger, a draft physical count, or an explicitly reviewed combination. Every selected effect is listed before commit; importing a count does not imply importing its card quantity into live stock. Existing item/lot mapping must be explicit; never overwrite or silently merge existing balances.

- Opening inventory creates attributable opening operations with date, reference and source batch. If importing a historical Stock Card ledger, reconcile opening and each dated receipt/issue/office/balance; reject negative/inconsistent sequences and do not also post its closing balance as an extra opening.
- Physical counts create draft sessions/lines with imported evidence. Compare source card quantities against authorized as-of ledger snapshots; resolve mismatches before finalization. They never alter live stock. Any later reconciliation is a separately authorized adjustment with count/batch reference.
- Default commit is all-or-nothing across selected rows and operational writes plus audit. A valid-rows-only option requires explicit excluded-row acknowledgement and downloadable error report. Do not partially succeed silently or create a finalize-ready count with hidden omissions.
- Require durable operation ID, batch/version, source hash and operator-confirmed identity. Revalidate permissions, resolved mapping and target versions inside the commit transaction; saved replay reauthorizes and cannot repost openings. Same-file re-upload warns and links prior batches; source hash alone must not prevent an intentional separately reviewed operation.
- A failed commit leaves no partial operational records. Staged diagnostics remain available; committed history is append-only. Later corrections use linked adjustments/amendments, never delete the import's ledger trail.

## UI, artifacts and services

Routes: `/property-inventory/imports`, `/property-inventory/imports/[id]`. Use file selection, detection, mapping/review and commit-result steps with shared shadcn/ui controls. Show progress/pending/error, row-level fixes, duplicate resolution, selected/excluded counts, impact summary and explicit commit confirmation. Preserve staged edits on retry and do not label a batch committed before server confirmation.

Use PRD `inventoryImports` detection, preview, validation, commit and error-report contracts. Only authorized operators can read batch evidence/error files. Downloads include safe text, source coordinates and reason codes; neutralize CSV/XLSX formula injection. Temporary upload expiry must not remove committed provenance or error summaries needed for reconciliation. Import does not finalize counts, publish profiles or grant access.

## Acceptance and checks

- Untouched sources detect all seven sheets, 11 RPCSP sections, three RPCPPE types and the blank Stock Card correctly; headings, totals, signature and continuation rows do not become items (AC-32).
- Exercise every anomaly in the reference, including duplicate identifiers, zero/blank/`-`, wrong variance signs, addition formulas, partial totals, mixed-year strings and classification conflicts. Calculations remain server-owned (AC-33).
- Preview creates no operational data; count-only commit creates drafts without stock changes (AC-34).
- Direct Staff/Viewer import/commit/error-file access and role-revoked retry fail (AC-35).
- Verify full rollback on row/audit failure, duplicate upload warning, intent-safe idempotency, stale-target conflicts and explicit partial exclusions.
- Test malformed, encrypted, macro-enabled, unsupported and resource-exhaustion inputs plus formula-like error-report values. Use fictional derivatives in automated fixtures; do not publish original school data in seeds or screenshots.
