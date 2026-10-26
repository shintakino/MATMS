# 03 — Archive Records and Locations

**Status:** Core hierarchy, authorized reads, movement history, grant enforcement, and zero-inventory retirement guard implemented on 2026-10-26. Retirement guards that depend on request/loan tables remain integrated with 05, as declared below.

**Source:** PRD §6, FR-03, FR-04, §§8–10; AC-04, AC-14, AC-15.

**Dependencies:** 00–02; retirement integrates inventory/request guards as 04–05 land.

## Outcome and scope

Map each physical item to an authorized shelf → box → folder location, with editable metadata, availability, and preserved movement history.

## Data and permissions

- Categories initially include Personnel, Finance, Academic, Administrative, and Student Records; Admin may add/deactivate them.
- Structured locations contain room, shelf, rack, optional position, label, and unique code.
- Boxes contain unique code, category, shelf, lifecycle, notes, and confidentiality.
- Folders belong to one box and contain unique code, name, color, template designation, optional urgency, notes, confidentiality, and lifecycle.
- Documents belong to one folder and contain unique code, title, document date, optional covered period, keywords, description, optional approved digital link, confidentiality, and lifecycle. One record represents one physical item; separate copies/volumes get separate codes.
- Use UUID primary keys and normalized unique editable codes; retain code-change audit and never reuse retired codes. QR identity does not change with a code.
- Admin manages categories/locations/boxes/folders. Admin/Staff edit permitted document metadata and relocate permitted records/containers. Viewers read permitted metadata only. Confidentiality changes respect Admin-only downgrade rules.

## Workflows and UI

Use `/boxes`, `/boxes/[id]`, `/folders/[id]`, `/documents`, `/documents/[id]`, and Admin category/location screens. Compose tables, forms, tabs, badges, and location breadcrumbs from 01. Box details show permitted contents, stock, location, and authorized movement history; hide operational history from Viewers.

- Box category classifies descendants. Category changes require explicit confirmation and audit.
- Folder colors (Yellow, Blue, Red, Other) are filing aids, independent of template status, urgency, and confidentiality.
- Relocate a box/folder or refile a document with source, destination, actor, timestamp, and reason. Check authorization at both endpoints and require Admin review before moving into less restrictive ancestry.
- Box movement produces one container movement event; descendants derive current effective location through ancestry. Historical labels remain preserved.
- Checked-out documents cannot be refiled. Container moves retain home ancestry but do not imply that borrowed items are physically present.
- Archived boxes remain searchable and accept existing loan returns; block new filing and routine inventory operations until Admin reactivation.
- Retirement is Admin-only with descriptive confirmation and transactional guards for descendant loans, active request lines, and inventory. Preserve history; no cascade deletion.

## Verification

- Rename a box and open its original UUID URL successfully; the old/new code is audited (AC-04).
- Moving a box updates descendant effective locations and retains historical source labels without synthetic movements for every descendant (AC-14).
- Reject cross-scope or confidentiality-downgrading moves without the required access/review.
- Distinguish available, checked-out, archived, and retired records; retain date-only metadata without timezone drift.
- Block retirement with actionable permitted reasons for active loans, request lines, or remaining stock (AC-15).
- Rejected writes and failed audit writes leave hierarchy and history unchanged.
