# 15 — Individual equipment custody

User-authorized FR-11 extension, 2026-11-17. Implementation and verification are tracked separately in the progress tracker.

## Scope and workflow

Admin and Property Custodian register ICT devices individually under reusable item masters. Each device uses one acquisition lot, one holding-office balance and a permanent property number. Brand/model, manufacturer serial (or explicit missing-serial reason), specifications, accessories, warranty and notes describe the physical unit. Permanent number and brand/serial identity are reserved for its lifetime. Multi-copy books/supplies retain batch lots and continuing issue ranges.

Registration explicitly reviews either verified available stock of exactly one, or an existing single-unit issue to an identified directory person. The latter adopts the real issue without reposting stock. Reject multi-unit history and ambiguous outstanding issues. Teachers use the existing directory without requiring accounts; only Admin maintains the directory. Private custody search, history and all actions require active Admin/Property Custodian server-side, including retries.

Issue debits holding stock once and records person, location, condition and dated handover. Return requires confirmation of physical receipt and credits stock once. Reassignment records a witnessed return and new issue atomically, with explicit physical-handover confirmation. Repair preserves accountability. Lost records retain accountability; recovery requires physical return. Approved disposal/relief recording is Admin-only and requires an external approval reference; the system grants no disposal authority. PPE accepts PAR references; PAR form generation is deferred.

## Storage and invariants

Add equipment units and immutable event snapshots. One unit per lot, globally unique normalized permanent number and unique normalized brand/serial where present. No physical deletion or identity replacement. The unit head has optimistic versions; every action has a durable master replay, audit entry and immutable after-state event in the same transaction as any stock movements. Account/source/operation/unit locks protect concurrent posting; registration takes the exclusive custodial source lock. Monotonic effective dates prevent custody actions from rewriting the current holder. New assignments require active directory people, but returns from inactive people remain possible.

Registered lots cannot be manipulated by generic stock posting/import or retired through ordinary item/lot edits. Only the equipment service may post their ledger. Active bookable links must be retired before individual registration, and registered lots cannot become bookable resources. Existing batch lots are not automatically converted.

Store stock and owned property are distinct: an issued device has store quantity zero and owned quantity one. New/refreshed physical counts use latest equipment event on/before the as-of date (including held, repair and lost units until approved disposal) and freeze holder/location/serial. Count snapshots allowlist only counting/custody fields; internal device notes, specifications, accessories and warranty remain in the manager-only register. Existing finalized snapshots are untouched; draft changes require explicit refresh/review. Before the first recorded custody event, retain legacy ledger semantics rather than inventing history.

## ICS

Registered semi-expendable issue/adoption/reassignment events link to actual stock issue transactions. New device slips use v6 frozen permanent number, device/event/person identifiers and serial identity; quantity is one per device. Identity remains stable across teachers and item-code changes. Selection groups by directory person as well as fund; batch workflows remain v5 when no device is selected. Mandatory identity text is appended by the renderer even when editable descriptions change. Existing v1–v5 snapshots and rendering remain unchanged. ICS generation never moves stock. PPE is excluded from ICS.

## Verification

Verify fresh and populated migration, role/replay reauthorization, uniqueness, concurrent double issue, atomic witnessed reassignment, return/loss/recovery/disposal, audit rollback, generic posting/import guards, scheduling compatibility, as-of counts and immutable old snapshots. Verify device ICS identity/serial, multi-device same-person selection, mixed-recipient denial, metadata edit and historical download; preserve batch ranges. Exercise register → issue → ICS → return → reissue through the browser, including mobile and accessibility. Use the existing checked deployment workflow only after passing checks. School print acceptance remains separate.
