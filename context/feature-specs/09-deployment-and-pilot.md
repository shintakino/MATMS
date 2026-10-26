# 09 — Deployment, Backup and Pilot Release

**Status:** Planned.

**Source:** PRD §§11–17; AC-20 and final AC-01–AC-22 acceptance gate.

**Dependencies:** Working domain units; school/hosting decisions required before real-data production use.

## Deployment and operations

- Build separate Next.js web and Bun/Hono server images with reproducible multi-stage builds and the pnpm lockfile. Verify the frontend's supported runtime rather than forcing Bun into every image.
- Production Compose includes reverse proxy/TLS, web, server, private PostgreSQL, persistent DB volume, health checks, restart policies and a controlled backup process. Keep development configuration separate.
- Run least-privilege processes. Keep secrets in deployment secret management or host-controlled environment files, never images, repository, logs, or public variables.
- Use generated environment validation for database connection, auth secret/base URL, trusted origins, public origin, ports and optional mail credentials.
- Database access uses the internal Compose hostname; browsers use the public origin. Do not publish PostgreSQL publicly.
- Run reviewed migrations once as a controlled release step. Do not use production schema push or competing replica migrations.
- Provide redacted structured logs, liveness/readiness, database pooling, request timeouts, graceful shutdown, error monitoring, disk/backup alerts, and rollback guidance.

## Backups and recovery

Proposed targets pending school/operator confirmation: daily encrypted backups, 30-day rolling retention, RPO ≤24 hours, RTO ≤4 hours during staffed support. Store backups separately from the database host and restrict restore access. Volumes are persistence, not backup.

Rehearse restore into a clean environment before launch and at least quarterly. Verify login, record lookup, stock/ledger reconciliation, and preserved custody/audit history. Record actual restore duration and results. Image rollback must respect schema compatibility and account for writes since deployment; a restore is not a lossless substitute for a migration rollback plan.

## Pilot and acceptance

1. Resolve school-approved shelf/category naming, account list, restricted-record policy, requester-data retention, loan defaults, hosting/domain/TLS, backup ownership, and incident contact.
2. Complete relevant unit, PostgreSQL integration, API authorization and browser checks from PRD §15. Test concurrency, retries, audit rollback, permissions, state transitions and safe exports.
3. Verify AC-01–AC-22; run desktop/mobile accessibility checks, real printed-label scans, and representative synthetic-data performance tests.
4. Pilot one shelf and a small template set. Staff verify physical locations/counts; enter opening balances as attributable transactions and reconcile discrepancies before expansion.
5. Confirm at least 95% of active pilot boxes/folders have verified locations and at least 90% of pilot lookups succeed within 30 seconds.
6. Provide an operator guide covering accounts/access, stock adjustment, checkout/return, exceptions, relocation, retirement, backup/restore and escalation. Obtain school pilot sign-off.

The indicative four-week schedule is not proof of readiness. If scope must shrink, preserve authorization, transaction history and backups; camera scanning can give way to manual/phone-native scanning and report presentation can be simplified by an explicit scope update.

## Verification and handoff

- Clean restore can authenticate, find records and reconcile balances with the ledger (AC-20).
- Production TLS, origin routing, session protections, DB isolation, migration procedure, persistence and health checks are verified.
- Reviewed migrations/lockfile, configured secrets/accounts, operator guide, acceptance results and staff sign-off are recorded.
- No unresolved critical authorization, data-loss or inventory-integrity defect remains.
- Progress tracker records actual deployment and restore results; do not mark production complete based only on Docker files.
