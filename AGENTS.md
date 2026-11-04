<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

## Application Building Context

Read the following files in order before implementing or making any architectural decision:

1. `context/project-overview.md` — product definition, goals, features, and scope
2. `context/architecture-context.md` — system structure, boundaries, storage model, and invariants
3. `context/ui-context.md` — light-first theme, shadcn/ui, administrative layouts, and accessible component conventions
4. `context/code-standards.md` — implementation rules and conventions
5. `context/ai-workflow-rules.md` — development workflow, scoping rules, and delivery approach
6. `context/progress-tracker.md` — current phase, completed work, open questions, and next steps

Then read the relevant sections of `MATMS-PRD.md` and the active spec listed in `context/feature-specs/README.md`. The PRD is the product baseline; resolve conflicting guidance before dependent implementation.

## MATMS Implementation Rules

- Use the PRD's Better T Stack configuration. Inspect generated output before assuming paths, package versions, APIs, or scripts.
- Use shadcn/ui with Tailwind for shared UI components and a light-first theme. Reuse the generated setup, aliases, and utilities; compose domain-specific behavior above the primitives.
- Keep Next.js responsible for presentation and Hono/oRPC responsible for authorized business operations. Use Better Auth and PostgreSQL/Drizzle as documented.
- Enforce roles and inherited restricted-record access server-side, including search, counts, reports, labels, and exports.
- Preserve transaction, audit, idempotency, and custody invariants from the architecture context and active feature spec.
- Keep planned work distinct from verified implementation. If the application has not been scaffolded, preserve existing documentation during setup and read the installed Next.js guides once available before writing frontend code.

## Property Custodian Inventory — PRD v1.3

- Read `context/inventory-workbook-reference.md` and relevant specs 10–13 before changing custodial inventory, physical counts, workbook import or official forms. Reuse the existing workspace; the next implementation unit is spec 10 with the related role/UI/admin extensions.
- Keep printed blank-form stock and Property Custodian inventory in separate balance, ledger and reporting domains. Apply the Admin/Property Custodian/Staff/Viewer matrix server-side; assigned Staff draft entry does not grant custodial posting, import, finalization or official-export authority.
- Treat the three supplied workbooks as field/layout references. Generated Appendix 58, Annex A.8 and Appendix 73 forms must retain their approved columns, merged headers, typography, borders, section order, totals and signature blocks. Preserve the reference originals unless the user explicitly requests edited copies.
- Generate item/lot and transaction rows dynamically from authorized report data, never from a fixed source item list or row capacity. Adding eligible items expands draft/new reports; recompute group merges, formula ranges, totals, print areas, pagination and signature placement. Finalized historical snapshots remain unchanged; draft inclusion changes require explicit refresh/review.
- Correct source calculation defects in the generator: variance quantity is physical count minus frozen card balance; variance value is signed variance times frozen unit value; stock-card balance reconciles the chronological ledger. Build totals/formula ranges from actual included rows, retain missing values separately from zero, and verify XLSX results against authoritative server calculations. Never trust uploaded formulas, cached totals or manually entered variance.
- Preserve atomic ledger/audit writes, durable idempotency, immutable finalized counts/profile versions and linked amendments. Controlled import uses staged preview/resolution followed by explicit atomic commit; imported counts never silently adjust stock.
- Verify every source sheet variant plus empty, growing and multi-page reports. Record structural/rendered checks separately from planned behavior; documentation requirements do not establish that the generator has been implemented.

## Documentation Maintenance

Update `context/progress-tracker.md` after each meaningful implementation change.

If implementation changes the architecture, scope, or standards documented in the context files, update the relevant file before continuing. Keep the PRD, feature specs, and root README consistent with those decisions.
