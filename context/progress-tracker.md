# Progress Tracker

Update this file whenever the current phase, active feature, implementation state, or verification results change.

## Current phase

Completion sweep for specs 00–04 is active. Core implementation is present; documented UI, verification, and cross-feature completion items remain before those specs can be called fully complete.

## Current goal

Close the audited completion checklist for specs 00–04, then implement [05 — Requests and Loans](feature-specs/05-requests-and-loans.md).

## Completed

- Replaced unrelated product, canvas, authentication, storage, and styling guidance across all six context files with MATMS requirements.
- Defined shadcn/ui + Tailwind as the required shared UI foundation, light-first theming, accessible component composition, and server-confirmed mutation feedback.
- Rewrote the design-system spec and added a [feature-spec index](../feature-specs/README.md) with bootstrap, access, records, inventory, requests/loans, reporting, QR, administration, and deployment units.
- Mapped FR-01–FR-10 and AC-01–AC-22 to feature specs.
- Clarified the PRD's inventory feedback wording and documented the relationship between PRD, context, and specs.
- Checked local Markdown links, fenced blocks, and feature-index coverage of all 10 functional requirements and 22 acceptance scenarios; reviewed documentation for stale stack/product guidance.
- Aligned the root README, AGENTS.md, and CODEX.md with MATMS, including documentation navigation, required shadcn/ui usage, and accurate pre-implementation status.
- Generated and adopted the Better T Stack workspace without overwriting MATMS documentation: pnpm/Turborepo, Next.js web, Bun/Hono server, oRPC, Better Auth, PostgreSQL/Drizzle, Docker targets, and shared shadcn/ui package.
- Recorded actual bootstrap/toolchain details: create-better-t-stack 3.49.0; Node 22.22.2; Bun 1.4.4; pnpm 11.1.1; Next 16.4.3; Better Auth 1.7.12; Drizzle 1.0.0-rc.5.
- Disabled Better Auth public sign-up, removed generated demo account/dashboard routes, and configured same-origin Next rewrites for `/api/auth/*` and `/rpc/*`; the browser has no direct database connection.
- Added secret-free environment examples and server-side Varlock validation. Missing required Better Auth, trusted-origin, or database configuration fails closed without exposing values.
- Added liveness/readiness endpoints, correlation IDs, redacted structured request/error logs, typed safe-error groundwork, and transaction-scoped audit persistence with credential/session redaction.
- Generated the initial reviewed Drizzle migration for Better Auth tables and `audit_logs`; documented the future durable `custody_operation_replays` design while retaining `stock_operations` for stock.
- Added a persistent PostgreSQL Compose service with a loopback-only development overlay and separate, pinned web/server Dockerfiles. Corrected the PostgreSQL 18 volume mount required by the generated image.
- Applied the initial migration to an empty `matms_test` database and passed the integration test proving an audit insertion failure rolls back its accompanying mutation.
- Inspected the generated shared UI configuration, aliases, stylesheet, dependencies, and existing `cn()` helper. Added the active shell/form/list primitives through the configured shadcn CLI in `packages/ui` without overwriting pre-existing primitives.
- Added light-theme semantic `success`, `warning`, and `info` tokens with foreground pairs, and registered the generated Tooltip provider at the application boundary.
- Implemented the responsive application shell: shared Sidebar with generated mobile Sheet behavior, Breadcrumb, role-aware fixture navigation, user menu, and light content header. The fixture role is explicitly presentation-only; it is not authorization.
- Added reusable loading, empty, error/retry, unavailable, associated inline-validation, and pending-submit patterns. The root is now a clearly labelled fictional design-system preview with a responsive table, selection, query-intent controls, pagination, row actions, dialog form, and stock-status fixtures.
- Added `StockStatusBadge` with text labels and semantic status styling: Out of stock at zero, Low stock at the threshold, and In stock above it.
- Added application-owned `user_profiles` with Admin/Staff/Viewer role, active, and must-change-password fields, plus a reviewed migration applied to the isolated test database.
- Kept Better Auth responsible for credentials and session cookies while adding transactionally audited, profile-backed first-Admin bootstrap, Admin account provisioning, role changes, activation/deactivation, assisted password resets, and self-service password changes.
- Added PostgreSQL advisory locking around bootstrap, Admin demotion, and deactivation so concurrent changes cannot remove the final active Administrator.
- Disabled public sign-up; restricted session creation to active profiled accounts; configured sign-in/reset rate limits, trusted origins, secure production cookies, a 30-minute idle session expiry, and a 12-hour server-enforced absolute session maximum.
- Added active-profile and must-change-password checks to oRPC procedures. Deactivation and assisted reset revoke database sessions immediately; account lifecycle mutations and first-admin creation write audit entries in their enclosing transaction.
- Replaced the root design-system preview with authenticated dashboard routing, added generic-failure login/logout/password-change flows with validated local continuations, and retained the preview at `/design-system`.
- Added `/admin/users` for Admin-only account provisioning, role/status updates, and controlled assisted resets; server-side procedures remain the authority.
- Added and passed an identity integration test covering one-time bootstrap, password hashing, transactional audit persistence, and last-active-Admin protection.
- Added reviewed archive schema and migration for categories, structured shelf locations, boxes, folders, documents, access grants, and movement events. IDs are UUIDs; normalized editable codes are unique; grant and movement targets have database-enforced exactly-one-target checks.
- Applied the archive migration to the isolated `matms_test` database. Archive foreign keys restrict deletion so operational hierarchy/history cannot be cascade-deleted.
- Added server-authoritative archive services and oRPC procedures for authorized box/document registers and details, category/location/box/folder/document creation, stable box-code changes, box/folder/document relocation, box lifecycle state changes, and exact-target grant/revocation operations.
- Implemented inherited restricted-scope enforcement: a non-Admin must hold an active grant for every restricted box, folder, and document ancestor. Procedures return the same unavailable response for absent and inaccessible records; Viewer writes are denied before mutation.
- Added transactional audit entries for archive creation, code changes, relocation, lifecycle changes, and grants. Box relocation emits one movement event with source/destination snapshots; descendants obtain their current shelf through ancestry rather than synthetic movements.
- Added `/boxes`, `/boxes/[id]`, `/folders/[id]`, `/documents`, `/documents/[id]`, and `/admin/archive` routes using the existing authenticated shell, typed oRPC calls, loading/empty/error states, and Admin setup forms.
- Added and passed an archive integration test covering all-ancestor restricted grants, grant revocation, Viewer write denial with no document created, and one-event box relocation history.
- Added reviewed schema and migration for template revisions, per-folder inventory balances, idempotent stock operations, and immutable stock transactions. Database constraints enforce one revision/folder line, nonnegative balances and thresholds, nonzero ledger deltas, and ledger arithmetic.
- Applied the inventory migration to the isolated `matms_test` database. Inventory/ledger history uses restricted foreign keys and cannot be cascade-deleted with operational records.
- Added authorized template and inventory oRPC services: Admin template/line creation; Admin/Staff receive, issue, and transfer; Admin expected-version correction. Viewer calls are denied before mutation.
- Stock operations validate active in-scope template folders and active container ancestry, enforce positive/nonnegative quantities, reject retired revisions, require an Admin decision for superseded-stock issuance, and audit every committed mutation.
- Added durable operation-ID result replay with a SHA-256 payload fingerprint. Matching retries return the saved result; changed payload reuse conflicts. Receive, issue, transfer, ledger, operation record, and audit entries commit in one transaction.
- Added `/templates`, `/templates/[id]`, and `/inventory` screens with Admin catalog creation, an authorized inventory register, readable stock status text, and an operation form that retains its operation ID until the server confirms success. Template details and folder details show only authorized per-folder stock.
- Added and passed inventory integration coverage for two-from-six issuance, ledger arithmetic, idempotent retry/mismatched reuse, concurrent issue safety, atomic transfer, and stale correction rejection.
- Added the now-available zero-inventory retirement guard to box retirement. An Admin must first retire/relocate active folders and resolve any remaining template inventory; request/loan guards remain dependent on 05.

## Implementation state

- Workspace files, pinned pnpm lockfile, shared shadcn/ui package, Better Auth schema, initial Drizzle migration, and a database integration test are present.
- The root route directs to the authenticated dashboard; unauthenticated requests are sent to `/login` with a validated local continuation. The design-system preview remains explicitly fictional at `/design-system`.
- The shared UI package includes the shell/form/list primitives required by spec 01. `LocationBreadcrumb`, inventory actions, record picking, QR, and reporting wrappers remain deferred until their dependent authorized procedures exist.
- Account provisioning, roles, activation, password lifecycle, rate-limited login, session expiry/revocation, and Admin user management are implemented. Archive hierarchy, exact grants, inherited visibility, core movement history, basic register/detail/setup screens, template catalog, per-location inventory, atomic stock writes, ledger, and idempotent replay are implemented. Requests, report/search, QR, production reverse proxy/TLS, backups, and restore rehearsal remain planned.
- Verified: environment generation, package installation from the lockfile, workspace type checks (including inventory additions), migrations applied to the isolated test database, audit rollback test, identity provisioning/last-Admin integration test, archive authorization/movement integration test, inventory balance/concurrency/idempotency integration test, Hono liveness endpoint, and whitespace-safe diffs.
- Not yet verified: a successful full Next production build (the installed Next 16/TypeScript 6 build process did not finish inside the command time limit), Docker image builds, keyboard/browser accessibility checks on a rendered page, end-to-end browser flow, deployment, or restore.

### Completion audit — specs 00–04

- **00 Foundation:** Clean-install, migration, environment, API-boundary, audit rollback, and type checks are covered. A completed Next production build, Docker image build, and tested fictional seed workflow are still required to close its verification scope.
- **01 Design system:** Shared primitives and representative patterns exist. Keyboard/screen-reader, focus-return, responsive-browser, and assembled-screen checks are still required for AC-21/AC-22; no automated browser evidence exists yet.
- **02 Identity and access:** Credential/session/account lifecycle and enforced inherited grants are implemented. The dedicated Admin access-grant screen, email-delivery recovery when a provider is configured, and browser/QR continuation verification remain open. QR scanning itself belongs to 07.
- **03 Archive:** Hierarchy, codes, scope checks, movements, and the inventory retirement guard are implemented. Full metadata/category/location edit/deactivate flows, record lifecycle screens, authorized movement-history display, and request/loan/checkout guards remain open; the latter three require 05 data.
- **04 Inventory:** Schema, atomic services, integration checks, catalog/list/detail and operation UI, plus folder stock panels, are implemented. Template revision update/supersede and threshold-maintenance flows, inventory-line creation UI, ledger display, and browser interaction checks remain open.

## Next up

1. Add the outstanding 00–01 verification: reproducible clean install/seed check, bounded production-build/Docker attempts, and browser accessibility checks.
2. Complete the 02–04 screen/API checklist above, beginning with Admin grant management, archive editing/lifecycle/history, and template/inventory maintenance and ledger panels.
3. Implement spec 05 requests and custody workflows with audit/concurrency checks; attach loan/request retirement guards and checked-out document refile checks.
3. Resolve the full Next production build verification and Docker image builds before relying on the foundation for deployment work.
4. Run keyboard and responsive-browser accessibility checks for the shell (AC-21/AC-22), then repeat them on assembled feature screens.
5. Follow the feature-spec index for dashboard/reporting, QR, lifecycle administration, and the pilot release gate.

## Open questions and decisions to resolve

### Before dependent implementation

- Confirm the mixed request-line decision/aggregate-state table for combinations of approval, rejection, cancellation, and partial fulfillment; retain PRD lifecycle guarantees.
- Define Admin exception resolution dispositions for lost/damaged originals without assuming disposal or write-off authority.
- Select durable release/return idempotency storage during schema design; PRD specifies behavior but only names stock-operation storage explicitly.
- Resolve/verify the installed Next 16.4.3 + TypeScript 6 production-build behavior; strict workspace type checks pass, but the full build was not completed in this environment.
- Choose compatible QR/scanner tooling and a bounded export row limit using pilot data/device constraints.

### Before production use

- School-approved shelf naming/category codes, restricted-record grant policy, requester-data retention, archive periods, and disposal authority.
- Default loan duration and recipient acknowledgement procedure.
- Hosting operator, approved hosting location, canonical domain/TLS, backup owner, incident contact, and agreed backup/RPO/RTO targets.
- Production account list and initial Admin provisioning; email provider or Admin-assisted recovery operating procedure.
- Approved external-file hosts if a host allowlist is required.
- School branding, actual desktop/mobile devices, printer calibration, and performance test network profile. Neutral light shadcn styling can proceed before branding approval.
- Verified pilot inventory, staff walkthrough, printed-label tests, restore rehearsal, and sign-off before real-data expansion.

## Architecture decisions

- One school; Admin-provisioned users; Admin/Staff/Viewer roles plus inherited restricted-record grants.
- Next.js presentation; Hono on Bun owns business APIs via oRPC; Better Auth identity; PostgreSQL/Drizzle persistence.
- pnpm/Turborepo workspace; separate web/server Docker images and private PostgreSQL.
- Required shadcn/ui + Tailwind; reuse generated infrastructure and component aliases; light theme by default.
- Semantic success/warning/info token pairs live in the shared UI stylesheet; domain status components include text as well as color.
- Navigation now uses the authenticated account role for presentation; every protected operation independently validates the active profile, password-change state, and role server-side. UI visibility never authorizes server data.
- Archive grants are active exact targets for one box, folder, or document; non-Admin access is evaluated at each restricted ancestry level before a result is returned or a mutation begins. Box moves write one snapshot-based container movement event; descendants derive current location through joins.
- Inventory is revision/folder-specific. Every stock mutation requires current access to both active template-folder locations, writes the stock operation, one or two arithmetic-checked ledger rows, and an audit entry in the same transaction. Operation IDs are durable replay keys, never an in-memory retry cache.
- MVP stores metadata and approved digital links, not scanned files.
- Server-authoritative, audited, atomic inventory/custody writes; durable idempotency for retries; stable UUID QR routes.
- Release/return replay will use durable `custody_operation_replays` (unique operation ID, operation kind, actor/scope and payload fingerprints, saved result, timestamp); stock continues to use `stock_operations`.
- PRD is the product baseline; context/specs explain implementation and checks without claiming planned features exist.

## Session notes

- 2026-10-26: Documentation-only alignment requested. No dependency installation or application implementation was requested in this task.
- The requested Better T Stack command remains in the PRD; bootstrap must preserve these existing documents.
- Follow-up: expanded the documentation alignment to root entry files; replaced the placeholder README and removed the remaining canvas reference from agent guidance.
- School policies are production gates, not invented defaults. Continue independent development with fictional fixtures while decisions remain open.
- 2026-10-26: Implemented spec 00. The staged Better T Stack scaffold was inspected before adoption; generated Next 16 local guides were read before frontend changes. The temporary staging directory contained no user work and was removed after adoption.
- 2026-10-26: Implemented spec 01. Read the installed Next 16 App Router layouts/pages, Server/Client Components, CSS, and linking/navigation guides before frontend changes. Used the local configured shadcn CLI to add only the primitives required by the shell, forms, list composition, and feedback states. Strict package type checks passed; rendered-browser accessibility and production-build checks remain outstanding.
- 2026-10-26: Implemented the account/session portion of spec 02. Read the installed Next 16 authentication and redirecting guides before frontend changes. Better Auth remains the sole credential/session owner; the app owns profile/role state and lifecycle services. Added the reviewed `user_profiles` migration and applied it only to `matms_test`. Strict web, API, auth, server, and database type checks passed. The Bun test runtime is installed at `/tmp/matms-bun/bin/bun` in this environment, so verification used that runtime with `TEST_DATABASE_URL` directed to the isolated `_test` database. Archive target grants are deferred by the spec's declared dependency on 03.
- 2026-10-26: Implemented the core of spec 03. Read the installed Next 16 forms and dynamic-routes guides before frontend changes. Added the reviewed archive/grants migration and applied it only to `matms_test`. The combined Bun integration suite and strict workspace type checks passed. Archive retirement currently guards active folders; inventory/request/loan and checked-out-document guards cannot be implemented until their dependent tables arrive in 04–05. Rendered-browser accessibility and production-build checks remain outstanding.
- 2026-10-26: Implemented the core of spec 04. Read the installed Next 16 forms guidance before frontend changes and retained Hono/oRPC as the mutation boundary. Added the reviewed template/inventory migration and applied it only to `matms_test`. Strict workspace type checks and all four Bun integration tests passed using `/tmp/matms-bun/bin/bun` with `TEST_DATABASE_URL` scoped to the isolated `_test` database. Template-detail/folder panels, rendered-browser accessibility, and production-build checks remain outstanding.
- 2026-10-26: Performed a cross-spec 00–04 completion audit at user request. Added the available inventory retirement guard to archive box retirement and recorded all remaining verification, UI, and dependency-backed gaps above instead of treating core implementation as full feature completion.
- 2026-10-26: Completed the previously listed inventory UI follow-up: `/templates/[id]` now shows the authorized revision and its permitted per-folder balances, and folder detail pages show their permitted template-stock panel. Strict API/web type checks passed.
