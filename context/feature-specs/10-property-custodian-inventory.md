# 10 — Property Custodian Register and Ledger

**Status:** In progress. The separate custodial register, ledger and screens are connected; see the progress tracker for verification and remaining acceptance work.

**Source:** PRD §§5–6, FR-11 item/lot and transaction rules, §§8–11; AC-23, AC-24, AC-25, AC-35.

**Dependencies:** Existing 00–03 foundation; planned role/shell extensions in 01–02 and audit/settings extensions in 08. Read the [workbook reference](../inventory-workbook-reference.md). Continue in the existing workspace; do not re-scaffold it.

## Outcome and boundaries

Give the Property Custodian one register for supplies, semi-expendable property and PPE, with attributable movements and reconcilable balances. Keep `custodial_*` records separate from template revisions/folder stock, document requests and document loans. Reuse shared auth/audit/transaction infrastructure without sharing balances or posting the same movement twice.

## Data and configuration

- `custodial_items`: normalized unique item/stock code, article, description, unit, nullable nonnegative integer reorder point, default section, active status and notes. Codes remain text with leading zeros/hyphens intact; historical codes are not reused.
- `custodial_lots`: item, exactly one class (`stock_card`, `semi_expendable`, `ppe`), property/semi-expendable number, nullable fixed-decimal PHP unit value, supplier/source, acquisition date or approved year label, fund cluster, accountable officer, office/location, condition/serviceability, remarks, lifecycle and version. Unknown valuation remains null; confirmed numeric zero is distinct.
- Persist a versioned balance per item/lot, fund and office/location scope, with nonnegative integer quantity and explicit uniqueness for nullable-lot stock-card rows. Choose the concrete balance table/constraints in the reviewed migration; never store independent item and lot totals that can drift.
- Nonblank normalized property numbers are unique in approved school/fund scope unless an Admin-authorized exception records the collision and reason. Blank numbers are visible data-quality issues where permitted. Lot history survives code, office, condition and metadata changes.
- Admin maintains effective-dated report sections/profile mappings and the confirmed classification threshold. Seed the 11 RPCSP sections and three RPCPPE types from the reference, retaining source display labels separately from normalized codes. A threshold edit never reclassifies historical snapshots.
- Support serviceable, unserviceable, not functional, operational, needs minor/major repair, not in use and mixed/unresolved source conditions as reviewed mappings. Preserve raw remarks. Mixed condition quantities require explicit review and cannot silently reduce on-hand stock or execute disposal.

## Authorized operations

Admin and Property Custodian manage items/lots, post transactions and make reason-bearing corrections. Only Admin changes profiles, thresholds/default signatories, grants or accounts. Staff may enter assigned drafts/count lines; assignment is not posting, import, adjustment, finalization or official export authority. Viewers cannot mutate or view operational history. Apply the PRD role matrix and current school/record scope on every read, replay, aggregate and artifact operation.

| Operation | Required input and effect |
| --- | --- |
| Opening balance | Verified quantity, transaction date, reference and source/reason; attributable ledger entry, never direct count assignment |
| Receipt | Positive quantity, date, reference and source; credit the selected balance |
| Issue | Positive quantity, date, reference, receiving office/purpose; optional nonnegative integer days to consume; debit only sufficient stock |
| Return | Positive quantity, date, reference and returning office/reason; credit with attribution and condition review where applicable |
| Transfer | Same item/lot/class/unit/fund, distinct valid offices/locations, positive quantity, reference; linked debit/credit commit together |
| Adjustment | Expected version, before/after, signed delta, required reason and approval trail; append compensating history, no rewriting prior entries |

Each posting has a UUID operation ID, actor from session, normalized payload fingerprint, effective transaction date, immutable posting timestamp and durable result. Same-intent retries reauthorize and return the original result; changed intent conflicts. Lock affected balances in a stable order; operation, balance, ledger and audit commit together. Audit failure rolls back everything. Zero opening declarations may be recorded as verification metadata rather than fabricated nonzero transactions.

## Chronology and Stock Card projection

Build the Appendix 58 card for one item/fund and explicit authorized office scope from opening plus receipts/returns/inbound transfers minus issues/outbound transfers plus signed adjustments. Show location scope in preview; an inter-office transfer nets to zero schoolwide but remains traceable.

Order by effective date plus stable server-assigned sequence/ID for same-day entries. Back-dated posting requires an impact preview/confirmation and transactional validation of every affected subsequent running balance; reject any intermediate negative balance. Preserve immutable posted ledger deltas and original before/after facts. Recalculate the dated card projection from those deltas inside the transaction without editing old ledger rows; lock the affected scope against competing back-dated writes. Preserve previously frozen card exports.

Reorder is `saved balance <= configured reorder point`; null means no configured alert, zero is valid. Display zero stock separately and show status per office so totals cannot hide a depleted location. Do not reuse the printed-form default threshold of five.

## API, UI and delivery increments

Use `custodialInventory` procedures from PRD §9, adding an explicit opening-balance procedure and draft/assignment contracts where necessary. Server validates quantities, dates, units, required references, versions, active scope and decimal values; client cannot set resulting balances.

Routes: `/property-inventory`, `/property-inventory/items/[id]`, `/property-inventory/stock-cards/[itemId]`. Register filters include class, section, fund, office, condition, lifecycle, acquisition year, reorder and data quality. Detail tabs show lots, balances, history and metadata. Use shared shadcn/ui forms/tables with pending/failed/conflict states and text badges. Invalidate details, register, ledger, card projection and dashboard after confirmed posting.

Deliver schema/role contracts and permission tests first, register and ledger second, then stock-card projection/UI. Workbook file generation belongs to 12, count snapshots to 11, controlled migration to 13.

## Acceptance and checks

- Opening 10 + receipt 5 - office issue 3 yields 12 with preserved references/actors (AC-23).
- Competing issues of four from five yield at most one success; ledger, projections and saved balance reconcile (AC-24).
- Test null/zero/equal/above reorder boundaries (AC-25), adjustment conflict, all-or-nothing transfers, audit rollback, retry/revocation and property-number exceptions.
- Staff direct API posting/adjustment is denied even with draft assignment; no role escalation through replay (AC-35).
- Back-dating recalculates subsequent projected balances, rejects intermediate negatives, and leaves prior ledger facts/export snapshots unchanged.
- Fixed-decimal arithmetic, text identifiers, valid versus missing dates/values and mixed-condition remarks are covered by meaningful fixtures. Existing template/loan tests remain passing.
