# Architecture Context

## Baseline and implementation status

Follow MATMS-PRD §§3–9 and §12. Project Foundation, account/session access, archive hierarchy, and core template inventory are implemented: the pnpm/Turborepo workspace contains `apps/web` (Next.js), `apps/server` (Bun/Hono), and shared `api`, `auth`, `db`, `config`, and `ui` packages. Better Auth credentials/sessions are extended by application-owned profile role, active, and must-change-password fields; profile changes and account lifecycle events audit in the same transaction. Categories, locations, boxes, folders, documents, exact-target access grants, movement events, revision templates, inventory balances, stock operation replays, and immutable stock transactions use reviewed PostgreSQL constraints. The shared UI package provides the configured shadcn/ui primitives and Tailwind theme. Database migrations and service checks have passed against the local test database; full production builds, Docker image builds, browser accessibility, request/loan-dependent retirement guards, and deployment remain unverified. Inspect generated output before choosing additional concrete paths, package names, scripts, or adapters.

## Selected stack

| Layer | Decision | Responsibility |
| --- | --- | --- |
| Frontend | Next.js + TypeScript | Screens, rendering, forms, print layouts |
| UI | shadcn/ui + Tailwind CSS | Shared primitives, semantic theme, responsive composition |
| Backend | Hono on Bun | HTTP entry point, auth handlers, oRPC transport, health endpoints |
| API | oRPC | Validated contracts, typed client, domain procedures |
| Identity | Better Auth | Email/password, sessions, recovery, generated auth tables |
| Database | PostgreSQL + Drizzle | Metadata, balances, ledger, requests, custody, grants, audit |
| Workspace | pnpm + Turborepo | Package boundaries, builds, checks, committed lockfile |
| Deployment | Separate web/server Docker images | Private PostgreSQL service, proxy/TLS, persistence and backups |
| External masters | Approved HTTPS links | Provider-owned digital files; no uploads or proxy fetching in MVP |

Use the PRD bootstrap command. Record the actual CLI version and pin toolchain/dependencies after inspecting generated output. Do not prescribe a Next.js version independently of that inspection. Read relevant installed `node_modules/next/dist/docs/` guides before writing Next.js code.

## Boundaries and request flow

Browser → HTTPS reverse proxy → Next.js web or Hono server → PostgreSQL.

Prefer one public origin: `/api/auth/*` routes to Better Auth on Hono; `/api/rpc/*` routes to oRPC. Next.js owns presentation; Hono/domain procedures own authorization, business rules, transactions, and database access. Server-rendered data requests use the same authorized service boundary. Do not introduce a competing Next.js business API or direct frontend database access.

| Logical location | Responsibility |
| --- | --- |
| `apps/web` | Screens, typed API client, feature components, print layouts |
| `apps/server` | Hono boot, auth routes, oRPC transport, health endpoints |
| `packages/api` | Contracts, session context, authorization, domain services |
| `packages/db` | Drizzle schema, migrations, connection, fictional seed data |
| `packages/auth` | Better Auth configuration and session integration |
| Generated configuration packages | Environment validation, lint, TypeScript and build settings |

Reuse the scaffold's configured UI directory or shared UI package. Add components there once; compose domain components above them.

## Storage and domain model

- PostgreSQL holds application records and history; Better Auth owns credential/session tables. Application user foreign keys must match generated auth ID types, even though application records use UUIDs.
- Shelf location → box → folder → document is the physical home hierarchy. Box category classifies descendants. A checked-out item retains its home ancestry while its custody is tracked separately.
- A template row is one revision. Inventory is unique per revision/folder pair and is allowed only in template folders. Digital revision changes do not relabel existing printed stock.
- `stock_operations` deduplicates mutation intent; `stock_transactions` is the append-only ledger. Request lines, checkouts, movement events, and audit logs preserve operational history.
- Stock keeps the PRD's `stock_operations` model. Release and return will use a separate durable `custody_operation_replays` table with a unique UUID operation ID, operation kind (`release` or `return`), actor ID, authorized scope fingerprint, payload fingerprint, saved result JSON, and timestamp. A replay is reauthorized before returning its saved result; an ID reused with a different payload fails. This schema is added with the custody feature, not an in-memory cache.
- Store digital master/document links as validated HTTPS URLs. Do not fetch arbitrary URLs server-side. There is no blob/file artifact store in MVP.
- Container ancestry determines effective location. Movement events preserve source/destination references or label snapshots instead of rewriting descendant histories.

The complete table and constraint baseline is PRD §8; feature specs refine it without replacing its controls.

## Authorization

- Admin provisions accounts; no public signup. Bootstrap the first Admin without committed credentials. Prevent removing the last active Admin.
- Validate active account/session, role capability, and object scope at every procedure. Deactivation revokes sessions and retains historical attribution.
- Classifications are `internal` and `restricted`. Admin has schoolwide access. Other users need grants satisfying every restricted ancestor and any independently restricted target. A parent grant covers descendants unless a descendant is independently restricted; a child grant cannot bypass a restricted parent.
- Filter before pagination, aggregation, search suggestions, reports, exports, print selection, and recent activity. Inaccessible IDs produce generic unavailable responses.
- Staff cannot grant access or downgrade confidentiality. A move into less restrictive ancestry needs Admin review. History payloads and request lines must not leak inaccessible related records.
- UI visibility is convenience only; all permissions are enforced on the server.

## Transaction and lifecycle invariants

1. Stock balances, ledger, and audit commit together. Use conditional updates or row locks, never an unguarded read-modify-write. Counts and thresholds are nonnegative integers.
2. Transfers atomically debit and credit the same revision with linked ledger entries. Corrections require Admin, reason, and expected version.
3. Stock, release, return, and transfer operations have an operation ID and payload fingerprint. Identical retries return the original authorized result; different payloads with the same ID fail. Recheck access before returning a replayed result.
4. One document can have at most one unresolved open loan, enforced in PostgreSQL. Repeated release/return cannot duplicate custody changes. Request progress and related audit update atomically with fulfillment.
5. Audit failure rolls back its business mutation. Audit and ledger entries are append-only through the app; do not cascade-delete operational/history records.
6. Stable UUID QR targets survive editable code changes. Normalize unique codes and never reuse retired codes.
7. Archived boxes accept returns of existing loans but no new filing or routine inventory operations until reactivated. Retirement requires resolved active requests/loans and zero inventory or prior relocation/resolution.
8. Documents cannot be refiled while checked out. Alternative return locations create a movement event in the return transaction.
9. Event timestamps are UTC, displayed in Asia/Manila. Date-only metadata must not shift by timezone. Overdue is derived from an open loan and its due timestamp.

## Operations

Keep PostgreSQL private to the container network. Deploy reviewed migrations as one controlled release task, not per replica or through production schema push. Pin images/toolchains and use separate web/server builds; verify Next.js runtime support rather than assuming Bun everywhere.

Provide liveness/readiness, structured redacted logs, connection pooling, timeouts, graceful shutdown, backup monitoring, and rollback instructions. Daily encrypted off-host backups with 30-day retention, RPO ≤24 hours and staffed-support RTO ≤4 hours are proposed targets pending school confirmation. Rehearse restoration before launch and quarterly. Persistent volumes are not backups.
