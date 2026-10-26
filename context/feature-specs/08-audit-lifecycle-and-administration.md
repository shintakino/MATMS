# 08 — Audit, Lifecycle and Administration

**Status:** Planned.

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
- Admin-only retirement checks the target and affected descendants for unresolved loans, active request lines, and remaining inventory. Resolve or relocate these first; block the operation with actionable authorized reasons.
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
