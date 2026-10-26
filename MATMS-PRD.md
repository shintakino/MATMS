# Meocan Archive & Template Management System
## Product Requirements Document — Version 1.2

**School:** Meocan High School  
**Date:** October 26, 2026  
**Status:** Development baseline; school operational policies require owner confirmation before production use.  
**Primary operator:** Administrative Officer II  
**Product abbreviation:** MATMS

### Implementation documentation

This PRD is the product baseline. The [context files](context/project-overview.md) translate it into architecture, UI, code, and workflow guidance. The [feature-spec index](feature-specs/README.md) maps planned implementation units to functional requirements and acceptance criteria. The [progress tracker](context/progress-tracker.md) records actual completion separately from planned behavior. Resolve conflicts in these documents before dependent implementation.

Version 1.2 aligns these supporting documents with MATMS and clarifies server-confirmed inventory feedback. The required shadcn/ui decision and requested bootstrap configuration are retained.

## 1. Purpose and outcomes

MATMS maps physical school records to boxes, folders, and shelf locations; tracks printed blank forms; links to digital master templates; and records document requests, checkout, return, and movement history. Staff should locate an authorized record without opening multiple physical boxes and identify forms that need replenishment before they run out.

The first release serves one school. It is an authenticated web application optimized for desktop administrative work and mobile shelf scanning. Digital document metadata does not imply that a scanned copy exists.

### Success measures

- At least 95% of active pilot boxes and folders have verified locations before rollout.
- In pilot tasks, users locate an authorized record within 30 seconds in at least 90% of attempts.
- Every stock change and physical checkout creates an attributable transaction.
- Stock never becomes negative, including during simultaneous issuance.
- No user can access restricted records through search, exports, URLs, or QR scanning without authorization.
- All completed checkouts have an identifiable recipient, releasing officer, and return state.

## 2. Scope and release boundaries

### Included in MVP

- Administrator-provisioned accounts, authentication, roles, and restricted-record grants.
- Dashboard; category, shelf, box, folder, and document metadata management.
- Digital master template links and physical template inventory per folder.
- Immutable stock transaction history and low-stock indicators.
- Document requests, release, checkout, return, and physical relocation history.
- Permission-filtered search, reports, CSV export, QR generation, and camera scanning.
- Audit history, record retirement, backups, and Docker deployment.

### Later releases

- Google Drive OAuth/API access, creating Google Docs copies, mail merge, and automatic field filling.
- Scanned file uploads, OCR, full-text document-content search, and electronic signatures.
- Email/SMS reminders, purchase requests, multi-school tenancy, offline synchronization, and bulk spreadsheet import.
- Configurable multistep approvals and formal records-disposal execution.
- Native XLSX exports; MVP CSV remains compatible with spreadsheet applications.

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
| Payments | None |

The CLI uses evolving dependencies. During implementation, inspect the generated output, record the CLI version, pin Node/Bun/pnpm and dependency versions, and commit the lockfile. Do not assume package names, scripts, adapters, or Docker files without checking the scaffold. If uppercase project naming fails validation, use `matms` for the directory/package name and retain MATMS as the product name.

Reference documentation: https://www.better-t-stack.dev/docs and https://github.com/AmanVarshney01/create-better-t-stack/tree/main/apps/web/content/docs/cli . These inform scaffold choices; all MATMS behavior below is a product requirement.

## 4. Architecture and service boundaries

Browser → HTTPS reverse proxy → Next.js web or Hono server → PostgreSQL.

Expose the application through one public origin where practical. Route `/api/auth/*` to Better Auth handlers on Hono and `/api/rpc/*` to oRPC. Keep the Next.js frontend responsible for presentation; the Hono service owns business validation, authorization, transactions, and database access. Server-rendered calls, if used, follow the same authorization rules.

- Public QR target: `/boxes/{uuid}`. QR payload contains only an application URL and stable identifier.
- PostgreSQL is private to the container network and is not exposed publicly.
- Better Auth manages its own authentication tables. Application roles and grants extend the authenticated identity without duplicating password handling.
- All count changes, releases, returns, relocations, and role changes are server-authoritative.
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

| Capability | Admin | Staff | Viewer |
| --- | --- | --- | --- |
| View permitted boxes, folders, documents and templates | Yes | Yes | Yes |
| Search and scan permitted box labels | Yes | Yes | Yes |
| Manage categories, shelves, boxes and folders | Yes | No | No |
| Create/edit document metadata | Yes | Yes | No |
| Relocate records or containers | Yes | Yes | No |
| Create/edit master templates and thresholds | Yes | No | No |
| Receive or issue physical template copies | Yes | Yes | No |
| Correct a stock balance with reason | Yes | No | No |
| Create and process document requests | Yes | Yes | No |
| Release and return records | Yes | Yes | No |
| Export permitted reports and print labels | Yes | Yes | No |
| View operational transaction history | All permitted | Permitted | No |
| View system audit history | Yes | No | No |
| Retire records and manage lifecycle | Yes | No | No |
| Manage accounts, grants and settings | Yes | No | No |

### Confidentiality

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

## 7. Functional requirements

### FR-01 — Authentication and account administration

- Email/password login, logout, session expiry, password change, and account deactivation.
- Generic login failures, throttling, secure cookies, and server-side session checks.
- Password recovery through a configured email delivery provider. Until email is configured, provide a controlled Admin-assisted reset process that never reveals existing passwords and requires a new password at next login.
- Prevent removal/deactivation of the last active Admin.
- Idle session timeout target: 30 minutes; maximum session lifetime target: 12 hours, configurable by Admin policy and implemented server-side.

### FR-02 — Dashboard

Show permitted active boxes, folders, documents, low-stock inventory lines, out-of-stock lines, pending requests, active loans, and overdue loans. Display stock per location, not an aggregate that hides a depleted folder. Provide links to the corresponding filtered lists and recent permitted activity. Show loading, empty, error, and retry states.

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

Requests are entered by Admin/Staff on behalf of a requester; a public requester portal is outside MVP. Store requester name, optional office/contact, purpose, request type (`inspect`, `borrow`, `copy`), requested items, and notes. Collect only necessary personal data.

Request lifecycle: `draft → submitted → approved | rejected | cancelled`; approved requests become `in_progress` after first fulfillment and `completed` after all required fulfillment and returns. Cancellation applies only to unfulfilled items; fulfilled items retain their history. Rejections require a reason.

- Each request has one or more document lines. Track each line as pending, approved, rejected, cancelled, fulfilled, or loan-active/returned through associated checkout records.
- Request approval and release are distinct actions. Authorized Admin/Staff can approve ordinary records; restricted-record requests require Admin approval and releaser access.
- Borrowing requires recipient acknowledgement, releasing officer, released timestamp, and due date. A document can have only one open checkout.
- Inspect/copy fulfillment does not create a loan; it records who fulfilled the line and when. If the original leaves custody, use Borrow instead.
- Returns record receiver, timestamp, condition, and home/alternative folder. A repeated return cannot close the same loan twice.
- A loan is overdue when open and past its due timestamp; overdue is computed, not a manually maintained status.
- Outstanding loans block record retirement. Lost/damaged items remain unresolved exceptions until Admin records a resolution and supporting notes; history remains intact.

### FR-08 — Search, filters and reporting

- Debounced, server-side search across codes, titles, folder names, permitted metadata keywords, and template names; no scanned-content search in MVP.
- Filters: category, shelf, box lifecycle, confidentiality within authorized scope, stock status, template revision status, request status, and date range as applicable.
- Default 25 rows per page, maximum 100, deterministic sorting, persisted filters in the URL, and reset action.
- Results show breadcrumb location and availability. Auth-filtered counts use the same scope as results.
- Reports: box/folder inventory, document register, template balances, stock ledger, active/overdue loans, request history, and relocation history.
- Export filtered, authorized CSV with generated timestamp, filter summary where practical, UTF-8 encoding, and correctly escaped fields. Neutralize spreadsheet formula injection in text cells. Audit exports with actor, scope, and row count.

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

## 8. Data model and integrity

All application tables use UUID primary keys unless stated otherwise. Mutable tables include created/updated timestamps and actor references where appropriate. Better Auth table names and identifier types follow the generated adapter; application user foreign keys must match those types.

| Table | Principal fields and relationships |
| --- | --- |
| Auth tables | Generated Better Auth users, sessions, accounts, verification records |
| user_profiles | user_id unique FK, role enum, active flag, must_change_password |
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
| inventory | list, receive, issue, transfer, correctBalance, ledger |
| requests | list, get, create, submit, approveLines, rejectLines, cancelLines, fulfill |
| checkouts | list, release, return, recordException, resolveException |
| search / reports | globalSearch, inventory, lowStock, loans, movements, exportCsv |
| admin | users, deactivateUser, changeRole, grantAccess, revokeAccess, auditLog, settings |

Mutation payloads include expected version where needed and an operation ID for stock/release/return/transfer actions. Return standard codes such as UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, VALIDATION_ERROR, CONFLICT, INSUFFICIENT_STOCK, ACTIVE_LOAN, and RATE_LIMITED. Map internal errors to safe user messages and log a correlation ID.

Authorization filters must be applied before pagination and aggregation, not after retrieving a page. Client input never supplies the authoritative actor identity or resulting stock balance.

## 10. Screens and navigation

Primary navigation: Dashboard, Boxes, Documents, Templates, Requests & Loans, Reports. Admin additionally sees Users & Access, Audit Log, and Settings.

| Route | Main purpose |
| --- | --- |
| `/login` | Sign in and safe post-login continuation |
| `/dashboard` | Operational summary and action queues |
| `/boxes` and `/boxes/[id]` | Box register, location, contents, history, labels |
| `/folders/[id]` | Documents and inventory within one folder |
| `/documents` and `/documents/[id]` | Metadata, availability, requests, movement history |
| `/templates` and `/templates/[id]` | Master revisions and stock by folder |
| `/inventory` | Replenish, issue, transfer, correct, inspect ledger |
| `/requests` and `/requests/[id]` | Request entry and fulfillment |
| `/loans` | Active, overdue, returned and exception loans |
| `/scan` | Camera scanning and manual code lookup |
| `/labels` | Authorized print selection and print preview |
| `/reports` | Filters, summaries, CSV exports |
| `/admin/*` | Users, grants, locations, categories, audit and settings |

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
| Feedback | Sonner notifications for action results; inline errors and Alert for issues requiring persistent attention |
| Loading and empty results | Skeleton placeholders and reusable empty-state content with clear next actions |

The data table is a composed feature, not an assumption of a standalone shadcn/ui grid. It must retain the existing server-side pagination, authorization, search, and export requirements. QR labels use a dedicated print layout with navigation and interactive controls hidden in print.

Accessibility must be verified in the assembled screens: keyboard navigation, visible focus, screen-reader labels, dialog focus return, associated form errors, and text alongside status colors. Disable duplicate submissions during mutations and preserve the existing server-confirmed stock behavior.

## 11. Non-functional and operational requirements

### Performance and reliability

Initial design capacity: 500 boxes, 5,000 folders, 50,000 document records, 2,000 template inventory lines, and 20 concurrent users. These are sizing assumptions, not current school counts.

- Under representative load, p95 list/search API responses <= 500 ms excluding network; initial key-screen usable content <= 1.5 seconds on the agreed school-network test profile.
- Search queries debounce around 300 ms; expensive exports may stream and must have a documented row limit and narrowing guidance.
- Use transactional writes, bounded retries, connection pooling, request timeouts, and graceful shutdown.
- Health endpoints expose liveness and readiness without sensitive configuration; readiness checks database reachability.

### Security and privacy

- HTTPS, secure HTTP-only session cookies, explicit trusted origins, CSRF protections appropriate to Better Auth and cookie-authenticated mutations, and restrictive CORS if separate origins are used.
- Rate-limit login, recovery, exports, and repeated mutations. Validate URLs and sanitize user-rendered content.
- Server-side authorization covers all procedures and report/print endpoints. Do not expose database credentials to the browser.
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

## 14. Delivery plan and dependencies

Indicative solo-developer schedule: four weeks for a limited pilot; allow additional time if restricted-record rules, request operations, or production hosting are undecided.

| Phase | Deliverables | Exit gate |
| --- | --- | --- |
| Week 1 — Foundation | Scaffold review, shadcn/ui setup and shared theme, environment validation, auth, roles/grants, migrations, categories/locations, boxes/folders/documents | Authenticated CRUD and authorization tests pass |
| Week 2 — Template inventory | Revision catalog, folder inventory, ledger, atomic adjustments/transfers, dashboard | Concurrency, nonnegative balance and retry tests pass |
| Week 3 — Workflows | Requests, partial fulfillment, loans/returns, movement history, search, reports, CSV | End-to-end release/return and permission tests pass |
| Week 4 — Pilot release | QR scan/labels, mobile polish, Docker, restore rehearsal, staff walkthrough | Acceptance checklist and school pilot sign-off |

Dependencies: school-approved shelf naming and category codes; records custodian to validate physical inventory; hosting/domain/TLS access; production account list; restricted-record policy; email provider if self-service recovery is required.

If four weeks becomes too tight, retain security, transaction history, and backups; defer camera scanning to manual/phone-native scanning and simplify report presentation before reducing data integrity.

## 15. Test and rollout strategy

- Unit tests for stock status, state transitions, permission inheritance, due dates, and input validation.
- Database integration tests for competing stock writes, transfer rollback, duplicate operation IDs, unique open loans, and restricted deletion.
- API authorization tests for every role, direct ID access, export scope, grant revocation, and deactivated sessions.
- Browser end-to-end tests for login, record lookup, stock issuance, requests, release/return, and QR continuation.
- Manual accessibility/mobile/printed-label checks and performance tests with representative synthetic records.
- Migration rehearsal and backup restoration in a clean environment before production import.

Pilot one shelf and a small template set first. Have staff verify physical counts and locations, reconcile discrepancies, then expand. Treat the physical count as a verified opening-balance transaction with date and actor. Rollback uses the previous compatible image; schema rollback or restore requires an explicit migration plan and must account for writes since deployment.

## 16. Definition of done

The release is complete when all MVP requirements and acceptance scenarios pass; migrations and lockfile are committed; production secrets and accounts are configured; school staff validate pilot records and label scans; backups restore successfully; and an operator guide covers stock adjustment, checkout/return, restricted access, record retirement, and support escalation. No unresolved critical authorization, data-loss, or inventory-integrity defects may remain.

## 17. Assumptions and decisions to confirm before go-live

1. MATMS serves one school with Admin-provisioned users; Staff can process ordinary requests without a separate approval chain.
2. Master templates are links only; scanned record storage and Google Docs automation are deferred.
3. All physical borrowings use due dates and recipient acknowledgement; the school chooses default loan duration.
4. Restricted-record grants, requester-data retention, archive periods, and disposal authority must be approved by the school; this PRD does not invent official retention periods.
5. The school provides the hosting operator, backup owner, domain, and incident contact.
6. No public record directory or unauthenticated QR detail view is permitted.
7. Existing records will be entered or migrated only after a verified opening inventory; bulk import is a later feature unless added to implementation scope.
