# Development Workflow

## Read order and authority

Read the six context files in the order specified by `AGENTS.md`, then the relevant MATMS-PRD sections and feature spec. The PRD defines product requirements; context defines implementation guidance; feature specs define verifiable work units. User-approved changes must be reconciled across these documents before dependent implementation.

Use [feature-specs/README.md](../feature-specs/README.md) for sequencing and requirement coverage. Specs describe planned work, not completed features. Check repository state and [progress-tracker.md](progress-tracker.md) before starting.

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
- Do not expand MVP into uploads, document automation, multi-school support, or disposal execution without an explicit scope update.

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
