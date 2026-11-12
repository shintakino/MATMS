# MATMS

Meocan Archive & Template Management System for Meocan High School.

MATMS helps authorized school staff locate physical records by shelf, box, and folder; track printed template stock and digital master links; manage document requests, checkout, return and movement history; and maintain Property Custodian inventory and generate matching Stock Card/RPCSP/RPCPPE forms.

## Current status

The workspace implements specs 00–08: identity/access, archive maintenance, template inventory, requests and loans, scoped dashboard/search/reports, QR workflows and administration. Audit software gaps have been addressed; integration, strict types, production build and representative Chromium/accessibility checks pass. Actual school-device/printer acceptance remains open; see the [completion audit](docs/feature-completion-audit.md) for evidence and limits.

The initial clean deployment is live at **https://matms.shintakino.qzz.io**, managed by Coolify on the existing Ubuntu host through a dedicated Cloudflare tunnel. Public login, 20 module routes and a clean-database encrypted backup restore are verified. See the [deployment/operator guide](docs/deployment-coolify.md) for startup, permanent administrator credentials, release and recovery procedures. Off-host backups and school pilot acceptance remain open.

Automatic deployment from GitHub `main` is enabled and [verified end to end](https://github.com/shintakino/MATMS/actions/runs/41775997721). The [workflow](.github/workflows/deploy.yml) checks types, PostgreSQL integrations and browser scenarios, then publishes immutable images and deploys through Coolify after a pre-migration encrypted backup. The existing database, accounts and volumes are preserved. This checkout tracks `origin/main`, so ordinary `git push` triggers the workflow. Routine Compose replacement still briefly interrupts service; automatic deployment does not establish zero downtime. See the [progress tracker](context/progress-tracker.md) for evidence and the operator guide for pause/retry/rollback controls.

The Property Custodian register and ledger, physical counts, controlled import and XLSX/print workflows are connected and under verification. [Specs 10–13](context/feature-specs/README.md) remain in progress: rendered comparison against the supplied forms and school approval are still open. See the [workbook reference](context/inventory-workbook-reference.md) and progress tracker for source findings and test evidence.

See the [progress tracker](context/progress-tracker.md) for completed documentation, upcoming work, and unresolved school decisions.

For step-by-step instructions and fictional examples for staff and administrators, see the [MATMS user guide](docs/user-guide.md).

The scheduling revision adds a separate **SHS/JHS teacher and personnel directory**. Teachers need no login. Admin and linked personnel file leave for themselves or others; only Admin manages internal equipment/facility reservations and approves requests. Admin can copy/share expiring single-use teacher leave or published-resource request links, including for students. Separate public calendars remain `/availability` and `/leave-calendar`; temporary requests use `/reservation` with the full Admin-provided link. Configure limits/directory/publication in **Leave setup**, and publish units in **Bookings → Manage resources**. Reservations preserve stock and custody accounting. The on-behalf/public-link revision is deployed and verified (`586c9df`); see [spec 14](context/feature-specs/14-leave-and-resource-bookings.md), the [user guide](docs/user-guide.md) and the [progress tracker](context/progress-tracker.md) for current deployment state.

The light interface uses shared slate/teal styling, grouped module navigation, responsive forms and registers, and a dashboard overview. Official inventory forms retain their own report typography and print layouts. Filing and custody workflows include guided steps and searchable selection; stock operations require explicit confirmation, and administration provides masked password reset, access previews and readable audit filters.

Future active leave/reservation cards now include **Edit request** with date/reason/purpose/resource changes, an explicit review and required change reason. Saving rechecks availability and requires approval again; failed edits keep the original booking. Cancellation/retirement preserves removal history. See the guide and progress tracker for verification and release status.

## Planned stack

| Concern | Choice |
| --- | --- |
| Frontend | Next.js + TypeScript |
| UI | shadcn/ui + Tailwind CSS; light-first, accessible, responsive |
| Backend | Hono on Bun |
| API | oRPC |
| Authentication | Better Auth; Admin-provisioned accounts |
| Database | PostgreSQL + Drizzle |
| Workspace | pnpm + Turborepo |
| Deployment | Separate web/server Docker images and private PostgreSQL |

The workspace was generated with `create-better-t-stack` 3.49.0. Current pins are Node 22.22.2, Bun 1.4.4, pnpm 11.1.1, Next 16.4.3, Better Auth 1.7.12, and Drizzle 1.0.0-rc.5. The exact requested bootstrap command is maintained in [PRD §3](MATMS-PRD.md#3-chosen-technology-and-bootstrap).

## Development foundation

Copy the secret-free examples before running locally. Do not commit the resulting `.env` files.

```bash
cp .env.example .env
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
```

Start PostgreSQL locally (the optional development overlay publishes it only on loopback; change `MATMS_POSTGRES_PORT` if 5432 is in use), update `DATABASE_URL` in `apps/server/.env` to the same host port, then apply the reviewed migration:

```bash
POSTGRES_PASSWORD=your-local-password docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
DATABASE_URL=postgresql://postgres:your-local-password@127.0.0.1:5432/matms pnpm run db:migrate
pnpm run dev
```

After migrations, create the first Administrator once. The command refuses to run again once an active Administrator exists and never creates default credentials:

```bash
INITIAL_ADMIN_NAME="Archive Administrator" INITIAL_ADMIN_EMAIL="admin@example.edu" INITIAL_ADMIN_PASSWORD="choose-a-long-unique-secret" DATABASE_URL=postgresql://postgres:your-local-password@127.0.0.1:5432/matms pnpm run auth:bootstrap-admin
```

The browser reaches the API through Next.js same-origin rewrites at `/api/auth/*` and `/rpc/*`; PostgreSQL and the Hono service are not published by the base Compose file. Use `pnpm run db:generate` to create reviewed migrations. `db:push:dev` is local-development-only and is never a production release path.

Set `MATMS_CANONICAL_ORIGIN` in `apps/web/.env` to the school's approved public HTTPS origin before generating labels. Administrators may save school settings, including an origin, in `/admin/settings`; once saved, the database setting takes precedence over the deployment fallback. The origin must have no path, credentials, query, or fragment. Labels use that origin and the box UUID; scan/manual lookup still enforces account and record permissions. Origin changes require a recorded redirect/reprint plan: keep an HTTPS redirect from the old origin to the same `/boxes/{uuid}` paths until affected labels are reprinted and verified. Print actual-size samples and calibrate the label dimensions on the school's printers and devices.

Foundation checks:

```bash
pnpm run check-types
TEST_DATABASE_URL=postgresql://.../matms_test pnpm test
```

The database test refuses a URL that does not end in `_test` and proves an audit-write failure rolls back its associated mutation.

The supplied school workbooks, including the Appendix 59 ICS reference, are private local references and are excluded from Git and images. Core workbook tests use fictional data and run without them. Source-comparison tests explicitly skip when their required references are absent; an authorized operator can place the originals at the paths and verify the hashes in [inventory-workbook-reference.md](context/inventory-workbook-reference.md) to run those checks. A skipped source comparison does not establish form fidelity or school approval.

The web production build uses Next.js's supported webpack builder (`pnpm --filter web build`); Turbopack remains the development default. Run `pnpm run check-types` as the strict type gate before building. `MATMS_NEXT_DIST_DIR` can select a dedicated build directory when checking a build alongside a running development instance.

For repeatable fictional records, use `pnpm run seed:dev` with a `_dev`/`_test` database and `SEED_ADMIN_EMAIL` identifying an existing active Administrator. See the [seed and browser-test guide](docs/user-guide.md#reproducible-fictional-development-data) for setup and `pnpm run test:browser`. Do not run browser workflows against real records; they change stock and create custody history.

Reports export the selected authorized filter scope as CSV, up to 5,000 rows. Narrow the filters if the limit is exceeded. Exports are audited before release and limited to five attempts per account per minute; the row limit is provisional pending pilot data. The optional synthetic reporting load test creates and removes fixtures in an isolated `_test` database:

```bash
TEST_DATABASE_URL=postgresql://.../matms_test pnpm run test:reporting-load
```

## MVP scope

- Roles: Admin, Property Custodian, Staff and Viewer, with inherited archive grants and server-enforced custodial permissions.
- Categories, shelf locations, boxes, folders, and document metadata.
- Revision-specific digital master links and printed stock per folder, with atomic updates and immutable ledger history.
- Custodial item/lot register, referenced ledger/reorder, physical counts/amendments, three supported workbook imports and versioned Appendix 58/Annex A.8/Appendix 73 XLSX/print workflows; final form fidelity and acceptance remain in progress.
- Requests, approvals, fulfillment, loans, returns, and relocation history.
- Permission-filtered dashboard, search, reports, CSV export, QR labels, and scanning with manual lookup.
- Audit, safe retirement, backups, restore rehearsal, and a school pilot.

MVP stores metadata and approved links, not scanned files. Google Drive automation, OCR, generic spreadsheet import, XLSX beyond the four supported inventory form families, multi-school support and formal disposal execution are deferred. Controlled inventory uploads/artifacts are a narrow private exception to metadata/link storage. The PRD defines the full scope and school policy gates.

## Documentation

| Document | Purpose |
| --- | --- |
| [User guide and examples](docs/user-guide.md) | Everyday workflows for archive records, stock, requests, loans, reports, and administration |
| [Deployment and recovery guide](docs/deployment-coolify.md) | Coolify service, production access, releases, encrypted backups and recovery evidence |
| [Product requirements](MATMS-PRD.md) | Product baseline, business rules, acceptance criteria, and delivery plan |
| [Project overview](context/project-overview.md) | Goals, users, workflows, and release boundaries |
| [Architecture](context/architecture-context.md) | Service boundaries, data model, security, and invariants |
| [UI context](context/ui-context.md) | shadcn/ui components, theme, navigation, and accessibility |
| [Code standards](context/code-standards.md) | Implementation and verification conventions |
| [Development workflow](context/ai-workflow-rules.md) | Incremental delivery and documentation maintenance |
| [Progress tracker](context/progress-tracker.md) | Actual completion, next steps, and open decisions |
| [Feature specs](context/feature-specs/README.md) | Work units, baseline/extension status and PRD acceptance coverage |
| [Inventory workbook reference](context/inventory-workbook-reference.md) | Seven source sheets, exact form structures and data anomalies |
| [Agent instructions](AGENTS.md) | Required read order and repository-specific rules |

## Starting implementation

1. Follow the context read order in [AGENTS.md](AGENTS.md), then read the relevant PRD sections and active feature spec.
2. Review [00 — Project Foundation](context/feature-specs/00-project-foundation.md) and the existing workspace and toolchain before making foundation changes.
3. Review [01 — Design System](context/feature-specs/01-design-system.md) and reuse the generated shared UI setup.
4. Follow the feature-spec dependencies. Add authorization, audit, and transaction controls with each business operation.
5. Update the progress tracker with actual implementation and verification results.

Use fictional development data. Real school data and production rollout require the PRD's policy decisions, verified inventory, access checks, and backup/restore acceptance gates.

Appendix 59 ICS is live under **Property Inventory → Reports** for Admin/Property Custodian accounts. Select recorded semi-expendable issues, review slip details and export dynamic Excel; saved slips retain immutable data for later downloads. [Release evidence](deploy/ics-verification.json) records revision `28ee582`, successful migration/data preservation, 15 hosted browser scenarios and the live ICS checks. See [the user guide](docs/user-guide.md#appendix-59--inventory-custodian-slip-ics) for the workflow.

The 2026-11-12 ICS revision uses the supplied `ICS-2025-11-001.xlsx` layout, long bond paper, automatic Manila-month numbering, editable versioned slips and Delete/Restore controls. See spec 12 and the user guide for workflow and release evidence.
