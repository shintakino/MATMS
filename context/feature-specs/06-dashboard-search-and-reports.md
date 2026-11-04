# 06 — Dashboard, Search and Reports

**Status:** Implemented. Functional/export browser checks and the representative concurrent synthetic search target pass (2026-10-28). The agreed school-device ≤1.5-second screen target remains unmeasured; see the progress tracker.

**Source:** PRD FR-02, FR-08, §§9–11; AC-03, AC-17.

**Dependencies:** 00–05; summary widgets can land incrementally as domains become available.

## Outcome and scope

Provide a fast operational overview and searchable authorized metadata, with consistent list filters and safe CSV reporting.

## Dashboard

At `/dashboard`, show permitted active boxes, folders, documents, low-stock lines, out-of-stock lines, pending requests, active loans, and overdue loans. Link metrics to corresponding filtered lists. Stock is counted per revision/location so one well-stocked folder cannot hide another depleted folder.

Recent activity obeys both record scope and the role's history permission; Viewers do not receive operational transaction details. Apply the same role constraints to request/loan queues and report links. Never send forbidden fields then hide them in the browser.

## Search and lists

- Search codes, titles, folder names, permitted keywords, and template names. No scanned-content search.
- Debounce around 300 ms and query the server. Filters include category, shelf, box lifecycle, authorized confidentiality, stock status, revision status, request status and relevant date range.
- Default page size 25, maximum 100; validate server-side. Use deterministic sorting, URL-persisted filters and a reset action.
- Filter scope before pagination, counts, suggestions, and aggregation. Results include permitted breadcrumb location and availability.
- Apply normal authorization to retired/archived search filters as well as active lists.

## Reports and CSV

At `/reports`, provide box/folder inventory, document register, template balances, stock ledger, active/overdue loans, request history, and relocation history. Report data follows role capabilities; operational history and exports are unavailable to Viewers.

- Export the selected authorized filter scope, not just the visible page, subject to an explicit documented server row limit.
- Include generated timestamp and filter summary where practical; use UTF-8, proper CSV quoting/escaping, and spreadsheet-formula neutralization for text cells.
- Audit successful exports with actor, scope, and row count before releasing the artifact. Do not expose arbitrary filesystem paths or create a public report store.
- Bound costly requests/exports, stream if appropriate, and provide narrowing guidance if limits are exceeded.
- Document query indexes using representative data; assess PostgreSQL text/trigram search before adding infrastructure.

## UI and verification

Compose Cards, Table, Badge, Input/Select, Pagination, Skeleton, Alert, and reset/export controls from 01. Every view has loading, empty, error/retry, and mobile behavior.

- Counts, rows, suggestions, history, and exports exclude restricted data for ungranted users (AC-03).
- Exports match active filters/access and safely handle formula-like strings, quotes, commas, and newlines (AC-17).
- Pagination is stable with equal sort values; changing filters resets invalid pagination.
- Representative-load targets: p95 list/search API ≤500 ms excluding network, key-screen usable content ≤1.5 seconds on the agreed school test profile.
- Confirm behavior using synthetic sizing assumptions: 500 boxes, 5,000 folders, 50,000 documents, 2,000 inventory lines, 20 concurrent users. These are not actual school counts.

## Query assessment

Unique normalized-code indexes support exact lookup. Reviewed lower-code/UUID indexes with deterministic C collation and a template/inventory candidate index support ordered searches. Box/folder/document candidate branches check scope and filters before limiting; all-type search unions bounded branches under the shared authorization CTEs. Inventory candidates correlate by their actual row ID, avoiding an accidental self-comparison. Counts, pagination and related fields remain scope-filtered; there is no application result cache.

`EXPLAIN ANALYZE` showed that PostgreSQL JIT compilation dominated short operational query execution. The application pool now disables JIT. On the isolated test database, the 500-box / 5,000-folder / 50,000-document / 2,000-line all-type search fixture passed at p95 **464 ms** across 60 samples, in batches of 20 concurrent calls. This supersedes the earlier failed p95 15,572 ms result. Reproduce with `REPORT_SEARCH_KIND=all TEST_DATABASE_URL=postgresql://.../matms_test pnpm run test:reporting-load`; the default command exercises document-only search. The benchmark asserts ≤500 ms and cleans up its own synthetic records.

These are local Admin service calls, not 20 distinct signed-in users, exhaustive substring/query distributions or school-device measurements. Substring predicates may still scan candidates when few records match; evaluate trigram or dedicated search indexes against actual pilot plans if needed. Chromium stock/report/export workflows and automated accessibility checks pass. The ≤1.5-second screen target, real-user load and agreed school-device/network profile remain acceptance checks.

## Planned custodial extension — PRD v1.3

- Add authorized per-office reorder/zero-stock, shortage/overage, condition, draft-count and readiness queues, with recent custodial receipts/issues. Keep printed-form and custodial metrics separate; null reorder is unconfigured and zero/equal boundaries follow 10.
- Search/filter custodial item/stock/property codes, descriptions, class, section, office/fund, condition, acquisition year, count status, variance and data-quality issues. Apply current role/assignment scope before counts and pagination; assignments never imply schoolwide custodial access.
- Add item/lot register, variance, condition/serviceability and acquisition/source reports plus official-form entry points at `/property-inventory/reports`. Ordinary authorized lists use existing safe CSV behavior. Appendix 58/RPCSP/RPCPPE XLSX and print are exclusively spec 12, with its official capability, immutable snapshot, profile and artifact audit requirements (AC-35).
- Extend tests for custodial counts versus visible rows, missing/zero values, formula-safe CSV and revoked assignment/download access (AC-03, AC-17, AC-25, AC-35). Test expanded sizing: 10,000 custodial items/lots, 250,000 ledger entries, 100 count sessions and 20 concurrent users. Existing p95 archive evidence does not verify these queries.

The baseline status and measurements above remain historical verification of the existing domains; this extension is planned and depends on 10–13.
