# MATMS Feature Specs

These units derive from [MATMS-PRD.md](../../MATMS-PRD.md) v1.3. Read `AGENTS.md`, context in the prescribed order, relevant PRD sections and the active spec before implementation. Status and [progress](../progress-tracker.md) separate verified baseline software from new requirements. The [workbook reference](../inventory-workbook-reference.md) records all seven source sheets and their layout/data anomalies.

## Coverage and status

**Active extension:** [14 — Leave and resource bookings](14-leave-and-resource-bookings.md), PRD FR-12. On-behalf directory/public-invitation revision deployed and verified (`586c9df`). Workflow choices are confirmed; quotas, enrollment and publication require Admin configuration. Existing official-form acceptance gaps remain open.

| Spec | Scope | PRD requirements | Acceptance coverage | State |
| --- | --- | --- | --- | --- |
| [14 — Leave and bookings](14-leave-and-resource-bookings.md) | SHS/JHS/personnel directory, delegated leave, Admin resources, expiring public links, request editing/reapproval, separate calendars | FR-12, §5 | AC-37–AC-41 | Deployed and verified (`586c9df`) |
| [00 — Foundation](00-project-foundation.md) | Existing workspace, service/db/audit foundation | §§3–4, 8–9, 12 | Foundation for all | Baseline implemented |
| [01 — Design system](01-design-system.md) | Shared UI/shell; new inventory navigation/forms | §10, §11 accessibility | AC-21, AC-22 | Baseline implemented; extension in progress |
| [02 — Identity/access](02-authentication-and-access.md) | Accounts/grants; Property Custodian and draft assignments | FR-01, §5 | AC-01, AC-02, AC-03, AC-18, AC-35 | Baseline implemented; extension in progress |
| [03 — Archive](03-archive-records.md) | Categories, filing hierarchy and movements | FR-03, FR-04, §6 | AC-04, AC-14, AC-15 | Baseline implemented; role integration in progress |
| [04 — Printed templates](04-template-inventory.md) | Revisions/folder stock; separate route and role extension | FR-05, FR-06 | AC-05, AC-06, AC-07, AC-08, AC-09, AC-10 | Baseline implemented; extension in progress |
| [05 — Requests/loans](05-requests-and-loans.md) | Approval, fulfillment and document custody | FR-07 | AC-08, AC-11, AC-12, AC-13 | Baseline implemented; role integration in progress |
| [06 — Dashboard/reports](06-dashboard-search-and-reports.md) | Scoped search/CSV; new custodial metrics and report entry points | FR-02, FR-08 | AC-03, AC-17, AC-25, AC-35 | Baseline implemented; extension in progress |
| [07 — QR](07-qr-labels-and-scanning.md) | Existing box labels/scanning | FR-09 | AC-01, AC-04, AC-16, AC-19 | Baseline implemented; new-role checks in progress |
| [08 — Administration](08-audit-lifecycle-and-administration.md) | Audit/lifecycle; inventory profiles/sections/policy/signatories | FR-10, FR-11, §§5–6 | AC-15, AC-18, AC-27, AC-35, AC-36 | Baseline implemented; extension in progress |
| [10 — Custodial register/ledger](10-property-custodian-inventory.md) | Item/lots, balances, postings, reorder and card projection | FR-11 register/transactions/Stock Card, §§6, 8–9 | AC-23, AC-24, AC-25, AC-35 | In progress |
| [11 — Physical counts](11-physical-count-sessions.md) | Frozen counts, assignments, signed variance, finalize/amend | FR-11 counts, §§6, 8–9 | AC-26, AC-27, AC-34, AC-35, AC-36 | In progress |
| [12 — Official forms](12-official-inventory-forms.md) | Appendix 58/Annex A.8/Appendix 73 profiles, XLSX/print, fidelity | FR-11 forms/generation, §§8–11 | AC-28, AC-29, AC-30, AC-31, AC-35, AC-36 | In progress |
| [13 — Controlled import](13-controlled-inventory-import.md) | Three supported structures, preview, mapping, atomic commit | FR-11 import, §§8–11 | AC-32, AC-33, AC-34, AC-35 | In progress |
| [09 — Deployment/pilot](09-deployment-and-pilot.md) | Operations, restore and full release acceptance | §§11–17 | AC-20; final AC-01–AC-36 gate | Coolify/automatic releases/clean restore verified; off-host backups and pilot open |

## Active sequence

Specs 10–13 have connected implementations and remain in progress until their remaining acceptance checks are completed. Preserve existing spec numbers and evidence. The user authorized an initial clean deployment under 09 on 2026-11-04; the full deployment/pilot release gate still requires the domain and school approvals.

Spec 12 explicitly delivers Export Excel (.xlsx): one RPCPPE workbook with all three source sheets, one RPCSP workbook with all three source sheets, and an Appendix 58 Stock Card workbook. Preview, dynamic rows, corrected calculations, generation/download and history are connected; source-rendered fidelity and full acceptance remain open.

Every protected mutation includes authorization, audit, transactions and durable replay with its implementation. AC-21/AC-22 apply across all new screens. New role permission must be wired into existing archive, template, request and label paths without bypassing inherited restrictions. Ordinary Staff export/label permission does not include official inventory forms.

Source-faithful means matching the supplied layout/fields, with PRD-required pagination and correct server calculations; it does not mean copying defective source formulas. Keep profiles/data separate and historical snapshots reproducible. The workbooks are references, not proof of current legal policy. Record school decisions, verification results and remaining acceptance in the progress tracker after each meaningful change.

Appendix 59 ICS generation is a user-authorized extension under spec 12, using selected posted semi-expendable issues and immutable report snapshots. See spec 12 for its scope and verification gates.

The 2026-11-12 ICS revision uses the supplied `ICS-2025-11-001.xlsx` layout, long bond paper, automatic Manila-month numbering, editable versioned slips and Delete/Restore controls. See spec 12 and the user guide for workflow and release evidence.
