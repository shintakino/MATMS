# 08 — Audit, Lifecycle and Administration

**Status:** Implemented, including audited session-policy settings, history and confirmations. Integration checks and automated accessibility scans of Admin screens pass (2026-10-28). School policies and final staff/pilot acceptance remain open.

**Source:** PRD FR-10, §§5–6, 8–11, 17; AC-15, AC-18.

**Dependencies:** Audit persistence starts in 00; apply mutation auditing from 02 onward. This spec completes administration and cross-domain lifecycle verification after 03–05.

## Audit behavior

Audit creates, edits, role/grant changes, stock operations, approvals, releases, returns, relocations, exports, and retirement. Record actor, action, entity, UTC timestamp, correlation ID, and relevant redacted before/after fields.

- Business writes and their audit record commit together; audit failure rolls back the write.
- Audit logs and stock ledger are append-only through application APIs. No edit/delete controls or cascading history deletion.
- Never log passwords, cookies, session tokens, or unnecessary document contents.
- Admin sees the system audit browser. Staff sees only permitted operational history; Viewers see neither operational history nor system audit.
- Deactivated users remain attributable in historical events. Database administration is a separate privileged boundary.

## Lifecycle

- Retired records are hidden from default operational lists but available through authorized filters/history.
- Admin-only archive retirement checks the target and affected descendants for unresolved loans, active request lines, and remaining inventory. Resolve or relocate these first; block the operation with actionable authorized reasons.
- Archived boxes remain searchable, accept existing loan returns, and prohibit new filing/routine inventory operations until Admin reactivation.
- Preserve immutable UUID identities and retired code uniqueness; do not hard-delete records with history through normal UI.
- Do not ship a destructive Dispose action or invent retention periods. Recording a pre-existing disposal event requires an agreed school procedure, authority reference, and date; keep that capability unavailable until the policy is resolved.

## Administration UI

Use Admin routes under `/admin/*` for users/grants (02), categories/locations (03), audit, and settings. Settings include school name, timezone, canonical URL and permitted policy configuration; secrets stay in deployment configuration.

Compose filtered audit tables, structured redacted change details, forms and descriptive Alert Dialog confirmations from 01. Account deactivation, permission changes, retirement, and corrections must state consequences. Canonical URL changes warn about existing labels and require a redirect/reprint plan.

## Verification

- A box/folder/document with unresolved operational dependencies cannot be retired (AC-15).
- Deactivated identities retain attribution without active access (AC-18).
- Failed audit insertion leaves no associated mutation committed.
- Direct attempts to modify audit/ledger history fail; role/grant changes produce attributable audit.
- Archived return exceptions work without allowing new issue/file operations.
- Confidential related values do not leak through history filters, details, or errors.

## Implementation and remaining verification

The Admin audit and grant browsers, school settings, category/location activation, and box/folder/document lifecycle controls are implemented. Settings use the singleton `school_settings` table; an audited redirect/reprint plan is required to change the saved canonical origin. Timezone remains Asia/Manila, and unapproved retention and disposal policies are not configurable. Stock and filing operations recheck active locations inside transactions coordinated with lifecycle changes.

The isolated integration suite covers role denial, restricted grants, audit redaction/rollback, request/loan and inventory retirement guards, concurrent stock versus archival, archived returns, settings changes, configurable session policy and deactivation/session revocation. Chromium verifies representative confirmations, keyboard focus return, role controls and core workflows; automated WCAG scans include all Admin routes. Synthetic all-type search now meets its 500 ms target. School disposal policy, comprehensive assistive-technology/staff acceptance, actual hardware checks and real-data pilot sign-off remain release gates.

## Planned custodial administration — PRD v1.3

- Audit custodial masters/lots, verified openings/postings, corrections, assignment changes, explicit snapshot refreshes, finalization/amendment, import preview/commit and report preview/generation. Operational history is permission-scoped; system audit remains Admin-only. Audit failure rolls back associated writes or prevents artifact release.
- Admin maintains report sections/mappings, effective-dated classification threshold, versioned form profiles, source labels/layouts and default signatories. Used profile versions are immutable; changes require a new version/note and visual approval. Snapshot session-specific names/designations before finalization. Property Custodian cannot change these defaults/policies through role or report APIs.
- Preserve the source PHP 50,000 convention as pending school/accounting confirmation; never silently reclassify prior lots/reports. Resolve duplicate-number exceptions with Admin attribution and provenance.
- Property Custodian may retire custodial items only within approved policy and after zero-balance/unresolved-operation checks; this grants no archive retirement or disposal authority. Preserve all lot/ledger/count/import/report references. Never retire/delete a finalized snapshot or used profile to erase history.
- Add explicit confirmations for back-dated posting impacts, corrections, finalization, amendments and import commits. Keep wet-signature names distinct from user authority.
- Verify new-role denials, policy/profile version retention, frozen signatories, adjustment/audit rollback, immutable history and guarded retirement (AC-27, AC-35, AC-36). Baseline status above does not cover these additions.
