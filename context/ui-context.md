# UI Context

## Direction

MATMS is a school administrative workspace for record lookup, filing, printed-form stock, document custody and Property Custodian inventory. Use a clean, readable **light-first** theme optimized for desktop work and mobile shelf scanning. Dark mode is optional, not an MVP requirement.

**shadcn/ui with Tailwind CSS is required** to accelerate UI delivery. Reuse the scaffold's setup, aliases, utility helper, and component directory. Initialize shadcn/ui only if absent. Add primitives through its supported CLI after checking the generated project; do not install a second general-purpose UI framework.

## Theme and typography

- Use shared semantic CSS variables and the scaffold's Tailwind token mapping. The shared light palette uses a soft slate workspace, white content surfaces and teal primary/active accents following the requested UI refresh. This is an interface palette; official school branding can still be applied centrally when approved.
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

Target navigation: Dashboard, Boxes, Documents, Templates, Property Inventory, Requests & Loans, Reports. Property Inventory navigation and role-aware screens are connected; complete acceptance remains in progress. Admin also sees Users & Access, Audit Log, and Settings. Hide unavailable actions and report/export capabilities according to the PRD role matrix; server enforcement remains mandatory.

Use PRD §10 routes. Printed-form stock is reachable from Templates at `/template-inventory`; retain `/inventory` as a compatibility redirect when implementing the route change. Property Inventory has separate register, item, card, count, report and import routes under `/property-inventory`. Reach loan views from Requests & Loans and scanning/labels from relevant box workflows. Breadcrumbs expose the authorized shelf → box → folder context. Details distinguish a record's home location from checked-out custody.

- Desktop: sidebar and content area with page heading, primary action, filter row, and list/detail content.
- Mobile: Sheet navigation; compact cards or accessible horizontal table scrolling; reachable scan/manual lookup controls.
- Print: dedicated A4/single-label views with navigation, interactive controls, and transient notifications hidden. Labels show only approved box-level fields, no confidential document titles.

## Domain states and feedback

- Printed-form stock is revision- and folder-specific: `count = 0` → **Out of stock**; otherwise `count <= threshold` → **Low stock**; otherwise **In stock**. Default threshold: 5.
- Show text/icons with status color. Folder color is a filing aid independent of confidentiality, urgency, template designation, and stock status.
- Keep document lifecycle, availability, and loan exception states distinct. Do not imply that an item is physically present because its home folder moved.
- Show superseded revisions/stock separately with the required Admin decision before issuance.
- Stock changes display pending feedback until server confirmation. Do not present a changed balance or success toast before commit; refresh dependent balances, ledger, and summary data after success or conflict.
- Disable duplicate submissions, retain inputs on failure, associate errors with fields, and provide actionable retry/conflict guidance. Keep the same operation ID when retrying the same mutation intent.
- Every data screen needs loading, empty, error, retry, and unavailable/permission states. Unavailable states must not reveal inaccessible record existence.

## Accessibility and verification

Future active scheduling request cards include an inline Edit request form with uniquely associated date/reason/purpose/resource labels, a required change reason and explicit review/confirm controls. Edits disclose approval reset and public unpublication; failed saves preserve input and original booking state. Creation and edit pickers have distinct IDs/URL filter keys, so multiple forms remain accessible. Protected audit history retains before/after values; removal uses cancellation/retirement.

Scheduling adds Leave/Bookings operations, Admin Leave setup, and resource management linked from Property Inventory. Separate public calendars use the shared light theme with month navigation, textual availability states, accessible request links, and a single-column day list on narrow screens. Public equipment/facility views omit private reservation data; the separate opt-in leave calendar displays only approved names/categories/dates. Request forms explain inclusive dates, pending capacity holds and publication. Decision notes and a date review precede approval/rejection/cancellation; errors retain input and creation retains its operation ID for retries.

Target WCAG 2.2 AA for key workflows. Verify keyboard operation, visible focus, descriptive labels, text contrast, form-error associations, dialog focus trapping/return, and non-color status cues. Notifications must not be the only place to find errors. Test responsive layouts on the school's desktop and mobile browsers. Camera denial or incompatibility must leave manual lookup usable.

## Property Inventory workflows and official forms

- Use the existing light shadcn/ui shell, server-paged tables, filter Sheet and Command pickers for class/section/fund/office/condition/reorder/data-quality filters. Show per-office balances and distinct Class, Condition, Variance and Missing-data badges with text.
- Custodial reorder differs from template Low stock: null means unconfigured; zero is a valid point; balance equal to the configured point is Reorder. Never apply the template default of five. Unknown valuation is not PHP 0.00.
- Item detail separates master metadata, acquisition/property lots, balances and immutable ledger. Transaction forms collect date, reference, quantity and source/office/reason; corrections and back-dated postings show expected-version/chronological impact confirmations.
- Count pages use sticky multi-row desktop headers, compact labeled line cards on mobile, nonnegative count input, condition selection, remarks, assignment-aware edit controls and server-confirmed autosave states. Keep zero, uncounted, excluded and unavailable distinct; show Matched/Shortage/Overage with signed quantity/value. Explicit Finalize confirmation states immutability and amendment behavior.
- Import pages use upload → detection → mapping/review → explicit commit/result steps. Show every sheet/section, source coordinates, cached/formula provenance, duplicates, errors, selected/excluded rows and a downloadable safe error report. Preview does not imply operational data was committed.
- Official preview is read-only with profile/version, scope, readiness, exclusions, totals, signatories and page navigation. Generate XLSX and Print/Save as PDF are distinct actions with Admin/Property Custodian capability checks. Draft previews remain marked Draft.
- Label the Excel action Export Excel (.xlsx). Default RPCSP/RPCPPE scope is Full workbook — all 3 sheets; preview lists their names/order, item counts and readiness before generating one downloadable file per family. Keep empty formatted sheets and clearly identify any explicitly selected partial export. Show generation/download/retry states and authorized export history; finalized-session metadata remains read-only.
- Printed forms follow the source fonts, merged titles/headers, widths, borders, row wrapping, totals and signature geometry documented in the [workbook reference](inventory-workbook-reference.md). Stock Card is portrait; RPCSP/RPCPPE are A4 landscape with full repeated headers. App navigation, action controls and toasts do not print. Use the same frozen report data for XLSX and print.
- Property Custodian, committee and School Head names/designations are configurable wet-signature metadata. Preserve signature space and never imply a typed name authorizes a transaction.

Extend keyboard/focus/error and mobile tests to these new workflows; existing archive accessibility results do not cover them. Report typography is a deliberate source-form requirement, while the surrounding workspace continues using shared UI tokens.

## Shared workspace visual refresh

The shell groups role-filtered navigation into Overview, Records & inventory, Operations and Administration. A sticky toolbar provides the current module, record search and user menu; a keyboard skip link reaches the main content. Shared screen styles in `apps/web/src/index.css` unify page headings, panels, form controls, table headers/rows, pagination and empty states across modules. These rules apply on screen and exclude official form tables from workspace table styling. Print geometry remains controlled by the dedicated report and label styles. Dashboard metrics and the responsive sign-in page use the same palette. Respect reduced-motion preferences and retain primitive keyboard/focus behavior.

## Guided inventory workflows

Property Inventory includes plain-language terms, saved-progress guidance and keyboard-accessible links that open the relevant workflow sections. Item setup distinguishes optional lot creation for supplies from office-balance creation and recorded stock activity; a zero balance is not treated as a verified opening. Optional item/report settings and acquisition details remain mounted in native disclosures so values survive closing/reopening. Stock-operation inputs show transfer and issue details only for the selected action. Count guidance uses the currently authorized lines and saved source-change/review information; finalization readiness remains server-authoritative. Import guidance distinguishes staging, row resolution and explicit commit and explains each effect before confirmation.

## Other-module workflow improvements

Printed-template stock operations always open a confirmation before posting; review freezes the selected data and correction version and keeps confirmation errors visible for retry. Transfer and superseded-stock inputs appear only when applicable. Request document selection uses server-paged authorized search and retains a visible selected-record summary across searches/pages. Other complete authorized choice lists use searchable native selectors, preserving the selected choice. Archive intake separates optional metadata, provides prerequisite guidance and links to saved records. Account resets use a masked dialog with matching-password validation, consequences and persistent errors. Access management explains selected-record ancestry and missing parent grants using the protected server preview. Report filters provide a common/advanced split, active-scope summary, restored URL state and report-specific date explanations. Audit filters use actions/actors/types and disclose technical IDs on demand; settings group school identity, session policy and QR website changes.

## Scheduling delegation and public invitations

The active spec 14 revision adds a separate teacher/personnel directory with SHS/JHS labels and optional personnel account links. Leave forms choose the beneficiary separately from the filer; only Admin sees approval controls. Internal resource actions are Admin-only. Admin generates/copies single-use expiring public links, reviews their expiry/use state and can revoke them. The no-login reservation page explains the bound teacher or public resource choices, unavailable dates, inclusive ranges and pending approval, with retained input on failure and clear expired/used/revoked states. Capability tokens remain in the fragment/browser memory and POST bodies, outside shared query caches. Existing public calendars must not suggest that teachers/students need login credentials.

Error alert descriptions and Retry buttons use foreground text for readable contrast on card and outline-button backgrounds. Destructive titles/icons retain their status color. Verify missing/revoked public-link states alongside valid forms.
