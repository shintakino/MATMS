# Non-deployment feature completion audit

Audit and remediation date: 2026-10-28. Baseline: [MATMS PRD](../MATMS-PRD.md) and [specs 00–08](../context/feature-specs/README.md). Deployment/spec 09, Docker deployment checks, and backup restoration acceptance AC-20 are excluded.

## Verdict

**The software gaps identified by this audit have been addressed.** Functional tests, strict workspace types, a webpack production build, Chromium workflows, and the representative synthetic search benchmark pass. Actual school printer/camera scans, assistive-technology acceptance, and the agreed school-device performance profile still require pilot verification. Those checks are not claimed complete and have not been removed from the PRD.

## Checks performed

- Read PRD requirements, role matrix, routes, and acceptance criteria alongside feature specs and implementation.
- Ran `pnpm test` with Bun and the isolated `matms_test` database: 12 tests / 236 assertions passed across database audit, identity/session, archive, inventory, custody, reporting, and QR/RPC URL checks.
- All six configured `pnpm check-types` tasks passed. Turbo output-file warnings are not type failures.
- The installed Next.js webpack production builder completed successfully; protected routes render dynamically. The documented web build selects webpack after the Turbopack optimized build stalled. Development still uses Turbopack.
- Seeded an empty, migrated `matms_browser_test` database with explicit fictional accounts and records; reran the seed without resetting existing balances.
- Chromium passed Admin stock receive/issue/correction, borrow approval/release/return, scoped CSV download, denied/unavailable camera fallback, and anonymous box URL → login → box continuation. Staff and Viewer walkthroughs verified permitted controls and direct Admin-route denial. Axe WCAG A/AA scans reported no violations on 13 core routes; mobile focus and correction-dialog keyboard cancellation/focus return passed.
- A dedicated archive browser scenario passed new-box register refresh, all-status URL persistence, folder creation/edit/relocation, rejected duplicate-document input retention, successful document creation, refiling and displayed movement history.
- Final combined browser run: **6 passed** in 5.5 minutes, including rejection of unexpected RPC errors in the main workflow. Final strict types and `MATMS_NEXT_DIST_DIR=.next-webpack-check pnpm --filter web build` passed after the register fixes. Local preview readiness/login checks passed on ports 3000/3001.
- A4 and single-label PDF generation passed; print screenshots confirmed that navigation and its gutter are absent. Physical printing and actual camera recognition were not performed.
- The all-type search benchmark passed at p95 **464 ms** for 60 calls in batches of 20, with 500 boxes / 5,000 folders / 50,000 documents / 2,000 inventory lines. This replaces the earlier failed 15,572 ms measurement. It measures local service calls, not 20 distinct signed-in users or school-device page rendering.

## Feature matrix

| Spec | Remediated implementation | Verification boundary |
| --- | --- | --- |
| 00 Foundation | Workspace, migrations, validated environments, health/API/audit boundary, five baseline categories and repeatable fictional seed | Strict types and production build pass; Docker/deployment excluded. |
| 01 Design system | Shared light shadcn/ui shell, states, labels, accessible confirmations, one main landmark | Automated checks and representative keyboard/mobile flows pass; school assistive-technology walkthrough remains. |
| 02 Identity/access | Accounts, inherited grants, consistent template visibility, assisted recovery, configurable idle/absolute session policy | Password/reset, expiry/renewal cookies, SSR non-renewal, roles and QR continuation verified. No email provider configured; assisted reset is the PRD fallback. |
| 03 Archive | Folder/document edits, Staff relocation, refile forms, breadcrumbs, scoped contents/history, lifecycle safeguards and paged registers | Metadata authorization/rollback, concurrent moves, retired-code protection and service regressions pass; browser workflows recorded above. |
| 04 Templates/inventory | Revision identity before activity, validated same-family supersession, threshold edits, +1/-1 with reasons, confirmed corrections and shared refresh | Integration checks cover immutability, supersession, threshold permissions/rollback, balances/replay/concurrency; stock browser workflow passes. |
| 05 Requests/loans | Drafts, decisions, fulfillment, release/return, exceptions, aggregate status, replay and concurrency safeguards | Borrow browser flow passes; integration covers inspect/copy, partial progress, restricted decisions, exceptions and rollback. |
| 06 Dashboard/search/reports | Scoped metrics/search, paged registers, filters, seven reports, CSV, permitted Staff movement actor/location/reason | Functional/export browser checks pass; synthetic search target passes. Agreed school-device ≤1.5 s target remains unmeasured. |
| 07 QR | Scoped selection, stable URLs, A4/single preview and print isolation, camera/manual fallback, validated continuation | Chromium/PDF checks pass; real printer calibration and camera scans remain. |
| 08 Administration/lifecycle | Users/grants/audit/settings, approved configurable session limits, lifecycle confirmations and guards | Service checks and Admin-route accessibility scans pass. Retention/disposal authority and pilot sign-off remain school decisions. |

## Original findings and resolutions

1. **Template visibility:** [Inventory service](../packages/api/src/inventory-service.ts) now scopes list/detail/master metadata through authorized stock folders for non-Admins; search uses the same visibility rule. Regression tests cover unstocked, inaccessible, granted and revoked cases.

2. **Archive maintenance:** [Archive service](../packages/api/src/archive-service.ts) and [maintenance forms](../apps/web/src/components/archive-maintenance.tsx) implement folder/document metadata edits, folder moves and document refiling. Staff have permitted box moves and document edits, with server-side scope and confidentiality checks.

3. **Archive details:** [Detail screens](../apps/web/src/components/archive-register.tsx) show permitted documents/stock, metadata, home breadcrumbs and retired-document filtering. [Movement history](../apps/web/src/components/archive-history.tsx) includes actor, time, permitted source/destination and reason; Viewers receive no operational history.

4. **Confirmations and refresh:** Box details and stock corrections require descriptive review dialogs. [Inventory operations](../apps/web/src/components/inventory-register.tsx) refresh related cached views after success and errors, retain failed input and preserve the operation ID across ambiguous retries. New box creation also refreshes its paged register.

5. **Template/stock controls:** Identity edits are allowed before stock activity or supersession. New revisions validate their predecessor and atomically supersede it; old printed stock retains its identity. Threshold changes are authorized/audited; [line controls](../apps/web/src/components/stock-line-controls.tsx) collect reasons for +1/-1 and an Admin decision for superseded issuance. Revision status is displayed.

6. **Search latency:** Ordered candidate queries apply authorization and filters before limiting results, then union bounded branches. Reviewed code-order/inventory indexes and disabling PostgreSQL JIT for short operational queries bring the measured all-type scenario under 500 ms. See the [query assessment](../context/feature-specs/06-dashboard-search-and-reports.md#query-assessment) for reproduction and limitations.

7. **Staff history:** [Reporting service](../packages/api/src/reporting-service.ts) includes permitted movement context and ledger reason/reference/operation ID for Staff. Related inaccessible locations/reasons are redacted instead of exposing their names.

8. **Setup/session policy:** [Development seed](../packages/api/src/seed-development.ts) adds all five baseline categories and fictional records without default credentials. Admin settings validate/audit idle and maximum lifetime; [session context](../apps/server/src/session-context.ts) enforces both before renewal and forwards browser renewal cookies. Backdated session fixtures verify expiry without hours of sleeping. Email recovery remains conditional on a configured provider; assisted recovery is verified.

9. **Validation/list/lifecycle edges:** Router dates validate real calendar dates. Registers page/filter on the server and retain filters in URLs, including all-status selection. Retired box codes cannot change, and their retained rows reserve uniqueness; UUID QR identity survives active renames. Box moves lock before reading the source snapshot; concurrent-move tests verify a correct history chain.

## Acceptance evidence

| Acceptance criteria | Current evidence and limit |
| --- | --- |
| AC-01 | Anonymous box URL → login → authorized box verified in Chromium; physical camera opening remains a device check. |
| AC-02/03 | Role and inherited-scope regressions pass, including catalog visibility; Staff/Viewer browser controls verified. |
| AC-04 | Stable UUID after rename and browser/PDF labels verified; physical old-label scan remains a device check. |
| AC-05/06 | Service arithmetic and stock labels pass; browser receive six → issue two → Low stock verified. |
| AC-07/08/09 | Inventory concurrency/replay/transfer and custody replay checks pass; coverage is scenario-specific, not exhaustive. |
| AC-10 | Stale correction rejection, authoritative refresh, descriptive confirmation and keyboard focus return covered. |
| AC-11/12/13 | Custody integration covers concurrent release, partial progress and return/exception behavior; borrow/release/return browser flow passes. |
| AC-14/15 | Scoped history, concurrent source snapshots and lifecycle/dependency guards pass. |
| AC-16 | Invalid/external URL validation and browser camera failure/manual lookup pass; real camera recognition remains a device check. |
| AC-17 | Scoped export/formula escaping tests and browser CSV download pass. |
| AC-18 | Deactivation/revocation, password reset/change, idle/absolute expiry and attribution checks pass. |
| AC-19 | Actual A4/single-label printed scans on school devices unverified. |
| AC-20 | Excluded: deployment/restore scope. |
| AC-21/22 | Thirteen routes pass automated WCAG A/AA scans; representative mobile/keyboard/dialog checks pass. Full school assistive-technology acceptance remains. |

## Remaining acceptance work

1. Print A4/single samples at actual size and scan them with the school's cameras, including renamed-box labels.
2. Run the agreed school-device/network usable-content target and representative real-user workload; the synthetic benchmark is not a substitute.
3. Complete staff and assistive-technology walkthroughs and approve school session/retention/disposal policies before real-data expansion.
4. Handle deployment, Docker images, TLS, backups/restore and release sign-off separately under spec 09, as requested.

Keep the PRD requirements intact. Update implementation and verification status as each item is actually closed; do not redefine requirements to mark incomplete features complete.
