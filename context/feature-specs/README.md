# MATMS Feature Specs

These are planned implementation units derived from [MATMS-PRD.md](../MATMS-PRD.md), not completed features. Read `AGENTS.md`, the context files in their prescribed order, and the relevant PRD sections before implementation. The PRD remains the source for full requirements and role permissions.

## Sequence and requirement coverage

| Spec | Scope | PRD requirements | Acceptance coverage |
| --- | --- | --- | --- |
| [00 — Bootstrap](00-project-foundation.md) | Scaffold, service boundaries, database and audit foundation | §§3–4, 8–9, 12 | Foundation for all scenarios |
| [01 — Design system](01-design-system.md) | shadcn/ui, light theme, shell, shared states | §10, §11 accessibility | AC-21, AC-22 |
| [02 — Identity and access](02-authentication-and-access.md) | Accounts, roles, inherited grants, sessions | FR-01, §5 | AC-01, AC-02, AC-03, AC-18 |
| [03 — Archive records](03-archive-records.md) | Categories, locations, boxes, folders, documents, movement | FR-03, FR-04, §6 | AC-04, AC-14, AC-15 |
| [04 — Template inventory](04-template-inventory.md) | Revisions, stock, ledger, atomic writes | FR-05, FR-06 | AC-05, AC-06, AC-07, AC-08, AC-09, AC-10 |
| [05 — Requests and loans](05-requests-and-loans.md) | Approval, fulfillment, checkout, return, exceptions | FR-07 | AC-08, AC-11, AC-12, AC-13 |
| [06 — Dashboard and reporting](06-dashboard-search-and-reports.md) | Summary, search, filtered lists, CSV | FR-02, FR-08 | AC-03, AC-17 |
| [07 — QR workflows](07-qr-labels-and-scanning.md) | Label generation/printing, camera and manual lookup | FR-09 | AC-01, AC-04, AC-16, AC-19 |
| [08 — Administration and lifecycle](08-audit-lifecycle-and-administration.md) | Audit browser, retirement, settings, policy gates | FR-10, §§5–6 | AC-15, AC-18 |
| [09 — Deployment and pilot](09-deployment-and-pilot.md) | Docker, operations, restore, acceptance and rollout | §§11–17 | AC-20 and final AC-01–AC-22 gate |

Numbers express a practical starting order, not permission to defer cross-cutting requirements. Establish audit persistence in 00 and apply it to mutations from 02 onward. Grant storage can follow the creation of archive tables in 03, but restricted records cannot ship before enforcement. Implement retirement guards alongside each affected domain; 08 integrates the admin-facing workflows. AC-21/AC-22 and server-side authorization apply to every screen.

Each spec may be delivered in smaller increments. Record actual completion and check results in [progress-tracker.md](../context/progress-tracker.md). Production policy decisions remain open until confirmed; fictional-data development can proceed independently.
