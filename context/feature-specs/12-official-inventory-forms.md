# 12 — Official Inventory Forms and Layout Fidelity

**Status:** In progress. Authorized XLSX and print generation is connected and structural checks are recorded in the progress tracker; source-rendered comparison and school visual approval remain open.

**Source:** PRD FR-11 form generation, §§6, 8–11, 15–17; AC-28, AC-29, AC-30, AC-31, AC-35, AC-36.

**Dependencies:** 10 ledger/card projection; 11 frozen count data. Define versioned profiles before 11 creates sessions. Extend report/access/admin UI in 01–02/06/08. Maintain existing QR print isolation from 07.

## Profile and snapshot contract

Admin creates effective-dated immutable profile versions for Appendix 58, Annex A.8 and Appendix 73. Include source hash, family, sheet variants/order, section display labels, appendix/annex text, titles/captions, date/number/currency formats, font metrics, column widths, row/merge rules, borders, margins, A4 orientation, header repetition, totals, threshold note and signatory geometry. Names and default signatories are configurable metadata, frozen per session/report. Do not seed real source names as production defaults.

Record a version note and visual approval for profile publication. Used versions cannot be edited/deleted; a corrected label, margin, threshold note or signature layout creates a new version. Source-specific spellings and `SHORTAGE/COVERAGE` remain in the source-faithful profile unless a separate approved version changes them.

Generate XLSX and browser print/Save as PDF from one immutable, canonical report payload. Count forms use a finalized session; draft previews have a visible Draft marker and cannot masquerade as official exports. Stock cards freeze item/fund/office/date scope, effective ledger projection and metadata at export because no count session exists for them. Store the payload or a lossless retained reference sufficient for regeneration, profile version, normalized data hash and artifact checksum. Later ledger, master or profile edits cannot change historical output.

## Required outputs

| Family | Exact source structure | Required presentation |
| --- | --- | --- |
| Appendix 58 | A:G: Date, Reference, Receipt Qty., Issue Qty., Office, Balance Qty., No. of Days to Consume; source item/fund/reorder/unit fields | Portrait, Times New Roman, right appendix label, centered title, two-row headers including Issue across D:E, bordered rows, blank-card option |
| Annex A.8 RPCSP | A:J: Article, Description, Semi-expendable Property No., Unit of Measure, Unit Value, Balance per Property Card, On Hand per Count, variance Quantity, variance Value, Remarks | A4 landscape, source-specific Arial Narrow/Calibri styles, two-row headers, merged/grouped article sections, totals and signature blocks; three source sheet variants |
| Appendix 73 RPCPPE | A:L: Article, Description, Property Number, Unit of Measure, Unit Value, Quantity per Property Card, Quantity per Physical Count, variance Quantity, variance Value, Supplier, Year Acquired, Remarks | A4 landscape, source-specific Arial Narrow/Calibri styles, three-row quantity/variance headers, Land/Buildings/Other Structures sheet variants, totals/grand total, threshold note and signatures |

Use all section mappings and source coordinate/layout anchors in the reference. Full-workbook output retains the three RPCSP or three RPCPPE sheets in source order; subset exports identify their scope in preview/history. Keep wrapped descriptions/remarks, property identifiers as text, numeric zero distinct from blank valuation, typed dates and fixed-decimal currency. Rebuild totals from validated report lines; never reproduce defective source formulas or incomplete source totals.

Each count form retains `Certified Correct by`, `Noted by`, Property Custodian name/designation, two committee printed-name/signature blocks and School Head block. Names are for wet signatures only. Land's continuation description remains one report record. Profile-specific unit-value totals are distinct from extended inventory value and signed variance totals; do not silently redefine a source column.

## Export Excel workflow and workbook packaging

Provide an **Export Excel (.xlsx)** action on `/property-inventory/reports` and finalized count details, plus the Stock Card page for Appendix 58. Admin/Property Custodian selects the report family, finalized count session or item/card scope, as-of date/fund and approved profile, reviews the preview, then generates and downloads an actual Excel workbook. For count reports, controls select a matching frozen session rather than changing its finalized date, fund or membership.

Default RPCSP and RPCPPE export scope is **Full workbook — all 3 sheets**. One generation produces one downloadable `.xlsx` file per selected family, not three separate files or CSV renamed as Excel. Preserve these exact worksheet names and order for the source-faithful profile:

| Export | Worksheets in order |
| --- | --- |
| RPCPPE `.xlsx` | `RPCPPE_LAND`; `RPCPPE_BLDG`; `RPCPPE_OTHERBLDG` |
| RPCSP `.xlsx` | `RPCSP_IT EQPMNTS`; `RPCSP_F&F`; `RPCSP_ OTHERSUPPLIES` |
| Appendix 58 `.xlsx` | `SC`, containing the selected item's Stock Card |

Map each eligible finalized line to its configured sheet/section exactly once. Full-workbook readiness must account for all three sheets within the approved session scope. Retain a sheet with no eligible items as an empty formatted form; never omit it silently. A missing or unreviewed section is not an empty completed section and must be resolved before a full official export. Any explicitly selected subset export is labeled Partial in preview/history and cannot be presented as the full three-sheet workbook.

Generate all sheets from one frozen report payload, validate corrected calculations and structure, and save the export audit/history record before releasing the file. Show Generating, Ready to download or Failed with safe retry; do not show success before the workbook is ready. Use the same operation ID for ambiguous retries. Downloads use an authorized response with `.xlsx` filename, the XLSX MIME type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and attachment disposition. Use a sanitized family/school/as-of/session filename; export history supports authorized download while retained or regeneration from the original snapshot afterward.

Build this as a deliverable with four checked increments: generation contract/profile and three-sheet routing; dynamic worksheet rendering and corrected calculations; export action/download/history integration; structural, rendered and Excel-opening verification. Print/PDF remains a separate action using the same report payload.

## Dynamic items, rows and calculation ranges

The source files define layout patterns, not a fixed inventory list or maximum row count. Build detail rows from authorized item/lot snapshots selected by form family, class, section, fund, office and as-of scope. New eligible items/lots appear in new reports and through an explicit draft-session refresh/review; creating a master item alone does not create an acquisition balance or a counted quantity. A finalized report remains frozen and requires a new session/amendment to include later additions.

Expand each section for its actual included lines, regenerate article merge spans and row wrapping, and position subtotals, grand totals, notes and signatures after those lines. Preserve the approved source sheet grouping/order while allowing variable numbers of items in each group. Stock Card rows similarly grow with the selected item's ledger entries. Recompute print areas, page breaks and repeated headers; never truncate at the source workbook's last detail row or add trailing formatted blank pages.

Use the same corrected calculation contract in server values and any generated XLSX formulas:

- RPCSP/RPCPPE variance Quantity (H) = physical count (G) minus frozen card quantity (F); variance Value (I) = signed variance (H) times frozen unit value (E). Unknown required values remain unavailable and follow readiness policy; they are never silently coerced to zero.
- Section/report totals use exactly their included detail rows, excluding headers, signatures, presentation carry-forwards and already-totaled rows. Keep shortage/overage subtotals separate so opposite signs cannot hide unresolved differences. Unit-value sums remain distinct from quantity-times-unit-value inventory totals.
- Derive all cell references and SUM ranges from generated row positions, including inserted rows, omitted/excluded lines and shifted sections. Do not copy the source's fixed endpoints or defective addition/partial-sum formulas. Verify typed values and any formula cached results against server-computed totals before delivery.

## Pagination and print behavior

Set explicit semantic print areas ending at the form's meaningful content. Ignore formatted trailing rows/columns and unusable source scaling. Match sheet-specific width proportions, fonts, margins, borders, merge geometry and row wrapping rather than flattening all sheets into one table style. Use approved font availability/substitution documented with the golden baseline.

Fit one page wide, paginate vertically, repeat complete column headers, keep signature/total blocks together where feasible, avoid clipped or split rows, and show Page x of y. Carry Stock Card balance forward without fake receipts/issues. Empty and multi-page forms must remain usable. Source print omissions (missing repeated headers, blank Annex label) follow explicit PRD corrections documented in the reference/profile.

The web workspace uses shared shadcn/ui; the printed form uses the source's typography and plain borders. Hide app navigation, controls and toasts. Profile/readiness/exclusion controls stay outside the printed form; draft marks and required form notes remain visible. Browser print/Save as PDF satisfies MVP print/PDF output; do not imply a separate server PDF engine exists.

## Generation, artifacts and authorization

Only Admin/Property Custodian generates official forms; general Staff CSV or label permission does not grant this capability. Recheck current authority and item/session scope for preview, generation, replay, export-history and download. Never put artifacts at public URLs or embed unrelated/hidden rows, external workbook links, macros or executable user text. XLSX user text must remain typed string cells even when it begins with a formula character; only server-owned formulas are permitted.

Use PRD `inventoryReports` procedures. Audit preview/generation with actor, scope, session/card snapshot, profile, format and row count; checksum is required for generated artifacts. Do not release a file if generation validation or audit fails. Retain export history and deterministic source data after temporary files expire; document private temporary storage, download expiry and regeneration rules. Original-byte download is possible only while its artifact is retained; regenerated ZIP metadata may differ, so compare canonical typed data and layout separately from original file checksum (AC-36).

Generate a 2,000-line form and print preview within 30 seconds on the agreed deployment profile, or expose an authorized queued job with progress, failure and retry. Use durable operation IDs to avoid duplicate export records after timeouts; document limits and rate controls independent of ordinary CSV caps.

## Acceptance and checks

- Verify source column order, metadata, merged headers, formulas versus values, numeric formats, borders, titles, notes and all signature blocks for all seven source sheets (AC-28–AC-30).
- Establish approved blank, populated, long-description and multi-page golden XLSX/rendered print fixtures per family/variant. Structural assertions are exact for column order, merge rules, labels and snapshot values; document measured page geometry/font tolerances before approving visual regressions (AC-31).
- Compare actual rendered output at consistent paper/font settings; inspect no clipping, stray blank pages, broken signatures, missing carry-forward or mismatched preview/XLSX totals. School actual-size printed approval remains a production gate.
- Profile v2 changes leave v1 session data and source-equivalent layout reproducible; preserve artifact checksums and canonical data hashes (AC-36).
- Staff/Viewer and revoked identities cannot generate or download official artifacts through guessed IDs or retry paths (AC-35). Test formula-like text, audit failure, expiry and generation retry.
- Generate empty, single-line, source-sized and larger-than-source sections; add eligible items to a draft through explicit refresh and confirm every selected line appears once, formula/merge ranges expand, totals recalculate and signatures move without clipping. New-item exports do not alter the prior finalized snapshot (AC-27–AC-31, AC-36).
- End-to-end Export Excel produces one valid `.xlsx` attachment for RPCPPE with exactly its three named sheets, and likewise for RPCSP, in source order. Reopen the generated workbook and verify worksheet count/names, scoped line routing, values/formulas, formatting and empty-sheet retention; confirm it opens without repair warnings in the agreed Excel/LibreOffice acceptance environment (AC-29–AC-31). Appendix 58 exports a valid `SC` workbook (AC-28).

## Appendix 59 ICS extension (2026-11-09)

User-authorized addition: generate Appendix 59 Inventory Custodian Slips from selected, already posted semi-expendable issue transactions. Preserve the supplied `Appendix 59 - ICS.xls` original and its ICS sheet design, A:H columns, merged Amount header, E:F description, typography, borders and Received from/by blocks. Generated XLSX rows grow beyond the 32 source detail rows; repeat the complete heading and keep signatures together. Compute total cost with exact cents from issued quantity and lot unit value; reject missing value/property identifiers rather than substitute zero. Entity, ICS number, useful life and wet-signature metadata require explicit entry. Same-fund, same-recipient issues only; generation does not post stock or imply a signed acknowledgement.

Only active Admin/Property Custodian accounts may list eligible issues, preview, generate or download. Persist immutable versioned snapshots, source hash, data hash and checksum, with atomic audit and durable operation replay. Re-download uses saved data, independent of later item edits. This adds an export family only; ICS workbook import remains outside the supported importer. Source-rendered fidelity, Excel-opening approval and deployment are separate verification gates.

Appendix 59 implementation was deployed and verified on 2026-11-11 (`28ee582`, workflow `42963992328`). [ICS verification](../../deploy/ics-verification.json) records workbook/database/browser/rendered and live checks. School printer and Microsoft Excel acceptance remain separate.

## ICS layout and management revision — 2026-11-12

User-authorized extension supersedes manual ICS numbering and download-only history. New and edited slips use a v2 layout extracted from `ICS-2025-11-001.xlsx`, preserving approved fonts/sizes, column proportions, heading/signature geometry and borders. Reference data and signatories are not application defaults. Long descriptions wrap at unchanged font size and continue in bounded blocks/pages with complete repeated headings; source originals remain private and untouched. Explicit standard paper geometry replaces the reference's printer-specific paper code.

Admin/Property Custodian may read, edit, delete and restore saved ICS documents. Edit creates a new immutable export revision under the same number with optimistic document-version checking and a reason; prior revisions remain downloadable while the document is active. Delete removes a slip from active history into Deleted slips; restore is explicit. Neither action changes stock/issue ledgers. The existing immutable export table and v1 renderer remain intact for historical regeneration. A mutable document head and append-only revision links track current version/lifecycle, with audited, atomic and durable replay-safe mutations.

New ICS numbers are server-assigned on save as `YYYY-MM-NNN` using the current Asia/Manila month. A transactional monthly counter, existing-number reconciliation and unique reserved document numbers prevent concurrent duplicates and reuse after deletion. Preview is provisional and does not consume a number. Existing slip numbers remain unchanged; edits retain their number. Frozen existing line quantities/costs remain authoritative during edits; newly added issue lines use reviewed current inventory values.

Deployed and verified on 2026-11-12: revision `6c6a935`, [workflow 43145665286](https://github.com/shintakino/MATMS/actions/runs/43145665286). User-selected long bond uses Folio paper code 14 (8.5 × 13 inches). [V2 evidence](../../deploy/ics-v2-verification.json) records source/rendered comparisons, CRUD/concurrency/upgrade checks, successful backup/migration and live controls. Historical snapshot hashes and existing numbers were preserved. Native Excel and school printer acceptance remain separate.

User print-preview feedback exposed clipped Unit Cost and signature labels in the reference's short fixed rows. The next renderer revision retains fonts, columns, borders and long-bond settings while giving heading/metadata/signature rows minimum line-height plus padding and explicit vertical alignment. Compute pagination using these expanded heights. New generation/edits use `ics-v3`; historical v1/v2 exports retain their renderers and checksums. Verify actual rendered labels, not only text extraction or font/merge equivalence.
