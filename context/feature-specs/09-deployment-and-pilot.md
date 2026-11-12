# 09 — Deployment, Backup and Pilot Release

**Status:** Coolify/Cloudflare deployment, checked automatic releases and clean-database restore verified (2026-11-04). Off-host backups/alerts, populated recovery and school pilot acceptance remain open.

**Source:** PRD §§11–17; AC-20 and final AC-01–AC-36 acceptance gate.

**Dependencies:** Working domain units; school/hosting decisions required before real-data production use.

## Initial deployment evidence — 2026-11-04

The authorized clean deployment is live at `https://matms.shintakino.qzz.io`. Coolify reports the service healthy; migrations exited successfully; the web/API run without root and use a private database with a non-owner runtime role. Public Chromium checks passed on 20 routes, administrator authentication, secure cookies, protected continuation, denied anonymous download, malformed/cross-origin uploads, mobile navigation and Property Inventory accessibility. HTTP 308 preserves the path/query and HTTPS/private health checks remain independent. A Coolify redeployment retained the permanent Administrator and bootstrap audit in the existing volumes. The new database contains one permanent Administrator and no sample inventory.

A checksum-verified encrypted backup restored into isolated temporary database/API containers in 35.52 seconds; all 40 public tables matched and the restored Administrator authenticated. The clean database contained no inventory/custody/report history to reconcile. AC-20's populated recovery checks and the complete release acceptance gate remain open. Daily encrypted backups are currently on the same host; off-host delivery and external alert channels are not configured. See the [operator guide](../../docs/deployment-coolify.md), [release manifest](../../deploy/release-manifest.json) and [progress tracker](../progress-tracker.md).

GitHub Actions automatic releases from `main` are enabled. [Run 41775997721](https://github.com/shintakino/MATMS/actions/runs/41775997721) passed hosted strict types, PostgreSQL integrations, six release invariant tests and 11 Chromium scenarios; all three immutable GHCR images published and deployed successfully. Pre-migration encrypted backup and migration tasks exited zero; web/API revision and attempt/build IDs, public login/20 routes, permanent Administrator and volume identities were verified. The deployment gateway blocks dashboard/secrets/unrelated paths and requires authentication for permitted service APIs. Production secret values remain in Coolify; the Actions environment holds the scoped automation token. Compose replacement still briefly interrupts service. The [automation receipt](../../deploy/automation/deployment-verification.json) records the exact images and run.

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
3. Verify AC-01–AC-36; run desktop/mobile accessibility checks, real printed-label scans, and representative synthetic-data performance tests.
4. Pilot one shelf and a small template set. Staff verify physical locations/counts; enter opening balances as attributable transactions and reconcile discrepancies before expansion.
5. Confirm at least 95% of active pilot boxes/folders have verified locations and at least 90% of pilot lookups succeed within 30 seconds.
6. Provide an operator guide covering accounts/access, stock adjustment, checkout/return, exceptions, relocation, retirement, backup/restore and escalation. Obtain school pilot sign-off.

The PRD v1.3 indicative six-week schedule is not proof of readiness. If scope must shrink, preserve authorization, transaction history and backups; camera scanning can give way to manual/phone-native scanning and nonofficial dashboard presentation can be simplified by an explicit scope update. Preserve approved official inventory layouts, immutable counts and custodial ledger integrity.

## Verification and handoff

- Clean restore can authenticate, find records and reconcile balances with the ledger (AC-20).
- Production TLS, origin routing, session protections, DB isolation, migration procedure, persistence and health checks are verified.
- Reviewed migrations/lockfile, configured secrets/accounts, operator guide, acceptance results and staff sign-off are recorded.
- No unresolved critical authorization, data-loss or inventory-integrity defect remains.
- Progress tracker records actual deployment and restore results; do not mark production complete based only on Docker files.

## Expanded inventory release gate — planned

The user authorized an initial clean deployment on 2026-11-04. School/form acceptance remains a separate release gate after 10–13 and their cross-cutting extensions. Include private import/export storage expiry and resource limits, parser/font availability and any required generation worker in deployment/restore procedures. Back up custodial balances/ledger, count snapshots, used profiles/signatories, provenance/export history and retained artifacts where applicable.

Confirm school/accounting form-profile approval, effective threshold, fund/section mappings, property-number exceptions, missing-value treatment, signatories, verified opening inventory and import reconciliation before real-data expansion. Pilot one section from each form family and actual-size printed Appendix 58/RPCSP/RPCPPE samples with Property Custodian sign-off. Extend the operator guide to posting/corrections, back-dating, count finalization/amendment, import review/commit and safe official generation. A restore must reconcile both inventory domains and reproduce historical report data/layout. Complete AC-23–AC-36 alongside the original scenarios; old archive verification does not satisfy the expanded release.

## Appendix 59 ICS activation — 2026-11-11

The checked release `28ee582` / [workflow 42963992328](https://github.com/shintakino/MATMS/actions/runs/42963992328) activated ICS in Property Inventory reports. Pre-migration backup, reviewed migration, exact image/runtime identities and existing data/volumes were verified. Live ICS queries, anonymous denial, mobile layout and the 27-route sweep passed, including six zero-violation accessibility scans. No production sample stock or slips were created. See the [ICS evidence](../../deploy/ics-verification.json) and current [deployment receipt](../../deploy/automation/deployment-verification.json).

## ICS layout and management activation — 2026-11-12

Revision `6c6a935` / [workflow 43145665286](https://github.com/shintakino/MATMS/actions/runs/43145665286) activated the reference-based long-bond layout, monthly automatic numbering, editable immutable revisions and Delete/Restore controls. The deployment-only retry recovered a gateway failure before production changes, reusing all passed checks and image builds. Backup/migration exited zero; images/runtime identity, volumes, Administrator, row counts and prior audit/ledger/ICS hashes were preserved. Existing ICS numbers and version-1 links were checked. All 27 live routes, mobile ICS/history controls and six zero-violation accessibility scans passed with no browser errors. See [v2 evidence](../../deploy/ics-v2-verification.json); native Excel and school printer acceptance remain open.
