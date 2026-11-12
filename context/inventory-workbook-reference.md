# Property Inventory — Workbook Reference

**Status:** Source inspection completed 2026-10-28; report implementation, rendered comparison and school approval remain planned. Read with PRD FR-11 and [specs 10–13](feature-specs/README.md). This records the supplied files' structure, not a determination of current accounting requirements.

## Inspected sources

| File in repository root | Format | Sheets | SHA-256 |
| --- | --- | --- | --- |
| `Appendix 58 - SC.xls` | BIFF `.xls` | `SC` | `f350dce16a51e34685bfa530c33a194b7b453248e23f07c90424265dfe166f94` |
| `RPCSP 2025-ARAKAN WEST-MEOCAN HIGH SCHOOL.xlsx` | OOXML `.xlsx` | `RPCSP_IT EQPMNTS`, `RPCSP_F&F`, `RPCSP_ OTHERSUPPLIES` | `9e72470132ed1115050fa0b488594f643fc38a91cc3200d2b783a029b9c6f818` |
| `RPCPPE 2025-ARAKAN WEST-MEOCAN HIGH SCHOOL (1).xlsx` | OOXML `.xlsx` | `RPCPPE_LAND`, `RPCPPE_BLDG`, `RPCPPE_OTHERBLDG` | `d3dd4272ccded5e1c32a8fde248b8db2c80d9684b76bed23730a3de4ebb08974` |

Inspection covered all seven sheets, cell values, cached values, formulas, merged ranges, fonts, column widths and available print settings. The originals remain untouched. Actual rendered Excel/PDF comparison is a separate acceptance step. Source names, dates, quantities and signatories are reference content; do not copy them into production defaults or fictional seeds.

## Appendix 58 — Stock Card

- The `SC` sheet is a blank form, not an opening inventory or transaction dataset. Its used/formatted extent is A1:G45.
- G1 contains `Appendix 58`; A4:G4 is the merged `STOCK CARD` title. Entity Name/Fund Cluster are on row 6; Item/Stock No. on row 8; Description/Re-order Point on row 9; Unit of Measurement on row 10.
- Rows 11–12 define A:G: Date; Reference; Receipt Qty.; Issue Qty.; Office; Balance Qty.; No. of Days to Consume. Merge A11:A12, B11:B12 and G11:G12 vertically; D11:E11 groups Issue above Qty./Office. Receipt and Balance each have Qty. below their heading.
- Preserve the bordered blank entry area and source row spacing in a blank-card output. A populated card expands with wrapped rows and repeated headers; carry-forward is presentation, never an extra ledger transaction.
- Times New Roman: appendix label 16 pt, title 14 pt, metadata/headers predominantly 12 pt. Source Excel widths A:G are approximately 11.125, 14, 11.75, 11.75, 23.625, 15.75, 21.5.
- The source contains A4 paper settings but unusual saved scaling. The approved output profile uses portrait, one page wide and legible sizing per the PRD; do not reproduce unusable printer scaling.

## Annex A.8 — RPCSP

All three sheets share A:J: Article; Description; Semi-expendable Property No.; Unit of Measure; Unit Value; Balance Per Property Card; On Hand Per Count; variance Quantity; variance Value; Remarks.

- Title row 2, property type row 3, type caption row 4, as-of row 5, fund cluster row 7, accountable-officer statement row 8, headers rows 10–11, first detail row 12.
- Titles/type/as-of use merged A:J ranges. A10:A11 through G10:G11 and J10:J11 contain vertical column headings. H10/I10 form the visible `SHORTAGE/COVERAGE` group with Quantity/Value on row 11; capture the actual group geometry in the profile rather than assuming it is merged in every sheet.
- Sheet `RPCSP_IT EQPMNTS` has `Annex A.8` in A1:J1; `RPCSP_ OTHERSUPPLIES` also has the label. `RPCSP_F&F` has a blank label cell: flag this source inconsistency and use the PRD-required Annex A.8 label in the approved profile.
- The three RPCSP sheets use the caption `(Type of Property, Plant and Equipment)` even though their report title refers to semi-expendable property. The reference starting point retains that caption for review; the school may record approved wording in its immutable profile.

| Sheet | Property-type title | Grouped article/detail spans | Totals and certification |
| --- | --- | --- | --- |
| `RPCSP_IT EQPMNTS` | `IT AND OFFICE EQUIPMENTS` | IT/OFFICE EQUIPMENTS rows 12–20; OTHER EQUIPMENTS rows 22–49 | Totals rows 21 and 50; certification 51; custodian 53–54; committee/head 56–58 |
| `RPCSP_F&F` | `FURNITURES AND FIXTURES` | CLASSROOM FURNITURES & FIXTURES rows 12–21; LABORATORY /ICTFURNITURES & FIXTURES 22–28; ADMINISTRATION FURNITURES & FIXTURES 29–39 | Total 40; certification 41; custodian 43–44; committee/head 46–48 |
| `RPCSP_ OTHERSUPPLIES` | `OTHER SUPPLIES & EQUIPMENTS` | SCIENCE EQUIPMENTS / SUPPLIES 12–128; MATH SUPPLIES/EQUIPMENTS 129–143; SPORTS SUPPLIES/EQUIPMENTS 144–153; EMERGENCY SUPPLIES/EQUIPMENT 154–157; CLINIC & ISOLATION SUPPLIES/EQUIPMENT 158–164; OTHER SUPPLIES & EQUIPMENTS 165–171 | Total 172; certification 173; custodian 175–176; committee/head 178–180 |

These are source spans, including intentional blanks, not an assertion that every row is an item. Resolve merged article labels down their own group only. Exclude totals and signature rows. Preserve the three-sheet grouping and order for a full RPCSP workbook, with selectable subsets clearly shown in preview.

All sheets save A4 landscape settings. Arial Narrow 9–10 pt dominates body/header content; title is 14 pt with some Calibri labels. Widths and margins differ by sheet; preserve separate layout variants rather than forcing a generic grid. For example, IT A:J widths are approximately 8.270, 27.727, 12.270, 9.816, 10.270, 15.727, 10.727, 8.180, 10, 26.543.

The source saves no print area or repeated header rows. Formatted extents reach row 991 (IT), 164 (F&F), and 1124 (other supplies), while meaningful content ends at rows 60, 50 and 180 respectively. Bound print/import to semantic content; do not create hundreds of blank pages. Output must repeat the complete headers and retain signature blocks per PRD, even where the source lacks those print settings.

## Appendix 73 — RPCPPE

All three sheets share A:L: Article; Description; Property Number; Unit of Measure; Unit Value; Quantity per Property Card; Quantity per Physical Count; Shortage/Overage Quantity; Shortage/Overage Value; Supplier; Year Acquired; Remarks.

- I1:L1 contains Appendix 73; A3:L3 is the report title; type row 4, caption 5, as-of 6, fund 8, accountability statement 9, headers 11–13, first detail 14.
- A–E and J–L have vertically merged row 11–13 labels. H11:I12 is the merged SHORTAGE/OVERAGE group, with Quantity/Value at H13/I13. F/G split QUANTITY, per and PROPERTY CARD/PHYSICAL COUNT across three rows.

| Sheet | Property type | Detail/continuation | Totals and certification |
| --- | --- | --- | --- |
| `RPCPPE_LAND` | `LAND (SCHOOL SITE)` | Item 14; description continuation B15 belongs to the same land record | Grand Total 16; certification 18; custodian 20–21; committee/head 23–25; note 28–29 |
| `RPCPPE_BLDG` | `SCHOOL BUILDINGS` | Items 14–18 | Total 20; certification 22; custodian 24–25; committee/head 27–29; note 32–33 |
| `RPCPPE_OTHERBLDG` | `OTHER STRUCTURES` | Detail span 14–24, including blank rows | Total 25; certification 27; custodian 29–30; committee/head 32–34; note 36–37 |

Preserve these three sheets and their order for a full RPCPPE workbook. A4 landscape, Arial Narrow predominantly 10 pt, title 15 pt, and sheet-specific widths/margins. Some sheets have formatted columns through Z; the report ends at L. Notes include `USE RPCPPE FORM FOR 50K UP` and its example line. Treat PHP 50,000 as a source convention requiring an effective-dated Admin policy and accounting confirmation, not a hard-coded legal rule.

## Signatures and metadata

Both count forms have `Certified Correct by:` and `Noted by:`, a School Property Custodian name/designation, two inventory committee printed-name/signature blocks and a School Head block. Source custodian names differ between RPCSP and RPCPPE. Store separate profile defaults and freeze session signatories; never derive them from the logged-in user's display name. Typed names support wet-signature printing only. Support the source's month/year as-of display while storing an explicit operator-confirmed date; do not guess an exact day during import.

## Observed anomalies that must become review cases

| Source coordinate/example | Required treatment |
| --- | --- |
| RPCSP F&F C12 and C13 share a property number | Flag duplicate; require mapping correction or an Admin-documented exception. Do not merge unrelated items. |
| RPCSP F&F E12/E14 contain numeric zero, E13 contains `-`, other value cells are blank | Preserve zero versus missing versus placeholder; require reason/validation as applicable. No invented valuation. |
| RPCSP F&F F14=350, G14=295, H14=125 | Recalculate signed variance as -55; flag the source value. F15=100/G15=80/H15=35 likewise yields -20. |
| RPCSP F&F F16=28/G16=5/H16=0; F29=5/G29=6/H29=0 | Recalculate -23 and +1 respectively; do not trust manually entered zero. |
| RPCSP F&F I17/I18 and other value cells use addition instead of multiplication | Never execute/copy these formulas as authoritative valuation. |
| RPCSP other supplies E172 sums E144:E157 only | Rebuild section/report totals over included validated lines; flag the incomplete source total. |
| RPCSP IT G17 and many other count cells refer directly to card quantities | Cached/formula-derived count is not independent physical verification; require review before count finalization. |
| RPCSP IT E22=93,000 inside semi-expendable report | Flag threshold/classification conflict; preserve source evidence and require policy-based resolution. |
| RPCSP IT remarks mix serviceable and nonfunctional quantities; F&F remarks also mix condition counts | Preserve original remarks; support reviewed condition breakdown or explicit mixed/unresolved state. Do not infer stock issues, disposal, or quantity adjustments from prose. |
| RPCPPE BLDG E15 missing; OTHERBLDG missing identifiers, units and values | Data-quality warnings/blockers according to profile; unknown value is not zero. |
| RPCPPE OTHERBLDG K15=`2018, 2025`, K19=`2022-2025` | Preserve approved year-label text separately from an exact acquisition date; do not parse as a single invented year. |
| RPCPPE LAND B15 is description-only | Preview as a continuation of row 14, never an extra zero-quantity property. |

These cases are requirements for future importer, calculation and report tests. No workbook was imported into the application during this documentation task.

## Appendix 59 ICS — additional source (2026-11-09)

`Appendix 59 - ICS.xls` contains the blank `ICS` sheet. The meaningful form is A1:H51; formatting extends to J109 and is not inventory data. A9:A11 Quantity, B9:B11 Unit, C9:D9 Amount, C10:C11 Unit Cost, D10:D11 Total Cost, E9:F11 Description, G9:G11 Inventory Item No., H9:H11 Estimated Useful Life. Detail slots are rows 12–43, with E:F merged per row. Received from/by blocks start at row 44; name/signature, position/office and date rows end at 51. Source fonts/styles, widths and heights are extracted by `tools/extract-ics-template.mjs` into `packages/api/src/ics-template.ts`, alongside its SHA-256. Source paper is Letter portrait, margins left 1.25, right 1, top 0.79 and bottom 0.5 inches. Generation corrects source scaling/formatting-only extents and repeats rows 1:11 for growing forms. Original remains unchanged. This structural inspection is not rendered or school visual approval.

## ICS-2025-11-001.xlsx — revised ICS layout (2026-11-12)

User supplied a populated ICS example as a replacement design reference. Original remains private and unchanged. `tools/extract-ics-v2-template.mjs` retains only styles, geometry and fixed form labels, excluding sample stock, school/signatory names and dates. Its `ICS` sheet uses A:H, a widened H column (24), Times New Roman 14 headings, Times New Roman 12 column headers, Calibri 11 detail values and Times New Roman 11 signature values/labels. Source header merges include A5:D6 and A3:H4; the first item spans rows 12–14, and names occupy A45:E46 / F45:H46. Source margins are 0.25 inches left/right and 0.75 top/bottom. Printer paper code 256 has no portable dimensions; user explicitly selected long bond 8.5 × 13 inches, implemented as Folio paper code 14.

The v2 renderer preserves these font sizes and print proportions, expands wrapped description blocks dynamically, repeats rows 1:11 and keeps the complete signature block together. Subsequent logical item blocks can use one equivalent-height worksheet row to avoid quadratic merge overhead on large reports. The v1 source and renderer are retained for existing saved versions.

User print-preview feedback identified clipped text in the reference's short cost/signature rows. Renderer v3 keeps fonts and column widths, reserves at least 36 points for the cost subheadings and 18 points for each signature caption, and gives Received labels 22 points with merged half-width cells and explicit middle alignment. Metadata/name/office heights expand before pagination. V1/v2 remain unchanged for historical exports; new/edited versions use v3. LibreOffice single/multiple/long-description/long-office examples rendered as 1/2/7/1 long-bond pages; full label visibility was visually checked, beyond text-preservation assertions.

Renderer v4 retains the v3 layout and prints both signature dates as user-requested `MM-DD-YYYY`. ISO snapshot dates and all historical renderers remain unchanged. The same four rendered scenarios retain their page counts, paper geometry and visible labels with the new date display.
