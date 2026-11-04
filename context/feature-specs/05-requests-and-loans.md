# 05 — Requests, Fulfillment and Loans

**Status:** Implemented. Service/database integration and Chromium borrow approval/release/return flows pass; requests/loans routes pass automated accessibility scans (2026-10-28). Comprehensive school staff/assistive-technology acceptance remains open.

**Source:** PRD FR-07, §§6, 8–10; AC-08, AC-11–AC-13.

**Dependencies:** 00–03; shared idempotency and audit infrastructure.

## Outcome and scope

Track authorized record requests from entry and approval through fulfillment, custody, return, or documented exception resolution. Admin/Property Custodian/Staff enter requests on behalf of requesters; no public requester portal.

## Request behavior

- Capture requester name, optional office/contact, purpose, type (`inspect`, `borrow`, `copy`), one or more unique document lines, and notes. Collect only necessary personal data.
- Follow PRD lifecycle: draft → submitted → approved/rejected/cancelled; first fulfillment makes an approved request in progress; complete it only when all required lines are resolved and loans returned/resolved.
- Track decisions and fulfillment per line. Partial requests remain active until remaining lines are resolved. Cancellation applies only to unfulfilled lines; do not erase completed actions.
- Ordinary approvals may be made by authorized Admin/Property Custodian/Staff. Restricted-record requests require Admin approval and a releaser with current record access.
- Approval is separate from release. Rejections require reasons. Revalidate line eligibility and current permissions at each transition.
- Apply the confirmed mixed approval/rejection/cancellation transition table below.

### Aggregate request state

Confirmed for implementation on 2026-10-27:

| Line outcomes and custody | Request status |
| --- | --- |
| Draft before submission | `draft` |
| At least one line awaiting a decision | `submitted` |
| Decisions complete, at least one approved line, and no fulfillment | `approved` |
| At least one fulfillment and approved work or a loan remains unresolved | `in_progress` |
| All approved work is fulfilled and all loans are returned or resolved | `completed` |
| Every line rejected | `rejected` |
| Every line cancelled | `cancelled` |
| Mixed rejected and cancelled outcomes with no approved work | `completed` |

An Admin may resolve a lost/damaged loan by recording a disposition and supporting notes. This records an administrative resolution only; it does not imply disposal or write-off authority.
An administratively resolved item with no recorded physical return remains unavailable for another loan. A later return records the receiver and condition without reopening the resolved request.

## Fulfillment and custody

- Inspect/copy fulfillment records actor and timestamp without a loan. If the original leaves custody, use Borrow.
- Borrow records recipient acknowledgement, releasing officer, released timestamp, and due date. Enforce at most one unresolved open checkout per document in PostgreSQL.
- Release requires an approved eligible request line. Commit checkout, fulfillment/request progress, and audit in one transaction.
- Return records receiver, time, condition, and home folder. An authorized alternative folder creates a relocation event in the same transaction.
- Prevent refile while checked out; allow existing loan returns to archived home boxes.
- Overdue is computed from an open loan and due timestamp. Display timestamps in Asia/Manila; verify release/due/return chronology.
- Repeated release/return uses durable operation IDs and payload matching; no duplicate loan or double close.
- Lost/damaged records remain unresolved exceptions until Admin records resolution and supporting notes. Preserve history and block retirement while unresolved. School policy remains the authority for any disposal or write-off outside this feature.

## UI and routes

Use `/requests`, `/requests/[id]`, and `/loans`. Compose request forms, authorized RecordPicker, line tables, status badges, and release/return confirmations from 01. Show pending/approved/rejected/cancelled/fulfilled lines and loan state distinctly. Filters include active, overdue, returned, and exception loans.

Keep recipient, due date, and condition fields explicit. Failed submission retains input; pending buttons prevent duplicate clicks. Request summaries and related histories must not disclose inaccessible documents.

## Verification

- Two concurrent releases produce at most one open loan (AC-11).
- Partial fulfillment remains in progress until remaining lines and loans are resolved (AC-12).
- Return records receiver/condition and closes custody once while retaining history (AC-13).
- Lost-response retries do not duplicate release/return and mismatched operation reuse fails (AC-08).
- Restricted approval, unauthorized release, already fulfilled lines, invalid chronology, and unapproved lines fail safely.
- Alternative-location return commits custody, movement, and audit together; failure changes none.

## Planned new-role integration

Wire Property Custodian into permitted document request/release/return capabilities through 02/10 and repeat grant/replay/approval tests. The implemented baseline status predates that role. Custodial inventory issues/returns are ledger operations in 10; they do not create document checkouts or bypass restricted-request Admin approval.
