# Meocan Archive & Template Management System
## Product Requirements Document — Version 1.3

**School:** Meocan High School  
**Date:** October 28, 2026\
**Status:** Development baseline; school operational policies require owner confirmation before production use.  
**Primary operators:** Administrative Officer II and School Property Custodian\
**Product abbreviation:** MATMS

### Implementation documentation

This PRD is the product baseline. The [context files](context/project-overview.md) translate it into architecture, UI, code, and workflow guidance. The [feature-spec index](context/feature-specs/README.md) maps planned implementation units to functional requirements and acceptance criteria. The [progress tracker](context/progress-tracker.md) records actual completion separately from planned behavior. Resolve conflicts in these documents before dependent implementation.

Version 1.3 adds the Property Custodian Inventory module, controlled import of the three supplied workbook formats, stock-card and physical-count workflows, and source-faithful XLSX/print outputs for Appendix 58, Annex A.8, and Appendix 73. The required shadcn/ui decision and requested bootstrap configuration are retained.

## 1. Purpose and outcomes

MATMS maps physical school records to boxes, folders, and shelf locations; tracks printed blank forms; links to digital master templates; records document requests, checkout, return, and movement history; and maintains the Property Custodian's supplies, semi-expendable property, and property, plant and equipment records. Staff should locate an authorized record without opening multiple physical boxes, identify forms and supplies that need replenishment, reconcile property-card balances with physical counts, and generate the school's required inventory forms without rebuilding spreadsheets manually.

The first release serves one school. It is an authenticated web application optimized for desktop administrative work and mobile shelf scanning. Digital document metadata does not imply that a scanned copy exists.

### Success measures

- At least 95% of active pilot boxes and folders have verified locations before rollout.
- In pilot tasks, users locate an authorized record within 30 seconds in at least 90% of attempts.
- Every stock change and physical checkout creates an attributable transaction.
- Stock never becomes negative, including during simultaneous issuance.
- Every custodial receipt, issue, transfer, adjustment, and opening balance is attributable and traceable to a reference.
- Every finalized physical-count line preserves the card balance snapshot, physical count, signed variance, unit value, and condition/remarks used in the report.
- Generated Appendix 58, Annex A.8, and Appendix 73 workbooks retain the approved source layout, column structure, report metadata, totals, and signature blocks.
- No user can access restricted records through search, exports, URLs, or QR scanning without authorization.
- All completed checkouts have an identifiable recipient, releasing officer, and return state.

## 2. Scope and release boundaries

### Included in MVP

- Administrator-provisioned accounts, authentication, roles, and restricted-record grants.
- Dashboard; category, shelf, box, folder, and document metadata management.
- Digital master template links and physical template inventory per folder.
- Immutable stock transaction history and low-stock indicators.
- Property Custodian item and acquisition-lot register for supplies, semi-expendable property, and PPE.
- Appendix 58 Stock Card ledger with receipts, issues, office, running balance, reorder point, and days-to-consume fields.
- Annex A.8 RPCSP and Appendix 73 RPCPPE physical-count sessions, variance review, signatory blocks, and source-faithful XLSX and printable/PDF output.
- Controlled preview-and-commit import for the three supplied workbook structures; generic spreadsheet import remains outside MVP.
- Document requests, release, checkout, return, and physical relocation history.
- Permission-filtered search, reports, CSV export, QR generation, and camera scanning.
- Audit history, record retirement, backups, and Docker deployment.
- User-requested extension: Admin-approved teacher/personnel leave, whole-day equipment/facility reservations and separate public availability/approved-leave calendars (FR-12).

### Later releases

- Google Drive OAuth/API access, creating Google Docs copies, mail merge, and automatic field filling.
- Scanned file uploads, OCR, full-text document-content search, and electronic signatures.
- Email/SMS reminders, purchase requests, multi-school tenancy, offline synchronization, and generic or user-designed bulk spreadsheet import.
- Configurable multistep approvals and formal records-disposal execution.
- Custom report designers and native XLSX exports beyond the three supported Property Custodian form families; ordinary MVP list exports remain CSV.

MVP is not an official retention-policy engine. Record disposal must remain outside the app until the school approves its retention and authorization rules.

## 3. Chosen technology and bootstrap

The following is the requested project bootstrap command. It is a setup input, not evidence that the application has already been scaffolded or deployed.

```bash
pnpm create better-t-stack@latest MATMS \
  --frontend next \
  --backend hono \
  --runtime bun \
  --api orpc \
  --auth better-auth \
  --payments none \
  --database postgres \
  --orm drizzle \
  --db-setup docker \
  --package-manager pnpm \
  --git \
  --web-deploy docker \
  --server-deploy docker \
  --install \
  --addons turborepo \
  --examples none
```

| Concern | Decision |
| --- | --- |
| Frontend | Next.js with TypeScript; responsive accessible tables and forms |
| Backend | Hono application running on Bun |
| API contracts | oRPC with validated inputs and outputs |
| Authentication | Better Auth; email/password; PostgreSQL persistence |
| Database | PostgreSQL with Drizzle ORM and reviewed migrations |
| Workspace | pnpm workspaces and Turborepo |
| Deployment | Separate web and server Docker images; PostgreSQL Docker service |
| UI system (required) | shadcn/ui components styled with Tailwind CSS; shared theme and reusable components across all screens |
| Client data | Typed oRPC client; query caching and invalidation appropriate to generated integration |
| QR labels | QR generation library selected during implementation |
| Scanner | Browser camera QR scanner; manual lookup fallback |
| Digital masters | Authorized HTTPS links to Google Docs, Drive, or approved PDF locations |
| Official inventory reports | Server-generated, versioned XLSX plus browser print/PDF layouts derived from the approved Appendix 58, Annex A.8, and Appendix 73 templates |
| Workbook import | Server-side parser with template detection, validation preview, row-level errors, and explicit commit; formulas and totals from uploaded workbooks are not trusted as authoritative data |
| Payments | None |

The CLI uses evolving dependencies. During implementation, inspect the generated output, record the CLI version, pin Node/Bun/pnpm and dependency versions, and commit the lockfile. Do not assume package names, scripts, adapters, or Docker files without checking the scaffold. If uppercase project naming fails validation, use `matms` for the directory/package name and retain MATMS as the product name.

Reference documentation: https://www.better-t-stack.dev/docs and https://github.com/AmanVarshney01/create-better-t-stack/tree/main/apps/web/content/docs/cli . These inform scaffold choices; all MATMS behavior below is a product requirement.

## 4. Architecture and service boundaries

Browser → HTTPS reverse proxy → Next.js web or Hono server → PostgreSQL.

Expose the application through one public origin where practical. Route `/api/auth/*` to Better Auth handlers on Hono and `/rpc/*` to oRPC. Keep the Next.js frontend responsible for presentation; the Hono service owns business validation, authorization, transactions, and database access. Server-rendered calls, if used, follow the same authorization rules.

- Public QR target: `/boxes/{uuid}`. QR payload contains only an application URL and stable identifier.
- PostgreSQL is private to the container network and is not exposed publicly.
- Better Auth manages its own authentication tables. Application roles and grants extend the authenticated identity without duplicating password handling.
- All count changes, releases, returns, relocations, and role changes are server-authoritative.
- Custodial balances, physical-count variances, report totals, and report classifications are server-authoritative. Generated workbooks are outputs, not an alternate system of record.
- Each official inventory export records the report-template version, filter/count-session snapshot, actor, timestamp, and generated-file checksum so a later template update cannot silently change a historical report.
- A failed audit/transaction write rolls back the associated business mutation.
- External master files keep their own provider permissions. MATMS does not grant access to a Google Drive file.

### Proposed monorepo responsibilities

| Logical location | Responsibility |
| --- | --- |
| `apps/web` | Next.js screens, typed client, forms, print layouts |
| `apps/server` | Hono entry point, auth routes, oRPC transport, health endpoints |
| `packages/api` | Contracts, procedures, context, authorization and domain services |
| `packages/db` | Drizzle schema, migrations, database connection, seed routines |
| `packages/auth` | Better Auth configuration and session integration |
| Shared configuration packages | Environment validation, linting, TypeScript and build settings |

This is a responsibility map; adapt it to the generated workspace rather than duplicating existing packages.

## 5. Users and access control

Accounts are provisioned by an Admin; public registration is disabled. The first Admin is established using a one-time bootstrap procedure with no committed default password. Deactivating a user revokes sessions and preserves historical attribution.

| Capability | Admin | Property Custodian | Staff | Viewer |
| --- | --- | --- | --- | --- |
| View permitted boxes, folders, documents and templates | Yes | Yes | Yes | Yes |
| Search and scan permitted box labels | Yes | Yes | Yes | Yes |
| Manage categories, shelves, boxes and folders | Yes | No | No | No |
| Create/edit document metadata | Yes | Yes | Yes | No |
| Relocate records or containers | Yes | Yes | Yes | No |
| Create/edit master templates and printed-form thresholds | Yes | No | No | No |
| Receive or issue physical template copies | Yes | Yes | Yes | No |
| Correct printed-template stock with reason | Yes | No | No | No |
| Manage custodial item master and acquisition lots | Yes | Yes | No | No |
| Record custodial receipts, issues, transfers, returns, and physical counts | Yes | Yes | Draft entry only if assigned | No |
| Correct custodial balance with reason and approval trail | Yes | Yes | No | No |
| Finalize physical-count sessions and generate official inventory forms | Yes | Yes | No | No |
| Configure form versions, classification thresholds, and default signatories | Yes | No | No | No |
| Import supported Property Custodian workbooks | Yes | Yes | No | No |
| Create and process document requests | Yes | Yes | Yes | No |
| Release and return records | Yes | Yes | Yes | No |
| Export permitted reports and print labels | Yes | Yes | Yes | No |
| View operational transaction history | All permitted | Permitted | Permitted | No |
| View system audit history | Yes | No | No | No |
| Retire records and manage lifecycle | Yes | Inventory items only within approved policy | No | No |
| Manage accounts, grants and settings | Yes | No | No | No |

### Confidentiality

Scheduling extends the matrix independently of archive grants: Admin manages employment enrollment, leave policy, closed dates and all leave decisions; Admin/Property Custodian manages resources and resource decisions. Active Admin/Property Custodian/Staff accounts can request resources and can request leave when enrolled. Viewers remain read-only. Requesters see and cancel their own requests; manager registers are restricted by domain. Anonymous access is limited to published resource availability and the separately enabled approved-leave calendar. Per the explicit user decision, approved leave display names/categories/dates are public there; pending identities, reasons, purposes and contact details remain private.

Use `internal` and `restricted` classifications. Restricted access requires an active explicit user grant to the box, folder, or document; Admin has schoolwide access. Effective restriction is inherited from every ancestor. A document grant cannot bypass a restricted parent; access must satisfy all restricted ancestors. A parent grant covers its descendants unless a descendant is independently restricted.

Roles govern actions; grants govern record visibility. Neither a folder color nor a client-side hidden button enforces security. Unauthorized objects must not appear in counts, search suggestions, exports, or QR previews. Return a generic unavailable response for inaccessible IDs to avoid disclosing record existence. Staff cannot downgrade confidentiality or grant access. Admin review is required before moving records into a less restrictive ancestry.

## 6. Core business rules

1. Internal IDs are UUIDs. Human-facing codes are unique, normalized, and editable with audit history; QR IDs remain stable.
2. Dates and timestamps are stored using appropriate database types; event timestamps are UTC and displayed in Asia/Manila. Date-only fields do not shift across time zones.
3. Categories initially include Personnel, Finance, Academic, Administrative, and Student Records. Admin may add or deactivate categories.
4. A folder belongs to one box. A document belongs to one folder. A template may have inventory in multiple template folders.
5. Box category provides the filing classification for contained records. Category changes require explicit confirmation and audit because descendant search results change.
6. Folder color is independent of template designation, urgency, and confidentiality. Suggested colors: Yellow, Blue, Red, Other.
7. Quantities and thresholds are nonnegative integers. Low stock means `count <= threshold`; out of stock means `count = 0` and takes visual priority. Default threshold is 5.
8. Digital template revisions do not silently relabel old printed copies. Inventory belongs to a specific template revision and folder.
9. Records with history are retired, not hard-deleted through normal UI. No cascading deletion of inventory, requests, transactions, or audit records.
10. Archived boxes remain searchable but cannot accept new filing or routine issue operations. Existing checkouts can be returned. Admin must reactivate a box before other inventory operations.
11. Retirement requires no outstanding loans, no active request lines, and zero remaining template inventory, or prior explicit resolution/relocation of those items.
12. Physical returns normally go back to the recorded home folder. An authorized alternative location must be recorded as a relocation in the return transaction.
13. Printed blank-form inventory and Property Custodian inventory are separate accounting domains. They may reuse transaction services, but their balances, permissions, reports, and tables must not be combined or double-counted.
14. Each custodial acquisition lot is assigned exactly one reporting class: `stock_card`, `semi_expendable`, or `ppe`. The supplied 2025 workbook convention uses PHP 50,000 and above for RPCPPE; this is an Admin-configured, effective-dated policy value that requires school/accounting confirmation and never retroactively reclassifies finalized reports.
15. Custodial running balance equals opening balance plus receipts and returns, less issues and outbound transfers, plus approved signed adjustments. Quantity cannot become negative. Unit value uses fixed-decimal currency; identifiers such as stock/property numbers remain text.
16. Physical-count variance is calculated from a frozen card-balance snapshot as `physical count - card balance`. Negative is a shortage, positive is an overage, and zero is matched. Variance value is the signed variance quantity multiplied by the line's frozen unit value. The UI and reports must show the label as well as the sign.
17. A finalized physical-count session is immutable. Corrections create a linked amendment or a new count session with an explicit reason; they never rewrite the original report snapshot.
18. Official form exports use an approved, versioned report profile. The source-faithful profile controls appendix/annex number, titles, columns, merged headers, typography, borders, page orientation, widths, totals, and signature blocks. Historical exports remain tied to the profile version used when generated.
19. Names and designations in signature blocks are generated for wet-signature printing only in MVP. MATMS does not represent a typed name as an electronic signature or approval credential.
20. Imported workbook formulas, cached totals, blank monetary values, text placeholders such as `-`, and manually entered variances are untrusted. MATMS imports validated source fields, computes its own balances and variances, and routes anomalies to review without inventing values.

## 7. Functional requirements

### FR-01 — Authentication and account administration

- Email/password login, logout, session expiry, password change, and account deactivation.
- Generic login failures, throttling, secure cookies, and server-side session checks.
- Password recovery through a configured email delivery provider. Until email is configured, provide a controlled Admin-assisted reset process that never reveals existing passwords and requires a new password at next login.
- Prevent removal/deactivation of the last active Admin.
- Idle session timeout target: 30 minutes; maximum session lifetime target: 12 hours, configurable by Admin policy and implemented server-side.

### FR-02 — Dashboard

Show permitted active boxes, folders, documents, low-stock printed-template lines, out-of-stock lines, pending requests, active loans, and overdue loans. For the Property Custodian, also show custodial items below reorder point, unresolved shortages/overages, unserviceable/not-functional lines, draft counts, reports awaiting finalization, and recent receipts/issues. Display stock per location, not an aggregate that hides a depleted folder or office. Provide links to the corresponding filtered lists and recent permitted activity. Show loading, empty, error, and retry states.

### FR-03 — Categories, shelves and boxes

- Create/edit categories and structured locations: room, shelf, rack, optional position, and human-readable label.
- Create boxes with code, category, shelf, status, notes, and confidentiality.
- Box detail lists permitted folders, documents, template stock, location, and movement history.
- Box relocation creates one container movement event; descendant effective locations update through ancestry without rewriting their histories.
- Renaming a code does not invalidate its QR URL.

### FR-04 — Folders and documents

- Folders contain code, name, color, template designation, optional urgency, confidentiality, and notes.
- Documents contain reference code, title, document date, optional covered period, keywords, description, confidentiality, optional approved digital link, and status.
- MVP tracks one physical file/item per document record. Multiple copies or volumes require separate records with distinct codes.
- Support folder relocation and document refiling with source, destination, actor, timestamp, and reason.
- Prevent moving a checked-out document; require return first. Folder/container moves retain document home ancestry and do not imply a borrowed item is physically present.
- A folder detail clearly distinguishes available, checked-out, archived, and retired records.

### FR-05 — Digital template catalog

- Store unique template code, name, description, category, revision label, revision date, digital URL, status, and optional superseded revision reference.
- One row represents one revision; revisions are immutable once physical stock exists except for audited metadata/link corrections.
- Inventory links a revision to a template folder. Enforce one inventory row per revision/folder pair.
- Validate HTTPS URLs and optionally restrict approved hosts. Do not fetch arbitrary URLs on the server.
- Open master files in a new tab with a clear external-file indicator. Users must have provider access.
- Show superseded stock separately, warn before issuance, and require an Admin-recorded decision to use or withdraw it.

### FR-06 — Physical template inventory

- Receive stock, issue copies, transfer copies, and correct balance using explicit actions.
- Quick `+1` means Receive one; quick `-1` means Issue one. Both save transactions and show the resulting balance.
- Receiving requires quantity and source/reason. Issuing requires quantity and purpose, plus requester/reference if applicable.
- Balance correction is Admin-only, requires a reason, records before/after and signed delta, and cannot erase prior transactions.
- Transfer between folders is atomic: debit source, credit destination, and connect both ledger entries with one operation ID. Only the same template revision can be transferred.
- Persist balance and ledger in one database transaction with conditional update or row locking. Never use an unguarded read-modify-write.
- Each mutation has a client operation ID for idempotency. Retrying the same operation returns the original result; reusing its ID with a different payload is rejected.
- Keep the last confirmed balance visible while a mutation is pending; do not present a changed count or success until the server confirms the commit. On failure or conflict, preserve form input, refresh authoritative counts, and explain the issue. Counts refresh after every confirmed mutation.
- Dashboard/list warnings are derived from the saved balance and local threshold; email alerts are deferred.

### FR-07 — Document requests, release and return

Requests are entered by Admin/Property Custodian/Staff on behalf of a requester; a public requester portal is outside MVP. Store requester name, optional office/contact, purpose, request type (`inspect`, `borrow`, `copy`), requested items, and notes. Collect only necessary personal data.

Request lifecycle: `draft → submitted → approved | rejected | cancelled`; approved requests become `in_progress` after first fulfillment and `completed` after all required fulfillment and returns. Cancellation applies only to unfulfilled items; fulfilled items retain their history. Rejections require a reason.

For mixed line decisions, the request stays submitted while a decision is pending. After decisions, it is approved if any work is approved and none is fulfilled; it is in progress after fulfillment while work or custody remains open; and it is completed once all approved work and loans are resolved. All-rejected and all-cancelled requests use those respective statuses; a mixture of rejected and cancelled lines with no approved work is completed. Admin exception resolution records a disposition and notes without implying disposal or write-off authority. A resolved item with no recorded physical return remains unavailable for another loan; a later return records its receiver and condition without reopening the request.

- Each request has one or more document lines. Track each line as pending, approved, rejected, cancelled, fulfilled, or loan-active/returned through associated checkout records.
- Request approval and release are distinct actions. Authorized Admin/Property Custodian/Staff can approve ordinary records; restricted-record requests require Admin approval and releaser access.
- Borrowing requires recipient acknowledgement, releasing officer, released timestamp, and due date. A document can have only one open checkout.
- Inspect/copy fulfillment does not create a loan; it records who fulfilled the line and when. If the original leaves custody, use Borrow instead.
- Returns record receiver, timestamp, condition, and home/alternative folder. A repeated return cannot close the same loan twice.
- A loan is overdue when open and past its due timestamp; overdue is computed, not a manually maintained status.
- Outstanding loans block record retirement. Lost/damaged items remain unresolved exceptions until Admin records a resolution and supporting notes; history remains intact.

### FR-08 — Search, filters and reporting

- Debounced, server-side search across codes, titles, folder names, permitted metadata keywords, and template names; no scanned-content search in MVP.
- Filters: category, shelf, box lifecycle, confidentiality within authorized scope, printed-template stock status, custodial classification, report section, fund cluster, condition/serviceability, reorder status, variance status, physical-count status, template revision status, request status, and date range as applicable.
- Default 25 rows per page, maximum 100, deterministic sorting, persisted filters in the URL, and reset action.
- Results show breadcrumb location and availability. Auth-filtered counts use the same scope as results.
- Reports: box/folder inventory, document register, printed-template balances, printed-template ledger, custodial item/lot register, Appendix 58 Stock Card, Annex A.8 RPCSP, Appendix 73 RPCPPE, physical-count variance, condition/serviceability, acquisition/source, active/overdue loans, request history, and relocation history.
- Export ordinary filtered lists as authorized CSV with generated timestamp, filter summary where practical, UTF-8 encoding, and correctly escaped fields. Generate the three official inventory form families as versioned XLSX and print/PDF under FR-11. Neutralize spreadsheet formula injection in text cells and audit every export with actor, scope, profile version where applicable, and row count.

### FR-09 — QR generation, printing and scanning

- Generate a QR URL from a configured canonical application origin and the box UUID.
- A4 print view supports selecting boxes and shows box code, category, shelf label, QR, and printed date. Provide a single-label layout; printer-specific calibration is configurable rather than assumed.
- Labels contain no confidential document titles. Codes are references, not credentials.
- QR scanning requires HTTPS camera access; handle denied permission, unavailable camera, invalid code, and unsupported browser.
- Restrict automatic navigation to recognized app-origin box URLs. Offer manual box-code entry as fallback.
- Login preserves a validated local return path so an authorized user can continue to the scanned box.

### FR-10 — Audit and lifecycle

Audit creates, edits, role/grant changes, stock operations, approvals, releases, returns, relocations, exports, and retirement. Record actor, action, entity, timestamp, correlation ID, and relevant redacted before/after fields. Never log passwords, cookies, session tokens, or unnecessary document contents. Audit records are append-only through the application; database administration is a separate privileged boundary.

Retirement hides records from default operational lists while preserving search filters and history. Physical disposal requires a later approved workflow; an Admin may record a pre-existing disposal event with authority reference and date only after the school's procedure has been agreed. Do not ship a generic destructive Dispose button.

### FR-11 — Property Custodian Inventory

This module is the operational system of record for the school Property Custodian. It covers the complete field structure and report behavior represented by the supplied Appendix 58 Stock Card, Annex A.8 RPCSP, and Appendix 73 RPCPPE workbooks. It does not replace formal accounting policy, procurement, inspection and acceptance, or disposal authorization.

#### Item, lot, and report classification

- Maintain a reusable item master with item/stock code, article, description, unit of measurement, reorder point, default report section, active status, and notes.
- Maintain one or more acquisition/property lots per item. A lot stores reporting class, property or semi-expendable property number, unit value, supplier/source, acquisition date or approved year label, fund cluster, accountable officer, current office/location, condition/serviceability, remarks, and lifecycle.
- Preserve codes as text, including leading zeros, embedded hyphens, and year-like identifiers. Duplicate nonblank property/semi-expendable numbers are rejected unless an Admin records and resolves an approved exception.
- Seed, but do not hard-code, the report types and sections found in the supplied files:
  - RPCPPE: Land (School Site), School Buildings, and Other Structures.
  - RPCSP: IT and Office Equipment; Other Equipment; Classroom Furniture and Fixtures; Laboratory/ICT Furniture and Fixtures; Administration Furniture and Fixtures; Science Equipment/Supplies; Math Supplies/Equipment; Sports Supplies/Equipment; Emergency Supplies/Equipment; Clinic and Isolation Supplies/Equipment; and Other Supplies/Equipment.
- Admin may add or deactivate sections and map them to a form profile. A section change after a finalized count affects future sessions only.
- Show missing unit value, stock/property number, unit, supplier/year when required by the selected form, and inconsistent classification as explicit data-quality issues. A missing value remains unavailable; it is not converted to zero.

#### Receipts, issues, transfers, returns, and adjustments

- Record opening balance, receipt, issue, return, transfer, and adjustment through explicit actions. Each action requires transaction date, quantity, reference, actor, operation ID, and a type-specific source, destination office, or reason.
- The stock-card issue workflow records the receiving office. `No. of Days to Consume` is an optional nonnegative integer attached to the applicable issue/consumption entry because it is a source-form field, not a replacement for the transaction date.
- A transfer is atomic and produces linked debit and credit entries. It cannot change the item, lot, reporting class, or unit of measurement.
- Adjustments require before/after balances, signed delta, reason, and an audit entry. They do not delete or edit earlier ledger rows.
- Use the same idempotency, conditional update/locking, pending-state, refresh, and conflict behavior required by FR-06. The server rejects any issue or transfer that would produce a negative balance.
- Derive reorder status from the saved balance and effective reorder point. Reorder point zero is valid; blank means no threshold configured.

#### Appendix 58 Stock Card

- Generate a card for one item and fund cluster with Entity Name, Fund Cluster, Item, Stock No., Description, Re-order Point, and Unit of Measurement.
- Render the seven-column ledger in this order: Date; Reference; Receipt Qty.; Issue Qty.; Office; Balance Qty.; and No. of Days to Consume.
- Calculate balance chronologically from the verified opening balance and ledger. Back-dated entries require confirmation and recalculate all later balances in the same transaction; finalized historical report snapshots remain unchanged.
- Default source-faithful presentation is the provided Appendix 58 structure: portrait page, Times New Roman typography, centered `STOCK CARD` title, right-aligned appendix label, two-row merged ledger headers, bordered blank/data rows, and no application navigation in print.
- A card may span pages. Repeat the ledger header on later pages, display `Page x of y`, and carry forward the preceding balance without inserting a fake receipt or issue.

#### Physical-count sessions

- Create a session with form family, report type/section scope, as-of date, entity/school, fund cluster, accountable officer and designation, accountability-assumed date, Property Custodian, inventory committee chair/members, School Head, and form-profile version.
- Starting a session snapshots each included lot's card balance, unit value, reporting identifiers, supplier/year where applicable, and current condition. Later master-data edits do not alter the draft snapshot without an explicit refresh that records what changed.
- Count entry supports physical quantity, condition/serviceability, remarks, and reviewer note. Save drafts per line, show uncounted lines separately, and prevent finalization until every included line is counted, excluded with reason, or marked unavailable with reason.
- Calculate signed variance quantity and value on the server. Show separate Matched, Shortage, and Overage states. Imported or typed variance values never override the calculation.
- Provide section and report totals for card quantity, physical quantity, shortage quantity/value, overage quantity/value, and recorded unit value where the approved form requires it. Do not sum identifiers, years, or rates.
- Finalization records the finalizer and timestamp, locks all lines, and creates an immutable report snapshot. Reopening is not allowed; an amendment references the prior session and explains the correction.

#### Annex A.8 RPCSP output

- Generate the report title `REPORT ON THE PHYSICAL COUNT OF THE SEMI-EXPENDABLE PROPERTY`, selected property type, as-of date, fund cluster, and accountable-officer statement.
- Preserve the ten-column A:J structure in this order: Article; Description; Semi-expendable Property No.; Unit of Measure; Unit Value; Balance per Property Card; On Hand per Count; variance group with Quantity and Value; and Remarks.
- The source-faithful 2025 profile preserves the visible source label `SHORTAGE/COVERAGE`; a future corrected label must be a separately approved profile version. Regardless of label, the underlying value follows the signed shortage/overage rule in Section 6.
- Preserve grouped article/section labels, wrapped descriptions and remarks, currency formatting, total rows, `Certified Correct by` and `Noted by` areas, Property Custodian designation, two inventory committee name/signature blocks, and School Head block.
- Default to A4 landscape, fit to one page wide, source-equivalent Arial Narrow/Calibri sizing, centered merged title rows, multi-row column headers, and bordered detail rows. Long reports paginate vertically and repeat the full column header.

#### Appendix 73 RPCPPE output

- Generate the report title `REPORT ON THE PHYSICAL COUNT OF PROPERTY, PLANT AND EQUIPMENT`, selected PPE type, as-of date, fund cluster, accountable-officer statement, and appendix label.
- Preserve the twelve-column A:L structure in this order: Article; Description; Property Number; Unit of Measure; Unit Value; Quantity per Property Card; Quantity per Physical Count; shortage/overage Quantity; shortage/overage Value; Supplier; Year Acquired; and Remarks.
- Preserve grouped article labels, wrapped details, currency formatting, total/grand-total rows, the same certification/noting/signature structure, and the source note for the effective PPE threshold when enabled by the report profile.
- Default to A4 landscape, fit to one page wide, source-equivalent Arial Narrow/Calibri sizing, centered merged title rows, three-row quantity/variance headers, and bordered detail rows. Long reports paginate vertically and repeat the full column header.

#### Report generation, preview, and fidelity

- Provide a browser preview before generation. Preview shows template version, report scope, excluded/error lines, page count estimate, totals, signatories, and whether the output is ready.
- Generate both `.xlsx` and print/PDF output from the same immutable report snapshot. XLSX cells use typed dates, numbers, and currency; formulas may be included for transparent totals, but server-computed values remain authoritative and are verified before delivery.
- Provide an Export Excel (.xlsx) action with preview, generation progress, authorized file download, safe retry and export history. Default full RPCPPE export produces one workbook with `RPCPPE_LAND`, `RPCPPE_BLDG`, and `RPCPPE_OTHERBLDG`; default full RPCSP export produces one workbook with `RPCSP_IT EQPMNTS`, `RPCSP_F&F`, and `RPCSP_ OTHERSUPPLIES`, in source order. Retain empty formatted sheets; explicitly requested partial exports must be identified as partial. Appendix 58 exports the selected item's `SC` sheet.
- Match the approved source forms' merged cells, title hierarchy, column order and widths, row wrapping, borders, page orientation, A4 sizing, total placement, signature blocks, and appendix/annex labels. Do not copy source defects such as inconsistent formulas, accidental blank totals, or incorrect manually entered variances.
- Generate detail rows dynamically from the selected authorized item/lot or ledger snapshot, rather than copying a fixed source item list or row limit. Adding eligible items expands new reports and explicitly refreshed drafts; rebuild section merges, formula ranges, totals, pagination, print areas, and signature positions for the actual included rows. Finalized historical report membership and values remain unchanged.
- Keep report layout profiles separate from business data. Updating a profile requires Admin access, a version note, visual regression approval, and a new effective version; it cannot rewrite prior exports.
- Audit every preview-to-export action with actor, count session or item/card scope, profile version, file type, row count, and checksum. Generated files contain no hidden unrelated records or formulas that reference external workbooks.

#### Controlled workbook import

- Accept only `.xlsx` for RPCSP/RPCPPE and `.xls` or `.xlsx` for Appendix 58 in the supported importer. Detect the form from required title/header text rather than relying only on the sheet name.
- Support all supplied workbook sheet structures, including multiple RPCSP/RPCPPE sections in one workbook. Ignore title, subtotal, total, note, and signature rows as records while preserving their metadata for the import preview.
- Import in two stages: upload/parse/preview, then explicit commit. Preview shows target form, sheet, source row, mapped values, proposed item/lot, duplicates, missing fields, formula cells, warnings, and blocking errors.
- Read displayed source values for candidate fields but never execute macros, external links, or uploaded formulas. Recalculate balances, variances, and totals inside MATMS. Store source filename, sheet, row, import batch, actor, and timestamp for traceability.
- Require the operator to resolve duplicates, text placeholders in numeric fields, invalid years/dates, missing unit values, and contradictory balance/count/remarks before commit. The operator may leave a permitted field unavailable with a reason; the system must not guess.
- Committed opening quantities create attributable opening-balance transactions. Imported physical-count values create a draft count session and never silently adjust the live ledger.
- A failed row does not partially commit unnoticed. Use an all-or-nothing batch by default; an explicitly selected valid-row commit must list excluded rows and create a downloadable error report.

#### Workbook-to-feature traceability

| Supplied source | Source structure retained | MATMS behavior added around it |
| --- | --- | --- |
| Appendix 58 Stock Card | Entity/fund/item metadata; Date, Reference, Receipt, Issue, Office, Balance, and Days to Consume; portrait merged-header layout | Transactional ledger, nonnegative balance, reorder status, back-date recalculation, per-item history, source-faithful XLSX/print |
| RPCSP 2025 workbook | Annex A.8 header; A:J fields; grouped semi-expendable sections; totals; Property Custodian, committee, and School Head blocks; landscape layout | Item/lot register, draft counts, computed signed variance/value, condition review, immutable finalization, all supplied sections, controlled import and export |
| RPCPPE 2025 workbook | Appendix 73 header; A:L fields including supplier and year acquired; Land, School Buildings, and Other Structures; totals, notes, and signatories; landscape layout | PPE classification, acquisition metadata, count snapshots, computed signed variance/value, threshold profile, immutable finalization, controlled import and export |

### FR-12 — Leave and resource booking extension (2026-11-04)

Request CRUD includes audited edits to future pending/approved leave and reservations by owners or the relevant manager. Recheck the complete new range and current eligibility, atomically replace holds, and require approval again. Edits preserve original creation intent and have durable replay/expected-version protection. Removal uses cancellation/retirement with history retained; past and terminal requests cannot be rewritten. See spec 14 for the update contract.

The requested extension adds teacher/personnel leave requests for dates or inclusive date ranges, equipment/facility reservations, and a public availability calendar. See [spec 14](context/feature-specs/14-leave-and-resource-bookings.md) for the contract and pending school policy choices. Employment categories are separate from authorization roles. Requests and decisions are authenticated and audited; public responses contain only explicitly published resource availability and a separate opt-in calendar of approved leave names/dates. Reservations do not change stock, count snapshots or physical custody. Leave opens only after explicit Admin configuration; publication is opt-in. No leave entitlement, payroll, recurring booking or notification policy is inferred.

## 8. Data model and integrity

All application tables use UUID primary keys unless stated otherwise. Mutable tables include created/updated timestamps and actor references where appropriate. Better Auth table names and identifier types follow the generated adapter; application user foreign keys must match those types.

| Table | Principal fields and relationships |
| --- | --- |
| Auth tables | Generated Better Auth users, sessions, accounts, verification records |
| user_profiles | user_id unique FK, role enum including property_custodian, active flag, must_change_password |
| access_grants | user_id, exactly one box_id/folder_id/document_id, granted_by, timestamps |
| categories | unique code, name, active |
| shelf_locations | unique code, room, shelf, rack, position, label, active |
| boxes | unique box_code, category_id, shelf_location_id, lifecycle, confidentiality, notes |
| folders | unique folder_code, box_id, name, color, is_template_folder, urgency, confidentiality, lifecycle |
| documents | unique document_code, folder_id, title, document_date, period, keywords, description, digital_url, confidentiality, lifecycle |
| templates | unique revision-specific template_code, template_family_code, revision_label, name, category_id, digital_url, status, supersedes_id |
| template_inventory | template_id, folder_id, count, threshold, version; unique(template_id, folder_id) |
| stock_operations | unique operation_id, actor_id, operation_type, reason, request_id optional, payload fingerprint |
| stock_transactions | operation_id, inventory_id, delta, balance_before, balance_after, timestamp; append-only |
| custodial_report_sections | unique code, form_family, name, display_order, active, effective dates |
| custodial_items | unique normalized item/stock code, article, description, unit, reorder_point nullable, default_section_id, active, notes |
| custodial_lots | item_id, reporting_class, property_number nullable, unit_value nullable, supplier/source nullable, acquired_on/year_label nullable, fund_cluster, accountable_officer, office/location, condition, remarks, lifecycle, version |
| custodial_operations | unique operation_id, actor_id, operation_type, transaction_date, reference, reason/source/office as applicable, payload fingerprint, timestamp |
| custodial_transactions | operation_id, item_id, lot_id nullable, location/office, signed delta, balance_before, balance_after, days_to_consume nullable, timestamp; append-only |
| physical_count_sessions | unique code, form_family, section scope, as_of_date, report metadata, profile_version_id, status, created/finalized/amended attribution |
| physical_count_lines | session_id, lot_id, frozen identifiers/card balance/unit value/supplier/year/condition, physical_count, calculated variance quantity/value, remarks, disposition; unique(session_id, lot_id) |
| inventory_report_profiles | form_family, version, effective dates, titles/labels, layout settings, threshold note, active; immutable after use |
| inventory_report_signatories | profile/session, role, name, designation, display_order; session values are frozen snapshots |
| inventory_import_batches | source filename/hash, detected form, actor, status, summary, committed_at |
| inventory_import_rows | batch_id, sheet, source_row, raw/mapped data, validation status, target IDs, warning/error details |
| inventory_report_exports | item/card or count_session scope, profile version, actor, format, row count, checksum, generated_at |
| document_requests | unique request_code, requester, office/contact optional, purpose, type, status, created_by, approved_by, decision timestamps/reason |
| request_items | request_id, document_id, line_status, fulfillment metadata; unique(request_id, document_id) |
| document_checkouts | request_item_id, document_id, recipient, released_by/at, due_at, returned_by/at, condition, resolution fields |
| movement_events | exactly one box/folder/document target, source/destination references or snapshots, actor, reason, timestamp |
| audit_logs | actor_id, action, target_type/id, redacted before/after JSON, correlation_id, timestamp |
| school_settings | school name, timezone, canonical URL, policy settings; secrets excluded |

### Required database controls

- CHECK constraints for count/threshold >= 0, valid signed ledger arithmetic, due_at >= released_at, and valid return chronology.
- Foreign keys with restricted deletion for operational/history records.
- Partial unique index on document_checkouts(document_id) for unresolved open loans.
- Unique normalized box, folder, document and revision codes; codes are never reused after retirement.
- Unique active grant per user/target and an exactly-one-target constraint.
- Index common category, location, foreign-key, status, timestamp, and search paths; assess PostgreSQL full-text or trigram indexing against pilot data before adding complexity.
- Stock transaction pair and balance updates occur in one transaction. Concurrency conflicts return a typed retryable error.
- Custodial item and lot quantities, reorder points, physical counts, and days-to-consume are nonnegative integers; unit values and variance values use fixed-precision decimal types. Do not use floating point for currency.
- Custodial ledger arithmetic is enforced so `balance_after = balance_before + delta` and balance_after is nonnegative. Transfers and their audit entry commit atomically.
- A nonblank normalized property/semi-expendable number is unique within the approved school/fund scope unless an active, documented exception exists. Blank identifiers remain allowed only when the form/profile permits them and are reported as a data-quality issue.
- Physical-count line uniqueness, frozen snapshot fields, server-calculated variance, and finalization immutability are enforced in the database/service boundary. A finalized session cannot be updated in place.
- Report-profile versions referenced by a session/export cannot be deleted or edited. Signatory and report metadata are copied into the session snapshot before finalization.
- Import batch commits are atomic by default and idempotent by source hash plus operator-confirmed batch identity. Re-uploading the same workbook warns before any duplicate opening balances are created.
- Container ancestry is the source of effective location; movement snapshots preserve historical labels.
- Seed data is fictional and contains no real student/personnel data or default production credentials.

## 9. API contract and errors

Use oRPC procedures grouped by domain. All procedures validate inputs, check session/account status, enforce role and object scope, and return typed outputs. Pagination and export endpoints must enforce limits server-side.

| Router | Representative procedures |
| --- | --- |
| dashboard | summary, recentActivity |
| categories / locations | list, create, update, deactivate |
| boxes | list, get, create, update, relocate, archive, reactivate, retire, labelData |
| folders | list, get, create, update, relocate, retire |
| documents | list, get, create, update, refile, retire |
| templates | list, get, createRevision, updateMetadata, supersede |
| templateInventory | list, receive, issue, transfer, correctBalance, ledger |
| custodialInventory | listItems, getItem, createItem, updateItem, createLot, receive, issue, return, transfer, adjust, ledger, stockCard |
| physicalCounts | list, create, addOrRefreshLines, saveCount, excludeLine, validate, finalize, amend, previewReport |
| inventoryImports | detect, preview, validateRows, commit, errorReport |
| inventoryReports | stockCardXlsx, stockCardPrint, rpcspXlsx, rpcspPrint, rpcppeXlsx, rpcppePrint, exportHistory |
| requests | list, get, create, submit, approveLines, rejectLines, cancelLines, fulfill |
| checkouts | list, release, return, recordException, resolveException |
| search / reports | globalSearch, inventory, lowStock, loans, movements, exportCsv |
| admin | users, deactivateUser, changeRole, grantAccess, revokeAccess, auditLog, settings |

Mutation payloads include expected version where needed and an operation ID for stock/release/return/transfer/import-commit actions. Return standard codes such as UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, VALIDATION_ERROR, CONFLICT, INSUFFICIENT_STOCK, ACTIVE_LOAN, COUNT_FINALIZED, IMPORT_BLOCKED, REPORT_NOT_READY, and RATE_LIMITED. Map internal errors to safe user messages and log a correlation ID.

Authorization filters must be applied before pagination and aggregation, not after retrieving a page. Client input never supplies the authoritative actor identity or resulting stock balance.

## 10. Screens and navigation

Primary navigation: Dashboard, Boxes, Documents, Templates, Property Inventory, Requests & Loans, Reports. Admin additionally sees Users & Access, Audit Log, and Settings.

| Route | Main purpose |
| --- | --- |
| `/login` | Sign in and safe post-login continuation |
| `/dashboard` | Operational summary and action queues |
| `/boxes` and `/boxes/[id]` | Box register, location, contents, history, labels |
| `/folders/[id]` | Documents and inventory within one folder |
| `/documents` and `/documents/[id]` | Metadata, availability, requests, movement history |
| `/templates` and `/templates/[id]` | Master revisions and stock by folder |
| `/template-inventory` | Replenish, issue, transfer, correct, and inspect the printed blank-form ledger; `/inventory` may redirect here for backward compatibility |
| `/property-inventory` | Custodial item/lot register, filters, balances, reorder and data-quality states |
| `/property-inventory/items/[id]` | Item metadata, acquisition lots, condition, balance, transactions, and stock-card action |
| `/property-inventory/stock-cards/[itemId]` | Appendix 58 ledger preview and XLSX/print generation |
| `/property-inventory/counts` and `/property-inventory/counts/[id]` | Create, enter, review, validate, finalize, and amend physical counts |
| `/property-inventory/reports` | Annex A.8, Appendix 73, variance, condition, acquisition, and export history |
| `/property-inventory/imports` and `/property-inventory/imports/[id]` | Supported workbook detection, mapping preview, errors, and commit |
| `/requests` and `/requests/[id]` | Request entry and fulfillment |
| `/loans` | Active, overdue, returned and exception loans |
| `/scan` | Camera scanning and manual code lookup |
| `/labels` | Authorized print selection and print preview |
| `/reports` | Filters, summaries, CSV exports |
| `/admin/*` | Users, grants, locations, categories, inventory form profiles/sections/signatories, audit and settings |

Use readable badges with text/icons as well as color. Mobile tables become compact cards or horizontal scroll regions with accessible actions. Provide descriptive confirmation for retirement, permission changes, and balance corrections. Failed submissions retain user input; no successful-looking count change is shown without server confirmation.

### Required UI system — shadcn/ui

Use **shadcn/ui as the standard component system** for the Next.js frontend. This is a required implementation decision, not an optional recommendation. Preserve the requested Better T Stack command; inspect the generated frontend and initialize or extend its shadcn/ui setup only where needed.

- Keep shared UI components in the frontend's configured component directory (for example, `apps/web/src/components/ui`) or an existing shared UI package. Follow the scaffold's aliases and avoid duplicate component copies.
- Use shared Tailwind/CSS theme tokens for school branding, typography, spacing, border radius, focus states, and semantic status colors. Default to a clean, readable light theme suitable for administrative work; dark mode is optional.
- Compose domain-specific components such as StockStatusBadge, LocationBreadcrumb, InventoryActions, and RecordPicker from the shared UI primitives.
- Do not introduce another general-purpose UI framework without a documented need. Specialized scanner, QR, and table-behavior libraries may complement shadcn/ui.

| Interface area | Required component approach |
| --- | --- |
| Application shell | Sidebar, Sheet for mobile navigation, Breadcrumb, Dropdown Menu |
| Dashboard | Card, Badge, Skeleton, and accessible Alert messages |
| Registers and reports | Table-based data table composition with server-side sorting/filtering/pagination, Checkbox selection, Pagination, and Dropdown Menu row actions |
| Search and filters | Input, Select, Popover/Command for searchable record selectors, and Button to reset filters |
| Forms | Shared field/label/error patterns using Input, Textarea, Select, Checkbox, and date controls as needed; connect validation to server errors |
| Create/edit workflows | Dialog on desktop or responsive Sheet where appropriate; longer workflows use dedicated pages |
| Sensitive confirmations | Alert Dialog for retirement, account deactivation, and stock balance corrections |
| Detail screens | Tabs, Separator, Badge, and structured metadata sections |
| Property inventory register | Server-side Table composition, Classification/Condition/Variance badges, Command-based item picker, filter Sheet on mobile, and Dropdown Menu actions |
| Physical count entry | Sticky multi-row table header on desktop, compact per-line cards on mobile, numeric count input, condition Select, autosaved draft indicator, validation summary, and explicit Finalize Alert Dialog |
| Official form preview | Read-only paginated preview with profile/version banner, warning Alert, page navigation, and separate Generate XLSX and Print/PDF actions |
| Workbook import | Step-based page using file Input, mapping Table, blocking-error Alert, row status badges, explicit commit confirmation, and downloadable error report |
| Feedback | Sonner notifications for action results; inline errors and Alert for issues requiring persistent attention |
| Loading and empty results | Skeleton placeholders and reusable empty-state content with clear next actions |

The data table is a composed feature, not an assumption of a standalone shadcn/ui grid. It must retain the existing server-side pagination, authorization, search, and export requirements. QR labels use a dedicated print layout with navigation and interactive controls hidden in print.

Accessibility must be verified in the assembled screens: keyboard navigation, visible focus, screen-reader labels, dialog focus return, associated form errors, and text alongside status colors. Disable duplicate submissions during mutations and preserve the existing server-confirmed stock behavior.

## 11. Non-functional and operational requirements

### Performance and reliability

Initial design capacity: 500 boxes, 5,000 folders, 50,000 document records, 2,000 printed-template inventory lines, 10,000 custodial item/lots, 250,000 custodial ledger rows, 100 physical-count sessions, and 20 concurrent users. These are sizing assumptions, not current school counts.

- Under representative load, p95 list/search API responses <= 500 ms excluding network; initial key-screen usable content <= 1.5 seconds on the agreed school-network test profile.
- Search queries debounce around 300 ms; expensive exports may stream and must have a documented row limit and narrowing guidance.
- Generate a 2,000-line RPCSP/RPCPPE workbook and print preview within 30 seconds on the agreed deployment profile, or process it as a visible queued job with progress, failure reason, and safe retry. A retry must not create a second finalized report record for the same operation ID.
- Workbook import parsing is bounded by configured file size, sheet count, row count, and processing time. Reject encrypted, macro-enabled, malformed, or unexpectedly structured files with a safe explanation.
- Use transactional writes, bounded retries, connection pooling, request timeouts, and graceful shutdown.
- Health endpoints expose liveness and readiness without sensitive configuration; readiness checks database reachability.

### Security and privacy

- HTTPS, secure HTTP-only session cookies, explicit trusted origins, CSRF protections appropriate to Better Auth and cookie-authenticated mutations, and restrictive CORS if separate origins are used.
- Rate-limit login, recovery, exports, and repeated mutations. Validate URLs and sanitize user-rendered content.
- Server-side authorization covers all procedures and report/print endpoints. Do not expose database credentials to the browser.
- Inventory XLSX/print exports and import error reports use the same role and school scope as the on-screen records. Temporary generated files expire under a documented policy and are not placed in a public bucket.
- Parameterized Drizzle queries; raw SQL only with parameters. Keep secrets out of git, images, logs, and client bundles.
- Production access is restricted to authorized school users. The school must approve data classification, requester-data retention, export handling, and any cloud hosting before importing real records.
- MVP stores metadata and links; provider permissions remain independently managed.

### Accessibility and compatibility

Target WCAG 2.2 AA for key workflows, including keyboard operation, labels, focus handling, error messages, contrast, and non-color indicators. Validate desktop Chrome/Edge and mobile Chrome/Safari against the school's actual devices. Scanner failure must never block manual lookup.

### Backups and maintenance

Initial operational targets: daily encrypted database backups, 30-day rolling retention, recovery point <= 24 hours, recovery time <= 4 hours during staffed support. These are proposed operational targets, not a purchased SLA. Store backups separately from the database host, restrict restore privileges, and run a restore rehearsal before launch and at least quarterly. Database volumes are persistent storage, not backups.

## 12. Docker deployment and configuration

Maintain development and production configuration separately. Production Compose should include reverse proxy/TLS, Next.js web, Bun/Hono server, PostgreSQL, persistent database volume, health checks, restart policies, and a controlled backup process.

- Build web and server images separately using reproducible multi-stage builds and the pnpm lockfile. Run processes with least privilege.
- Bun is the selected API runtime; confirm the generated Next.js image's supported runtime rather than forcing Bun into every container.
- Run reviewed Drizzle migrations as a controlled one-shot release task before application rollout; do not run competing migrations in every replica or use schema push in production.
- The user-authorized automatic release workflow checks `main` on isolated CI, publishes immutable images only after checks pass, then deploys through Coolify with a pre-migration encrypted backup and verified runtime revisions. Preserve production secrets, accounts and volumes; automation alone does not establish uninterrupted availability.
- Internal DB access uses the Compose service hostname, not localhost. Browsers use the public app origin, not internal service names.
- Keep PostgreSQL private. Protect secrets through deployment secret management or host-controlled environment files.
- Health checks, structured logs, error monitoring, disk/backup alerts, and rollback instructions are required.
- Development database Docker setup and generated Docker deployment files are starting points; verify they cover production TLS, backup, migrations, and persistence.

Logical configuration includes DATABASE_URL, Better Auth secret/base URL, trusted origins, public app origin, ports, and optional mail credentials. Actual variable names follow generated environment validation. Public variables contain no secrets. Changing the canonical origin requires a QR-label redirect/reprint plan.

## 13. Acceptance criteria

| ID | Scenario and pass condition |
| --- | --- |
| AC-01 | An anonymous box QR scan reaches login and returns to the same box after authorized sign-in. |
| AC-02 | A Viewer attempting a write through direct API access receives a denial and no data changes. |
| AC-03 | An ungranted Staff user cannot discover restricted records through search, dashboard counts, exports, or guessed IDs. |
| AC-04 | Changing a box code preserves the original UUID QR URL and records the old/new code. |
| AC-05 | Issuing two copies from six leaves four and creates one attributable ledger operation; a threshold of five shows Low stock. |
| AC-06 | At a count of five and threshold five the line is Low stock; zero displays Out of stock. |
| AC-07 | Two simultaneous requests to issue four from a balance of five produce at most one success; the balance never becomes negative. |
| AC-08 | Retrying an operation after a response timeout does not double-issue stock or duplicate a release/return. |
| AC-09 | Transferring three copies either debits and credits both locations with linked history or changes neither. |
| AC-10 | A stale Admin balance correction is rejected with refreshed state rather than overwriting a newer issue. |
| AC-11 | Two concurrent releases of one document create at most one open loan. |
| AC-12 | A partial request remains in progress until remaining lines are resolved and all borrowed items are returned/resolved. |
| AC-13 | Returning a document records its receiver and condition, closes the loan once, and preserves request history. |
| AC-14 | Relocating a box updates descendant effective shelf locations and preserves the source location in movement history. |
| AC-15 | Retiring a box with unresolved loans or template stock is blocked with actionable reasons. |
| AC-16 | Camera denial still allows manual lookup; an external QR URL never auto-navigates. |
| AC-17 | CSV export respects filters and access scope; formula-like text cannot execute as a spreadsheet formula. |
| AC-18 | Account deactivation invalidates access and sessions while past transactions still identify the actor. |
| AC-19 | A4 labels are readable and scan successfully from printed samples on actual school devices. |
| AC-20 | A clean environment restores the backup and can log in, find records, and reconcile stock against the ledger. |
| AC-21 | All core screens use the shared shadcn/ui theme and components; navigation, forms, tables, dialogs, loading, and feedback are consistent on desktop and mobile. |
| AC-22 | Core forms and dialogs support keyboard-only operation, labeled validation errors, visible focus, and correct focus return after closing. |
| AC-23 | A Property Custodian records an opening balance of 10, receives 5, issues 3 to an office, and sees an Appendix 58 running balance of 12 with all references and actors preserved. |
| AC-24 | Two simultaneous custodial issues of four from a balance of five produce at most one success; the saved balance and all generated stock cards remain nonnegative and consistent with the ledger. |
| AC-25 | An item with balance equal to its reorder point shows Reorder; a blank reorder point shows no alert; zero remains a valid configured reorder point. |
| AC-26 | A physical-count line with card balance 10, physical count 8, and unit value PHP 1,250 produces variance quantity -2, status Shortage, and variance value PHP -2,500. The user cannot override either calculated value. |
| AC-27 | Finalizing a count freezes its lines, metadata, unit values, signatories, and form-profile version. A correction creates a linked amendment and leaves the first report reproducible. |
| AC-28 | The generated Appendix 58 file and print view contain the seven source columns in order, portrait merged-header structure, item metadata, chronological ledger, running balance, and repeated header/carry-forward behavior when paginated. |
| AC-29 | The generated Annex A.8 RPCSP contains the A:J source columns in order, selected grouped sections, computed quantity/value variance, total and signature blocks, and A4 landscape source-equivalent styling. |
| AC-30 | The generated Appendix 73 RPCPPE contains the A:L source columns in order, supplier and year acquired, computed quantity/value variance, total/note/signature blocks, and A4 landscape source-equivalent styling. |
| AC-31 | Visual regression comparison against approved golden files confirms title rows, merged headers, widths, wrapping, borders, orientation, totals, and signature placement for all three form families within the documented tolerances. |
| AC-32 | Importing each supplied workbook detects every relevant sheet and section, previews mapped rows with source coordinates, excludes headings/totals/signatures as records, and blocks unresolved duplicate or invalid required values. |
| AC-33 | Formula cells and cached spreadsheet totals do not control imported balances or variances. MATMS recalculates them and identifies a source mismatch without silently changing the live ledger. |
| AC-34 | Committing an imported physical count creates a draft count session only. It does not alter inventory until an authorized user performs a separately audited adjustment or transaction. |
| AC-35 | A Staff user without the Property Custodian capability cannot finalize counts, adjust custodial balances, import a workbook, or generate official inventory forms through either UI or direct API calls. |
| AC-36 | Updating a form profile creates a new version; a previously finalized/exported session still regenerates byte-equivalent data and source-equivalent layout from its original version. |
| AC-37 | Admin configures separate daily teacher/personnel limits and enrollment. A date/range leave request atomically holds every included day; simultaneous last-slot requests cannot exceed capacity. Only Admin approves/rejects leave; owner cancellation releases capacity and preserves history. |
| AC-38 | Equipment units link eligible existing inventory lots; facilities are independent. Whole-day reservations cannot overlap for one resource, including concurrent requests. Retry, cancellation, audit rollback and retirement preserve history and stock/custody balances. |
| AC-39 | Separate public equipment/facility and leave calendars show available/reserved/full dates. Only explicitly published resources and approved leave names/categories/dates appear; request/account IDs, pending identities, reasons, purposes, notes, contacts and inventory values are excluded. Authenticated request and approval, mobile and keyboard workflows are verified. |

## 14. Delivery plan and dependencies

Indicative solo-developer schedule: six weeks for a limited pilot after adding the Property Custodian module; allow additional time if official form approval, source-data cleanup, restricted-record rules, request operations, or production hosting are undecided.

| Phase | Deliverables | Exit gate |
| --- | --- | --- |
| Week 1 — Foundation | Scaffold review, shadcn/ui setup and shared theme, environment validation, auth, roles/grants, migrations, categories/locations, boxes/folders/documents | Authenticated CRUD and authorization tests pass |
| Week 2 — Custodial register and stock cards | Item/lot model, sections, receipts/issues/returns/transfers/adjustments, reorder dashboard, Appendix 58 preview/export | Ledger reconciliation, concurrency, negative-balance, permissions, and stock-card golden-file tests pass |
| Week 3 — Physical counts and official forms | Count sessions, variance logic, finalization/amendment, RPCSP/RPCPPE profiles, signatories, XLSX/print generation | Count-integrity tests and source-form visual regressions pass |
| Week 4 — Controlled migration and template inventory | Three-format import preview/commit/error report; printed-form revision catalog, folder inventory, ledger, atomic adjustments/transfers | All supplied workbooks pass mapping tests; import and printed-template balances reconcile |
| Week 5 — Records workflows | Requests, partial fulfillment, loans/returns, movement history, search, reports, CSV | End-to-end release/return, inventory reporting, and permission tests pass |
| Week 6 — Pilot release | QR scan/labels, mobile count-entry polish, Docker, restore rehearsal, Property Custodian walkthrough | Full acceptance checklist, workbook reconciliation, printed-form samples, and school pilot sign-off |

Dependencies: school-approved shelf naming and category codes; Property Custodian and accounting representative to approve the three report profiles, classification threshold, section mappings, signatories, fund clusters, opening balances, and anomaly resolutions; records custodian to validate physical inventory; hosting/domain/TLS access; production account list; restricted-record policy; email provider if self-service recovery is required.

If six weeks becomes too tight, retain security, transaction history, custodial ledger integrity, count snapshots, approved official report layouts, and backups; defer camera scanning to manual/phone-native scanning and simplify nonofficial dashboards before reducing data integrity or report fidelity.

## 15. Test and rollout strategy

- Unit tests for stock status, state transitions, permission inheritance, due dates, and input validation.
- Database integration tests for competing stock writes, transfer rollback, duplicate operation IDs, unique open loans, and restricted deletion.
- Property inventory tests for opening/receipt/issue/return/transfer arithmetic, back-dated stock-card recalculation, reorder boundaries, fixed-decimal valuation, duplicate property numbers, balance corrections, and simultaneous issues.
- Physical-count tests for card-balance snapshots, missing/zero unit values, shortage/overage signs, section totals, uncounted exclusions, finalization locks, amendments, and profile-version retention.
- Golden-file and rendered-page regression tests for Appendix 58, Annex A.8, and Appendix 73, including merged headers, column order/widths, borders, wrapping, A4 orientation, repeated headers, totals, notes, and signature blocks.
- Import tests using untouched copies of all supplied workbooks plus malformed, duplicate, formula-heavy, text-placeholder, oversized, encrypted, and unsupported-file fixtures. Verify that preview is nonmutating and commit is atomic/idempotent.
- API authorization tests for every role, direct ID access, export scope, grant revocation, and deactivated sessions.
- Browser end-to-end tests for login, record lookup, stock issuance, requests, release/return, and QR continuation.
- Manual accessibility/mobile/printed-label checks and performance tests with representative synthetic records.
- Migration rehearsal and backup restoration in a clean environment before production import.

Pilot one shelf, a small printed-template set, and one report section from each custodial form family first. Have the Property Custodian verify item/lot mappings, opening balances, physical counts, conditions, signatories, and printed workbook layout before expanding. Treat a verified imported quantity as an attributable opening-balance transaction; treat an imported physical count as a draft session until separately reconciled. Rollback uses the previous compatible image; schema rollback or restore requires an explicit migration plan and must account for writes since deployment.

## 16. Definition of done

The release is complete when all MVP requirements and acceptance scenarios pass; migrations and lockfile are committed; production secrets and accounts are configured; school staff validate pilot records and label scans; the Property Custodian signs off the item mappings, ledger reconciliation, count workflow, and printed Appendix 58/Annex A.8/Appendix 73 samples; backups restore successfully; and an operator guide covers custodial receipts/issues/transfers/adjustments, count finalization/amendment, workbook import, official report generation, printed-template stock adjustment, checkout/return, restricted access, record retirement, and support escalation. No unresolved critical authorization, data-loss, inventory-integrity, import, or official-report fidelity defects may remain.

## 17. Assumptions and decisions to confirm before go-live

1. MATMS serves one school with Admin-provisioned users; Staff can process ordinary requests without a separate approval chain.
2. Master templates are links only; scanned record storage and Google Docs automation are deferred.
3. All physical borrowings use due dates and recipient acknowledgement; the school chooses default loan duration.
4. Restricted-record grants, requester-data retention, archive periods, and disposal authority must be approved by the school; this PRD does not invent official retention periods.
5. The school provides the hosting operator, backup owner, domain, and incident contact.
6. No public record directory or unauthenticated QR detail view is permitted.
7. Existing records are migrated only through the controlled importer defined in FR-11 or entered manually after a verified opening inventory. Generic workbook import remains a later feature.
8. The supplied 2025 Appendix 58, Annex A.8, and Appendix 73 workbooks are layout and field references, not proof that they are the latest legally required forms. The school/accounting owner must approve each production form profile and visible label before go-live.
9. The initial PPE classification convention is PHP 50,000 and above because it appears in the supplied RPCPPE workbook. The school/accounting owner confirms the value and effective date; configuration changes affect future classification and reports only.
10. Property Custodian, committee, and School Head names/designations are report metadata for wet-signature blocks. Electronic signatures and cryptographic approval are outside MVP.
11. Source rows with missing values, `-` placeholders, inconsistent formulas, unexpected variances, mixed year text, or contradictory condition counts require operator resolution. MATMS does not silently normalize them into authoritative values.
12. The source-faithful report profile preserves the supplied workbook structure and approved wording. Corrections to official labels or layout are made as a new version after owner approval, not as an undocumented deviation.
