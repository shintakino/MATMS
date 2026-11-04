# Development Workflow

## Read order and authority

Read the six context files in the order specified by `AGENTS.md`, then the relevant MATMS-PRD sections and feature spec. The PRD defines product requirements; context defines implementation guidance; feature specs define verifiable work units. User-approved changes must be reconciled across these documents before dependent implementation.

Use [feature-specs/README.md](feature-specs/README.md) for sequencing and requirement coverage. Specs describe implementation requirements; check their status and [progress-tracker.md](progress-tracker.md) for verified completion before starting.

## Bootstrap first

1. Inspect repository contents; do not overwrite documentation when scaffolding into the existing repository.
2. Use the requested Better T Stack configuration from PRD §3 and record the actual CLI/toolchain versions. Inspect output before establishing paths, scripts, adapters, or runtime assumptions.
3. Reuse generated auth, database, environment, and UI infrastructure. Initialize/extend shadcn/ui only where missing.
4. Read the relevant installed Next.js guides before writing frontend code. If dependencies/guides do not exist, complete scaffold inspection before coding against assumed APIs.
5. Keep seed data fictional and production credentials out of source control.

## Delivery units

Work in small, verifiable increments within the active feature spec. A domain spec may require several increments: contract/schema, service and transaction tests, then UI and browser verification. A small end-to-end increment can span those boundaries when necessary; do not combine unrelated features merely because they share a page.

Establish auth/grant filtering and audit infrastructure before shipping protected mutations. Add immutable history and concurrency controls with the business operation, not as later cleanup. Mock UI data may support foundation previews but must be labeled and never represented as working persistence or authorization.

## Missing requirements and school decisions

- Resolve ordinary implementation choices using the PRD and scaffold; document material decisions.
- Record unresolved product/policy questions in the progress tracker. Continue independent work; do not invent school retention rules, restricted-record policy, loan defaults, branding, or hosting approval.
- Resolve an ambiguity before implementing behavior that depends on it. Keep production policy gates distinct from development setup and fictional-data testing.
- PRD v1.3 explicitly includes the three supported inventory workbook imports and official XLSX/print outputs. Keep their private upload/artifact scope narrow; general scanned uploads, generic spreadsheet import, document automation, multi-school support and disposal execution remain deferred.

## Shared UI components

Use the shadcn/ui CLI to add required primitives. Prefer tokens, exposed variants, and feature wrappers for customization. Do not hand-edit installed library internals. A justified shared primitive change must remain reusable, be documented, and retain keyboard/focus behavior. Routine work within the user's authorized scope does not require a separate permission step.

## Verification and handoff

1. Check the active spec's acceptance criteria and relevant PRD AC IDs.
2. Run appropriate checks available in the actual workspace; report failures and checks that could not run accurately.
3. Verify permission boundaries, transaction/history invariants, and loading/error behavior for the changed feature.
4. Update affected architecture, scope, UI, or standards documents before proceeding with dependent changes.
5. Update `progress-tracker.md` after every meaningful implementation change, separating documentation, scaffold, implemented behavior, and verified deployment.
6. Report the outcome, verification, remaining limitations, and next unit without claiming unimplemented features are complete.

The release gate is PRD §§13–17: acceptance checks, reviewed migrations, reproducible dependencies, staff pilot validation, restore rehearsal, operational guide, and resolution of critical authorization/data-integrity defects.

## Property Custodian delivery sequence — PRD v1.3

This documentation extension does not reclassify existing specs as fully verified against the expanded PRD. Keep their baseline evidence and mark role/navigation/report/admin extensions in progress until fully checked.

1. Read the untouched source workbooks and [reference](inventory-workbook-reference.md); use hashes/coordinates to trace each field, sheet variant and anomaly. Do not import school values or real signatories as development defaults.
2. Start spec 10 with role contracts from 02, shell/navigation from 01 and scoped audit/settings from 08; implement the register/ledger and chronological card projection without re-scaffolding.
3. Establish spec 12 profile/version and canonical snapshot contracts, then spec 11 counts/finalization/amendments. Complete spec 12 XLSX/print fidelity for all seven sheet variants and spec 06 integration.
4. Implement spec 13 bounded preview/validation/commit using proven ledger/count services, with source anomalies resolved explicitly. Preserve default atomic commit and count-only import behavior.
5. Repeat affected baseline role, archive, template and custody checks. Record new integration, structural/rendered golden, accessibility and performance results separately from prior verification.
6. Keep deployment 09 deferred until authorized; the full release gate expands to AC-01–AC-36 and includes form-profile, opening inventory, import reconciliation and Property Custodian printed-sample acceptance.

School/accounting approval is required before production profiles, threshold policy and real-data migration. That gate does not prevent fictional schema/service/UI development or require repeated permission for routine authorized documentation work.
