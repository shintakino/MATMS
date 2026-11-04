# MATMS — Project Overview

## Product and source of truth

The Meocan Archive & Template Management System (MATMS) is an authenticated web application for Meocan High School. Primary operators are the Administrative Officer II and School Property Custodian. It maps physical records to shelves, boxes and folders; tracks printed blank forms and digital master links; records document requests and custody; and maintains supplies, semi-expendable property and PPE with stock cards and physical-count reports.

[MATMS-PRD.md](../MATMS-PRD.md) v1.3 is the product baseline. Context translates it into implementation guidance; [feature specs](feature-specs/README.md) define deliverable units and verification. Resolve conflicts before implementation. Specs 00–08 describe implemented archive/template/custody functionality; the Property Custodian role and initial ledger service exist, but the module in specs 10–13 is incomplete. Prior baseline test results do not establish that these additions work.

## Goals

1. Locate authorized physical records quickly and maintain verified locations and custody history.
2. Keep printed-form stock accurate per revision/folder, with low-stock alerts and immutable history.
3. Maintain attributable custodial opening balances, receipts, issues, returns, transfers and adjustments without negative balances.
4. Reconcile frozen card balances with physical counts, signed shortage/overage, valuation and condition.
5. Generate Appendix 58 Stock Card, Annex A.8 RPCSP and Appendix 73 RPCPPE with the supplied workbooks' layout, design, fields and structure.
6. Protect restricted records and apply role/scope rules to counts, search, imports, reports, exports and print paths.
7. Support consistent shadcn/ui desktop administration and accessible mobile lookup/count entry.
8. Let Admin/personnel file leave for SHS/JHS teachers without accounts and other personnel; support Admin-managed resource bookings, expiring public request links and separate public calendars.

## Users and core workflows

- **Admin:** provision accounts, manage grants/classifications, maintain filing and template revisions, configure inventory form versions/sections/thresholds/signatories, and manage settings/lifecycle; schoolwide access.
- **Property Custodian (`property_custodian`):** the target capabilities are custodial items/lots and transactions, count finalization, supported imports, official forms and inventory retirement within approved policy. These inventory workflows remain incomplete. The role also has permitted document, printed-form and custody operations under PRD §5; no account/grant/profile administration.
- **Staff:** maintain permitted document metadata, relocate records, transact printed-form stock, process requests/loans and ordinary authorized exports. Custodial entry is assigned draft work only; no custodial posting/adjustment, import, count finalization or official-form generation.
- **Viewer:** read/search/scan permitted records; no writes, exports, label printing or operational history.

Roles determine actions; inherited archive grants determine restricted box/folder/document visibility. Custodial school/assignment scope is enforced independently; the new role does not bypass archive restrictions. See PRD §5 for the full matrix.

### Archive and document custody

Sign in → search/scan → inspect authorized contents and home breadcrumb → file/refile or approve and release a requested record → track due date, return, exception and movement history.

### Printed template inventory

Select a master revision and template folder → receive, issue, transfer or correct stock → atomically commit balance/ledger/audit → show confirmed per-location status. External files retain provider permissions. This accounting domain remains separate from Property Inventory.

### Property Custodian inventory

Create item/acquisition lot with reporting class, section, fund, office and condition → verify opening inventory → post referenced transactions → review reorder/data-quality states → generate a chronological Appendix 58 card. Create RPCSP/RPCPPE count → freeze as-of card balances → record and review physical counts/conditions → finalize immutable snapshot → generate source-faithful XLSX and print/Save as PDF. Corrections use linked amendments or separate ledger adjustments.

### Supported workbook migration

Upload one of the three supported form structures → detect every sheet/section → preview mappings and source anomalies → resolve required issues → explicitly commit verified openings and/or draft counts. Preview does not mutate operational records; physical-count import never automatically adjusts stock. The [workbook reference](inventory-workbook-reference.md) records all seven inspected sheets and observed anomalies.

## MVP scope

- Admin-provisioned authentication, four-role target matrix, inherited archive grants and account lifecycle.
- Categories, shelves, boxes, folders, documents, template revisions and printed-form ledger.
- Requests, partial fulfillment, checkout, returns, exceptions and movement history.
- Custodial item/lot register, office/fund balances, referenced stock ledger, reorder states and Appendix 58 cards.
- RPCSP/RPCPPE physical counts, condition/variance review, frozen finalization and linked amendments.
- Versioned form profiles and signatories; source-faithful XLSX and printable/PDF outputs for the three form families.
- Controlled preview/commit import of the supplied workbook structures, provenance and error reporting.
- Scoped dashboard/search/reports/CSV, QR labels/scanning, audit, safe retirement, deployment, backups and restore rehearsal.
- Shared shadcn/ui + Tailwind, light-first theme and accessible responsive workflows.

## Deferred scope

The user-requested [leave and booking extension](feature-specs/14-leave-and-resource-bookings.md) adds date/range leave requests, equipment/facility scheduling and public availability. It is separate from inventory accounting and archive custody. Production leave limits, approval and public leave visibility require explicit configuration; entitlement/payroll calculations are outside scope.

Google Drive API/OAuth and document automation; scanned uploads/OCR; electronic signatures; email/SMS reminders; procurement/purchase requests; multi-school support; offline sync; generic/custom spreadsheet import; XLSX exports beyond the three custodial form families; report designers; configurable multistep approvals; formal disposal execution; native mobile apps. Password-recovery email is distinct from reminders.

Metadata/links remain the archive storage model. Controlled inventory uploads and private generated files are a narrow exception with expiry/provenance rules, not general file storage. Source workbooks are field/layout references, not proof of current legal requirements. The school/accounting owner confirms production profiles, classification thresholds and treatment of missing values.

## Success and release gates

- Verify locations for at least 95% of active pilot boxes/folders; at least 90% of authorized lookup attempts succeed within 30 seconds.
- Attribute every stock/custody change; prevent negative balances, duplicate postings and duplicate open document loans under concurrency.
- Reconcile custodial balances/ledger and preserve count card quantities, physical counts, signed variances, unit values, conditions, metadata, signatories and profile versions.
- Pass source-form structural and rendered golden comparisons, including actual-size printed approval for all three families.
- Complete AC-01 through AC-36, backup restoration and school/Property Custodian pilot sign-off before full production release.

The PRD's six-week limited-pilot schedule is indicative. Preserve authorization, transaction history, count integrity, official-form fidelity and backups. Track implemented versus planned scope and school decisions in [progress-tracker.md](progress-tracker.md).
