# 06 — Dashboard, Search and Reports

**Status:** Planned.

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
