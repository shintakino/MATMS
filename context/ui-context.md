# UI Context

## Direction

MATMS is a school administrative workspace for record lookup, filing, stock, and custody. Use a clean, readable **light-first** theme optimized for desktop work and mobile shelf scanning. Dark mode is optional, not an MVP requirement.

**shadcn/ui with Tailwind CSS is required** to accelerate UI delivery. Reuse the scaffold's setup, aliases, utility helper, and component directory. Initialize shadcn/ui only if absent. Add primitives through its supported CLI after checking the generated project; do not install a second general-purpose UI framework.

## Theme and typography

- Use shared semantic CSS variables and the scaffold's Tailwind token mapping. Start with the generated light palette; school branding can be applied centrally when approved.
- Prefer standard shadcn tokens: `background`, `foreground`, `card`, `card-foreground`, `popover`, `popover-foreground`, `primary`, `primary-foreground`, `secondary`, `muted`, `muted-foreground`, `accent`, `destructive`, `border`, `input`, and `ring`, plus the generated sidebar tokens.
- Add semantic success, warning, and information tokens with suitable foreground pairs only where domain statuses require them. Verify contrast rather than assigning meaning to arbitrary colors.
- Use token-based utilities such as `bg-background`, `text-foreground`, `text-muted-foreground`, and `border-border`. Keep raw color values in theme definitions, not feature markup.
- Retain the scaffold's readable sans-serif stack unless branding requires a change. Use tabular numbers for stock and numeric reports, clear headings, and readable form labels. No mandatory external font download.
- Use the generated radius and spacing scale consistently; do not force oversized rounded corners on dense forms and tables.
- Use Lucide icons if present, or add the dependency when needed. Label icon-only buttons and hide decorative icons from assistive technology.

## Composition

| Area | shadcn/ui approach |
| --- | --- |
| Shell | Sidebar, mobile Sheet, Breadcrumb, Dropdown Menu |
| Summary | Card, Badge, Skeleton, Alert |
| Registers/reports | Table composition, Checkbox, Pagination, Dropdown Menu |
| Search/filtering | Input, Select, Button, Popover/Command for record selectors |
| Forms | Shared field/label/error composition, Input, Textarea, Select, Checkbox, date controls as needed |
| Create/edit | Dialog or responsive Sheet for short tasks; dedicated pages for longer workflows |
| Sensitive actions | Alert Dialog with consequences, required reason and pending state |
| Detail | Tabs, Separator, Badge, structured metadata |
| Feedback | Sonner for transient results; inline errors and persistent Alert for unresolved issues |

The data table is composed from primitives and optional table-behavior tooling; it is not an assumed standalone shadcn grid. Sorting, filtering, pagination, authorization, and export stay server-side. Add primitives as the active feature needs them.

Keep generated UI primitives reusable. Theme through CSS tokens, variants already exposed by primitives, and feature wrappers. Document any necessary shared primitive change; do not embed record permissions or domain logic in `components/ui`.

Reusable domain components include `StockStatusBadge`, `LocationBreadcrumb`, `InventoryActions`, `RecordPicker`, status/availability badges, and empty-state content. These belong above the primitive layer.

## Navigation and screens

Primary navigation: Dashboard, Boxes, Documents, Templates, Requests & Loans, Reports. Admin also sees Users & Access, Audit Log, and Settings. Hide unavailable actions and report/export capabilities according to the PRD role matrix; server enforcement remains mandatory.

Use PRD §10 routes. Inventory is reachable from Templates, loan views from Requests & Loans, and scanning/labels from relevant box workflows. Breadcrumbs expose the authorized shelf → box → folder context. Details distinguish a record's home location from checked-out custody.

- Desktop: sidebar and content area with page heading, primary action, filter row, and list/detail content.
- Mobile: Sheet navigation; compact cards or accessible horizontal table scrolling; reachable scan/manual lookup controls.
- Print: dedicated A4/single-label views with navigation, interactive controls, and transient notifications hidden. Labels show only approved box-level fields, no confidential document titles.

## Domain states and feedback

- Stock is revision- and folder-specific: `count = 0` → **Out of stock**; otherwise `count <= threshold` → **Low stock**; otherwise **In stock**. Default threshold: 5.
- Show text/icons with status color. Folder color is a filing aid independent of confidentiality, urgency, template designation, and stock status.
- Keep document lifecycle, availability, and loan exception states distinct. Do not imply that an item is physically present because its home folder moved.
- Show superseded revisions/stock separately with the required Admin decision before issuance.
- Stock changes display pending feedback until server confirmation. Do not present a changed balance or success toast before commit; refresh dependent balances, ledger, and summary data after success or conflict.
- Disable duplicate submissions, retain inputs on failure, associate errors with fields, and provide actionable retry/conflict guidance. Keep the same operation ID when retrying the same mutation intent.
- Every data screen needs loading, empty, error, retry, and unavailable/permission states. Unavailable states must not reveal inaccessible record existence.

## Accessibility and verification

Target WCAG 2.2 AA for key workflows. Verify keyboard operation, visible focus, descriptive labels, text contrast, form-error associations, dialog focus trapping/return, and non-color status cues. Notifications must not be the only place to find errors. Test responsive layouts on the school's desktop and mobile browsers. Camera denial or incompatibility must leave manual lookup usable.
