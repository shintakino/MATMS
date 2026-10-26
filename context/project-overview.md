# MATMS — Project Overview

## Product and source of truth

The Meocan Archive & Template Management System (MATMS) is an authenticated web application for Meocan High School. The primary operator is the Administrative Officer II. It maps physical records to shelves, boxes, and folders; tracks printed blank forms and digital master links; and records requests, checkout, returns, and movement history.

[MATMS-PRD.md](../MATMS-PRD.md) is the product baseline. Context files translate it into implementation guidance; [feature specs](../feature-specs/README.md) define deliverable units and verification. Resolve conflicts in the documentation before implementation. Planned behavior is not evidence of a working application.

## Goals

1. Locate authorized physical records without opening multiple boxes.
2. Keep verified locations, stock balances, and an attributable history of changes.
3. Identify low stock per template revision and folder before forms run out.
4. Track requests and custody from approval through fulfillment and return.
5. Protect restricted records across every lookup, report, export, and QR path.
6. Support desktop administration and mobile shelf lookup using a consistent shadcn/ui interface.

## Users and core workflows

- **Admin:** provision accounts, manage classifications and grants, maintain filing structures and template revisions, correct balances, and manage lifecycle and settings; schoolwide access.
- **Staff:** maintain permitted document metadata, relocate records, receive/issue/transfer stock, and process requests and loans within authorized scope.
- **Viewer:** read, search, and scan permitted records; no writes, exports, label printing, or operational transaction history.

Roles determine actions; explicit grants determine visibility of restricted records. See PRD §5 for the full matrix and inherited restriction rules.

### Record lookup and filing

Sign in → search or scan a box → inspect permitted contents and breadcrumb location → file or refile a record if authorized → preserve movement and audit history.

### Printed template inventory

Select a master revision and template folder → receive, issue, transfer, or correct stock → server commits balance, ledger, and audit together → show confirmed balance and per-location stock status. External master files retain their provider permissions.

### Requests and custody

Admin/Staff enters a request → authorized officer approves lines → fulfill inspect/copy lines or release a borrowed original → track due dates → record return or an Admin exception resolution. Approval and release are separate actions.

## MVP scope

- Admin-provisioned authentication, roles, restricted-record grants, and account lifecycle.
- Dashboard, categories, structured shelf locations, boxes, folders, and document metadata.
- Revision-specific digital master links and physical template stock with immutable ledger.
- Requests, partial fulfillment, checkout, return, exceptions, and relocation history.
- Permission-filtered search, reports, CSV export, QR labels, and scanning with manual fallback.
- Audit history, safe record retirement, Docker deployment, backups, and restore rehearsal.
- Shared shadcn/ui components, accessible forms and tables, light-first theme, and responsive navigation.

## Deferred scope

Google Drive API/OAuth and document automation; scanned uploads, OCR and document-content search; electronic signatures; email/SMS reminders; purchase requests; multiple schools; offline sync; bulk spreadsheet import; native XLSX exports; configurable multistep approvals; formal disposal execution; native mobile apps. Password-recovery email is distinct from deferred reminder notifications.

MVP stores metadata and links, not scanned records. It does not establish official retention periods or school disposal policy.

## Success and release gates

- Verify locations for at least 95% of active pilot boxes/folders before rollout.
- Locate an authorized record within 30 seconds in at least 90% of pilot attempts.
- Attribute every stock change and checkout; never allow negative stock or duplicate open loans under concurrency.
- Prevent restricted-record discovery through counts, search, exports, guessed URLs, and QR previews.
- Complete PRD AC-01 through AC-22, restore a backup, and obtain staff pilot sign-off.

The PRD's four-week solo-developer pilot schedule is indicative. Preserve security, history, and backup requirements if presentation or camera-scanning scope needs adjustment. School operational decisions remain tracked in [progress-tracker.md](progress-tracker.md).
