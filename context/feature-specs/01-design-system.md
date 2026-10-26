# 01 — Design System and Application Shell

**Status:** Implemented on 2026-10-26; browser accessibility and full production-build verification remain pending.

**Source:** PRD §10, §11 accessibility, AC-21, AC-22.

**Dependencies:** 00; use representative fictional fixtures until authenticated data is available.

## Outcome and scope

Establish shadcn/ui and Tailwind as the shared MATMS UI foundation for faster delivery of consistent administrative screens. Default to a readable light theme. Dark mode is optional.

## Implementation requirements

1. Inspect the generated frontend's shadcn configuration, aliases, stylesheet, dependencies, and `cn()` helper. Reuse them. Initialize only what is missing and keep one source for shared primitives.
2. Add primitives through the supported shadcn CLI into the configured UI directory/package. Start with those needed by the shell and first forms; add later primitives with their consuming features.
3. Use shared semantic CSS/Tailwind tokens from `context/ui-context.md`. Keep the generated light palette until school branding is agreed. Preserve reusable primitive behavior; use feature wrappers and global tokens for domain customization.
4. Reuse or add Lucide icons. Keep icon-only controls labeled. Reuse the existing class-merging helper instead of creating another utility path.
5. Build a responsive shell with Sidebar, mobile Sheet, Breadcrumb, user menu, content header, and role-aware navigation. Wire actual permissions when 02 is ready; fixtures are not authorization.
6. Provide shared loading, empty, error/retry, unavailable, inline validation, and pending-submit patterns. Add Sonner for transient results and persistent Alert messages for unresolved problems.
7. Establish Table-based list composition with selection, sorting/filtering controls, pagination, and row actions. It must accept server results/counts and trigger server queries, not filter a single client page as if it were the full dataset.
8. Compose domain wrappers such as StockStatusBadge, LocationBreadcrumb, InventoryActions, and RecordPicker as their contracts become available; do not put domain services inside UI primitives.

## Component plan

| Usage | Primitives |
| --- | --- |
| Shell | Sidebar, Sheet, Breadcrumb, Dropdown Menu, Separator |
| Summary and states | Card, Badge, Skeleton, Alert, Button |
| Forms | Input, Textarea, field/label/error composition, Select, Checkbox |
| Lists and selection | Table, Pagination, Popover, Command |
| Detail and workflows | Tabs, Dialog, Alert Dialog |
| Feedback | Sonner |

Add date controls and scrolling utilities when needed. Do not install all components solely to populate a catalog. Short forms may use Dialog/Sheet; long request workflows use dedicated pages.

## Verification

- Actual type/build checks confirm component imports, aliases, and helper integration.
- Representative shell, table, form, and dialog use the same light theme on desktop and mobile; no legacy dark-only styling remains.
- Keyboard-only operation reaches controls, visible focus is retained, fields/errors are associated, and dialogs restore focus on close.
- Status labels include text; stock fixtures show Out of stock at 0, Low stock at threshold, and In stock above threshold.
- Loading/error/empty and narrow-screen states are usable. Pending mutations do not display unconfirmed balances or success.
- Record AC-21/AC-22 as foundation checks here; repeat relevant accessibility checks on assembled feature screens before release.
