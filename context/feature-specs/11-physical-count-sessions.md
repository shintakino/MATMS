# 11 — Physical Counts, Reconciliation and Amendments

**Status:** In progress. Count sessions, assignments, scoped snapshots, review, finalization and amendments are connected; full acceptance remains open.

**Source:** PRD §6 rules 16–19, FR-11 physical counts, §§8–11; AC-26, AC-27, AC-34, AC-35, AC-36.

**Dependencies:** 10 register/ledger and 01–02/08 extensions. Profile identity/version contracts from 12 must exist before session creation; rendering can follow. Import creation integrates in 13.

## Session and snapshot

Create a unique coded session with RPCSP or RPCPPE family, report type/sheet/section scope, explicit as-of date, school/entity, fund, accountable officer/designation, accountability-assumed date, Property Custodian, two committee signature blocks/chair/member designations, School Head and immutable profile version. Preserve source month/year display as profile metadata without guessing a missing day.

Snapshot included lots at the as-of date: text identifiers, article/description, section/order, unit, card quantity, unit value or reason it is unavailable, acquisition/supplier fields, condition and remarks. The card quantity comes from the authorized effective-dated ledger, not today's balance or an uploaded variance. Store lot/balance versions and snapshot time; unique(session, lot) prevents duplicates. Keep source coordinates/import evidence where relevant.

An explicit refresh of a draft records before/after differences and actor, invalidates affected review state, and never drops entered counts silently. Later master edits or back-dated postings expose a changed-source warning; require explicit reconciliation/refresh before finalization. Transactions after the as-of date do not silently change that count's card snapshot.

New eligible items/lots are offered in an explicit draft membership refresh with an inclusion/exclusion preview. Preserve existing entered counts; newly included lines start uncounted and must pass normal review before finalization. Creating an item alone does not manufacture stock or physical counts. New sessions select eligible inventory dynamically, while previously finalized sessions retain their original membership.

## Draft entry and assignment

- Admin/Property Custodian creates, assigns and reviews counts. Persist explicit session/line assignments for Staff; verify current assignment on every read/save, including direct IDs and retries. Staff edits assigned physical quantity, condition, remarks and reviewer notes only, never frozen card/value fields or approval state.
- Use expected line/session versions to prevent concurrent autosave overwrites. Saved/Pending/Failed indicators reflect server acknowledgement; retry retains input. Block finalization while edits remain unsaved.
- Keep uncounted distinct from numeric zero. Every included line is counted, excluded with reason, or unavailable with reason under profile policy. Display exclusions/unavailable valuations in readiness preview. Required fields unresolved under that profile remain blockers.
- Mixed condition text may be recorded with reviewed quantity breakdown or an explicit unresolved state; never infer a disposal or issue from an unserviceable count.

## Calculations and review

The server calculates `variance_quantity = physical_count - frozen_card_quantity` and `variance_value = variance_quantity * frozen_unit_value` using fixed-decimal arithmetic. Negative means Shortage, positive Overage, zero Matched. A missing value produces unavailable valuation, not zero; numeric zero remains valid with any required explanation. Do not let typed/imported variance override the result.

Show both signs and labels. Preserve `SHORTAGE/COVERAGE` only in the source-faithful RPCSP output profile; operational screens use Shortage/Overage. Show separate section/report card totals, physical totals, shortage and overage quantities/values, matched/uncounted/unavailable counts and profile-required unit-value totals. Do not sum units across incompatible measures as a meaningful stock balance; scope quantity totals by unit or label them as form-required line aggregates. Never sum property numbers, years or rates.

Review shortages, overages, unserviceable/not-functional lines, inconsistent classifications, duplicates, missing fields and formula-derived imported counts. Reconciliation records notes and resolution references. A count or finalization never changes live stock automatically; corrections use a separate authorized adjustment through 10, with a reference to the count.

## Finalization and amendment

Admin/Property Custodian validates and confirms readiness, scope, totals, exclusions, signatories and finality. In one transaction lock the session/lines, recheck source versions and authority, persist immutable report data/metadata/signatories/profile reference, finalizer/time and audit. Concurrent save/refresh/finalize cannot mutate a frozen session. Use durable operation IDs for finalization/amendment retries.

Reject in-place changes to a finalized session with `COUNT_FINALIZED`. Amendment creates a linked new session with required reason and attribution; preserve both versions and identify which supersedes the prior report without deleting it. A profile change affects new sessions only. Generated report history continues to resolve the original snapshot.

## UI and API

Routes: `/property-inventory/counts`, `/property-inventory/counts/[id]`. States distinguish draft, validation issues, ready and finalized; show amendment links separately. Use sticky desktop headers and compact labeled mobile line cards, numeric inputs, condition selectors, validation summary and explicit Finalize Alert Dialog. Focus/keyboard navigation and errors must work without color cues. Reports/previews are read-only; assignment does not grant official export access.

Use PRD `physicalCounts` contracts for creation, explicit line refresh, save, exclusion, validation, finalization, amendment and preview; add assignment handling and conflict-safe autosave contracts. Return `REPORT_NOT_READY` for readiness failures with authorized actionable line details.

## Acceptance and checks

- Card 10, physical 8, PHP 1,250 yields -2 / Shortage / PHP -2,500; test matched, overage, zero/missing values and fixed-decimal totals (AC-26).
- Finalized data/signatories/profile cannot change through edit, import, refresh, later master edits or concurrent saves; amendment preserves the original (AC-27).
- Imported counts remain drafts and never post automatic ledger corrections (AC-34).
- Assigned Staff can save only assigned draft lines; revoked assignment/role denies further writes, finalization and official export (AC-35).
- Original report data and layout remain reproducible after profile/section/signatory changes (AC-36). Exercise audit rollback, stale versions and repeated finalization.
